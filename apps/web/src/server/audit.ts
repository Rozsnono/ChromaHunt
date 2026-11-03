import { errorFields, log } from './logger';
import { AuditLog } from './models';

export interface Actor {
  type: 'admin' | 'user' | 'system';
  /** User id, `admin` or `system`. */
  id: string;
}

export const SYSTEM_ACTOR: Actor = { type: 'system', id: 'system' };

export interface AuditEntry {
  actor: Actor;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Appends an audit record. Never throws: a failing audit write is logged but must not break
 * the (already completed) action. Metadata must not contain secrets or personal data.
 */
export async function audit(entry: AuditEntry): Promise<void> {
  try {
    await AuditLog.create({
      actorType: entry.actor.type,
      actorId: entry.actor.id,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      metadata: entry.metadata ?? {},
    });
  } catch (error) {
    log.error('audit write failed', { action: entry.action, ...errorFields(error) });
  }
}
