/**
 * Settings resolution. Every group setting has a global default (hard-coded fallback ->
 * GlobalSettings.defaults) and an optional per-group override. Global limits always win.
 */
import {
  DEFAULT_GLOBAL_LIMITS,
  DEFAULT_GROUP_SETTINGS,
  type GlobalLimits,
  type GroupSettings,
  type GroupSettingsPatch,
} from '@/shared';
import { AppError } from '../errors';
import { GlobalSettings, type GlobalSettingsDoc, type GroupDoc } from '../models';

/** Returns the settings singleton, creating it with defaults on first use. */
export async function getGlobalSettings(): Promise<GlobalSettingsDoc> {
  const doc = await GlobalSettings.findOneAndUpdate(
    { key: 'global' },
    { $setOnInsert: { key: 'global' } },
    { upsert: true, returnDocument: 'after' },
  ).lean();
  if (!doc) throw new Error('GlobalSettings upsert returned no document');
  return doc;
}

export function globalLimits(global: GlobalSettingsDoc): GlobalLimits {
  return {
    minAcceptanceThreshold: global.minAcceptanceThreshold ?? DEFAULT_GLOBAL_LIMITS.minAcceptanceThreshold,
    maxRetentionDays: global.maxRetentionDays ?? DEFAULT_GLOBAL_LIMITS.maxRetentionDays,
    storageQuotaBytes: global.storageQuotaBytes ?? DEFAULT_GLOBAL_LIMITS.storageQuotaBytes,
    registrationOpen: global.registrationOpen ?? DEFAULT_GLOBAL_LIMITS.registrationOpen,
  };
}

function definedOnly(patch: GroupSettingsPatch | undefined): GroupSettingsPatch {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch ?? {})) if (value !== undefined && value !== null) out[key] = value;
  return out as GroupSettingsPatch;
}

/** Effective settings of a group: defaults <- global defaults <- group overrides <- global limits. */
export function resolveSettings(group: Pick<GroupDoc, 'settings'>, global: GlobalSettingsDoc): GroupSettings {
  const limits = globalLimits(global);
  const merged: GroupSettings = {
    ...DEFAULT_GROUP_SETTINGS,
    ...definedOnly(global.defaults),
    ...definedOnly(group.settings),
  };
  return {
    ...merged,
    acceptanceThreshold: Math.max(merged.acceptanceThreshold, limits.minAcceptanceThreshold),
    retentionDays: Math.min(merged.retentionDays, limits.maxRetentionDays),
  };
}

/** Group admins may not go below the global minimum threshold or above the maximum retention. */
export function assertWithinLimits(patch: GroupSettingsPatch, global: GlobalSettingsDoc): void {
  const limits = globalLimits(global);
  const issues: Array<{ path: string; message: string }> = [];
  if (patch.acceptanceThreshold !== undefined && patch.acceptanceThreshold < limits.minAcceptanceThreshold) {
    issues.push({ path: 'acceptanceThreshold', message: `MIN_${limits.minAcceptanceThreshold}` });
  }
  if (patch.retentionDays !== undefined && patch.retentionDays > limits.maxRetentionDays) {
    issues.push({ path: 'retentionDays', message: `MAX_${limits.maxRetentionDays}` });
  }
  if (issues.length > 0) throw new AppError('VALIDATION_ERROR', 400, { issues });
}
