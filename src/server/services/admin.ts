/**
 * Back-office operations used by the admin panel routes. Each mutating function writes an
 * AuditLog entry for the acting admin. Authorization happens in the route handlers.
 */
import { Types } from 'mongoose';
import {
  hexToLab,
  type GroupSettingsPatch,
  type Permission,
} from '@/shared';
import { audit, type Actor } from '../audit';
import { AppError, conflict, notFound } from '../errors';
import {
  AuditLog,
  ColorPalette,
  DailyAssignment,
  GlobalSettings,
  Group,
  GroupMembership,
  RefreshToken,
  StorageDeletionTask,
  Submission,
  User,
} from '../models';
import { notify } from '../notifications';
import { revokeAllSessions } from './auth';
import { getGlobalSettings, resolveSettings } from './settings';

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PAGE_SIZE = 25;

export interface Page {
  page: number;
  pageSize: number;
}
const pageOf = (page: number): Page & { skip: number } => ({
  page,
  pageSize: PAGE_SIZE,
  skip: (Math.max(1, page) - 1) * PAGE_SIZE,
});

// ---------------------------------------------------------------- dashboard

export async function getDashboard() {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const [users, disabledUsers, groups, archivedGroups, accepted, pendingCleanup, outbox, alerts, bytes] = await Promise.all([
    User.countDocuments({}),
    User.countDocuments({ isDisabled: true }),
    Group.countDocuments({ isArchived: false }),
    Group.countDocuments({ isArchived: true }),
    Submission.countDocuments({ status: 'accepted' }),
    Submission.countDocuments({ cleanupState: 'cleanup_pending' }),
    StorageDeletionTask.countDocuments({}),
    AuditLog.find({ 'metadata.severity': 'alert' }).sort({ createdAt: -1 }).limit(10).lean(),
    Submission.aggregate<{ total: number }>([
      { $match: { status: { $in: ['accepted', 'pending_verification'] } } },
      { $group: { _id: null, total: { $sum: '$sizeBytes' } } },
    ]),
  ]);
  const uploadsToday = await Submission.countDocuments({ uploadedAt: { $gte: startOfDay } });
  return {
    users,
    disabledUsers,
    groups,
    archivedGroups,
    acceptedPhotos: accepted,
    uploadsToday,
    storageBytes: bytes[0]?.total ?? 0,
    pendingCleanup,
    outboxTasks: outbox,
    alerts: alerts.map((a) => ({ id: String(a._id), action: a.action, targetId: a.targetId, metadata: a.metadata, createdAt: a.createdAt })),
  };
}

// -------------------------------------------------------------------- users

function userRow(u: { _id: Types.ObjectId; email: string; displayName: string; permissions: string[]; isDisabled: boolean; createdAt: Date; mustChangePassword: boolean }) {
  return {
    id: String(u._id),
    email: u.email,
    displayName: u.displayName,
    permissions: u.permissions,
    isDisabled: u.isDisabled,
    mustChangePassword: u.mustChangePassword,
    createdAt: u.createdAt,
  };
}

export async function listUsers(query: { q?: string; page: number; disabled?: boolean; withPermissions?: boolean }) {
  const filter: Record<string, unknown> = {};
  if (query.q) {
    const rx = new RegExp(escapeRegex(query.q), 'i');
    filter.$or = [{ email: rx }, { displayName: rx }];
  }
  if (query.disabled !== undefined) filter.isDisabled = query.disabled;
  if (query.withPermissions) filter['permissions.0'] = { $exists: true };
  const { skip, page, pageSize } = pageOf(query.page);
  const [items, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(pageSize).lean(),
    User.countDocuments(filter),
  ]);
  return { items: items.map(userRow), total, page, pageSize };
}

export async function getUserDetail(userId: string) {
  if (!Types.ObjectId.isValid(userId)) throw notFound();
  const user = await User.findById(userId).lean();
  if (!user) throw notFound();
  const memberships = await GroupMembership.find({ userId: user._id }).lean();
  const groups = await Group.find({ _id: { $in: memberships.map((m) => m.groupId) } }).select('name isArchived').lean();
  const [photos, sessions] = await Promise.all([
    Submission.countDocuments({ userId: user._id, status: 'accepted' }),
    RefreshToken.countDocuments({ userId: user._id, revokedAt: null, expiresAt: { $gt: new Date() } }),
  ]);
  return {
    ...userRow(user),
    locale: user.locale,
    privacyPolicyVersion: user.privacyPolicyVersion,
    termsAcceptedAt: user.termsAcceptedAt,
    acceptedPhotos: photos,
    activeSessions: sessions,
    groups: memberships.map((m) => ({
      id: String(m.groupId),
      name: groups.find((g) => String(g._id) === String(m.groupId))?.name ?? '?',
      role: m.role,
      isArchived: groups.find((g) => String(g._id) === String(m.groupId))?.isArchived ?? false,
    })),
  };
}

export async function updateUser(userId: string, patch: { isDisabled?: boolean; displayName?: string }, actor: Actor) {
  const user = await User.findByIdAndUpdate(userId, patch, { returnDocument: 'after', runValidators: true }).lean();
  if (!user) throw notFound();
  if (patch.isDisabled) await revokeAllSessions(user._id); // disabled users are logged out everywhere
  await audit({
    actor,
    action: patch.isDisabled === undefined ? 'user.updated' : patch.isDisabled ? 'user.disabled' : 'user.enabled',
    targetType: 'user',
    targetId: userId,
  });
  return userRow(user);
}

export async function setUserPermissions(userId: string, permissions: Permission[], actor: Actor) {
  const unique = [...new Set(permissions)];
  const before = await User.findByIdAndUpdate(userId, { permissions: unique }).lean();
  if (!before) throw notFound();
  await audit({
    actor,
    action: 'user.permissions_changed',
    targetType: 'user',
    targetId: userId,
    metadata: { from: before.permissions, to: unique },
  });
  return { id: userId, permissions: unique };
}

// ------------------------------------------------------------------- groups

export async function listGroupsAdmin(query: { q?: string; page: number; archived?: boolean }) {
  const filter: Record<string, unknown> = {};
  if (query.q) filter.name = new RegExp(escapeRegex(query.q), 'i');
  if (query.archived !== undefined) filter.isArchived = query.archived;
  const { skip, page, pageSize } = pageOf(query.page);
  const [groups, total] = await Promise.all([
    Group.find(filter).sort({ createdAt: -1 }).skip(skip).limit(pageSize).lean(),
    Group.countDocuments(filter),
  ]);
  const counts = await GroupMembership.aggregate<{ _id: Types.ObjectId; n: number }>([
    { $match: { groupId: { $in: groups.map((g) => g._id) } } },
    { $group: { _id: '$groupId', n: { $sum: 1 } } },
  ]);
  return {
    items: groups.map((g) => ({
      id: String(g._id),
      name: g.name,
      isArchived: g.isArchived,
      memberCount: counts.find((c) => String(c._id) === String(g._id))?.n ?? 0,
      createdAt: g.createdAt,
    })),
    total,
    page,
    pageSize,
  };
}

export async function getGroupAdmin(groupId: string) {
  if (!Types.ObjectId.isValid(groupId)) throw notFound();
  const group = await Group.findById(groupId).lean();
  if (!group) throw notFound();
  const global = await getGlobalSettings();
  const members = await GroupMembership.find({ groupId: group._id }).sort({ joinedAt: 1 }).lean();
  const users = await User.find({ _id: { $in: members.map((m) => m.userId) } }).select('displayName email').lean();
  const assignments = await DailyAssignment.find({ groupId: group._id }).sort({ date: -1 }).limit(14).lean();
  return {
    id: String(group._id),
    name: group.name,
    isArchived: group.isArchived,
    archivedReason: group.archivedReason,
    overrides: group.settings,
    settings: resolveSettings(group, global),
    members: members.map((m) => {
      const u = users.find((x) => String(x._id) === String(m.userId));
      return { userId: String(m.userId), displayName: u?.displayName ?? '?', email: u?.email ?? '', role: m.role, joinedAt: m.joinedAt };
    }),
    recentAssignments: assignments.map((a) => ({
      date: a.date,
      colorHex: a.colorHex,
      colorName: a.colorName,
      deadlineAt: a.deadlineAt,
      cooldownRelaxed: a.cooldownRelaxed,
    })),
  };
}

export async function updateGroupSettingsAdmin(groupId: string, patch: GroupSettingsPatch, actor: Actor) {
  const group = await Group.findById(groupId).lean();
  if (!group) throw notFound();
  const set = Object.fromEntries(Object.entries(patch).map(([k, v]) => [`settings.${k}`, v]));
  await Group.updateOne({ _id: group._id }, { $set: set }, { runValidators: true });
  await audit({ actor, action: 'group.settings_updated_by_admin', targetType: 'group', targetId: groupId, metadata: { fields: Object.keys(patch) } });
  if (patch.timezone) await audit({ actor, action: 'group.timezone_changed', targetType: 'group', targetId: groupId, metadata: { timezone: patch.timezone } });
}

export async function setGroupArchived(groupId: string, archived: boolean, actor: Actor) {
  const group = await Group.findByIdAndUpdate(
    groupId,
    archived
      ? { isArchived: true, archivedAt: new Date(), archivedReason: 'admin' }
      : { isArchived: false, archivedAt: null, archivedReason: null },
  ).lean();
  if (!group) throw notFound();
  await audit({ actor, action: archived ? 'group.archived' : 'group.unarchived', targetType: 'group', targetId: groupId });
  if (archived) {
    const members = await GroupMembership.find({ groupId: group._id }).select('userId').lean();
    await notify(members.map((m) => m.userId), 'group_archived', { group: group.name }, { groupId });
  }
}

/** Makes `newAdminId` (an existing member) the group's admin; the previous admin becomes a member. */
export async function reassignGroupAdmin(groupId: string, newAdminId: string, actor: Actor) {
  const target = await GroupMembership.findOne({ groupId, userId: newAdminId }).lean();
  if (!target) throw new AppError('VALIDATION_ERROR', 400, { issues: [{ path: 'userId', message: 'NOT_A_MEMBER' }] });
  await GroupMembership.updateMany({ groupId, role: 'admin' }, { role: 'member' });
  await GroupMembership.updateOne({ _id: target._id }, { role: 'admin' });
  const group = await Group.findById(groupId).select('name').lean();
  await notify([target.userId], 'admin_transferred', { group: group?.name ?? '' }, { groupId });
  await audit({ actor, action: 'group.admin_reassigned', targetType: 'group', targetId: groupId, metadata: { newAdminId } });
}

// ------------------------------------------------------------------ palette

export async function listPalette() {
  const colors = await ColorPalette.find({}).sort({ name: 1 }).lean();
  return colors.map((c) => ({ id: String(c._id), name: c.name, hex: c.hex, lab: c.lab, isActive: c.isActive }));
}

export async function createColor(input: { name: string; hex: string; isActive: boolean }, actor: Actor) {
  const lab = hexToLab(input.hex);
  try {
    const color = await ColorPalette.create({ ...input, lab: [...lab] });
    await audit({ actor, action: 'palette.created', targetType: 'color', targetId: String(color._id), metadata: { hex: input.hex } });
    return { id: String(color._id), name: color.name, hex: color.hex, lab: color.lab, isActive: color.isActive };
  } catch (error) {
    if ((error as { code?: number }).code === 11000) throw conflict('CONFLICT', { field: 'hex' });
    throw error;
  }
}

export async function updateColor(id: string, patch: { name?: string; hex?: string; isActive?: boolean }, actor: Actor) {
  const update: Record<string, unknown> = { ...patch };
  if (patch.hex) update.lab = [...hexToLab(patch.hex)];
  const color = await ColorPalette.findByIdAndUpdate(id, update, { returnDocument: 'after', runValidators: true }).lean();
  if (!color) throw notFound();
  await audit({ actor, action: 'palette.updated', targetType: 'color', targetId: id, metadata: { fields: Object.keys(patch) } });
  return { id, name: color.name, hex: color.hex, lab: color.lab, isActive: color.isActive };
}

/** A colour that was ever drawn is part of history: it can only be deactivated, not deleted. */
export async function deleteColor(id: string, actor: Actor) {
  if (await DailyAssignment.exists({ colorId: id })) throw conflict('CONFLICT', { reason: 'COLOR_IN_USE' });
  const removed = await ColorPalette.findByIdAndDelete(id).lean();
  if (!removed) throw notFound();
  await audit({ actor, action: 'palette.deleted', targetType: 'color', targetId: id });
}

// ----------------------------------------------------------------- settings

export async function updateGlobalSettings(patch: Record<string, unknown>, actor: Actor) {
  const { defaults, ...rest } = patch as { defaults?: GroupSettingsPatch } & Record<string, unknown>;
  const set: Record<string, unknown> = { ...rest };
  for (const [k, v] of Object.entries(defaults ?? {})) set[`defaults.${k}`] = v;
  await getGlobalSettings(); // make sure the singleton exists
  await GlobalSettings.updateOne({ key: 'global' }, { $set: set }, { runValidators: true });
  await audit({ actor, action: 'settings.updated', targetType: 'settings', targetId: 'global', metadata: { fields: Object.keys(patch) } });
  return getGlobalSettings();
}

// ------------------------------------------------------------------ storage

export async function getStorageStats() {
  const perGroup = await Submission.aggregate<{ _id: Types.ObjectId; photos: number; bytes: number }>([
    { $match: { status: { $in: ['accepted', 'pending_verification'] } } },
    { $group: { _id: '$groupId', photos: { $sum: 1 }, bytes: { $sum: '$sizeBytes' } } },
    { $sort: { bytes: -1 } },
    { $limit: 50 },
  ]);
  const groups = await Group.find({ _id: { $in: perGroup.map((g) => g._id) } }).select('name').lean();
  const global = await getGlobalSettings();
  const [pending, tasks, oldest] = await Promise.all([
    Submission.countDocuments({ cleanupState: 'cleanup_pending' }),
    StorageDeletionTask.countDocuments({}),
    Submission.findOne({ status: 'accepted' }).sort({ uploadedAt: 1 }).select('uploadedAt').lean(),
  ]);
  return {
    quotaBytes: global.storageQuotaBytes,
    totalBytes: perGroup.reduce((a, g) => a + g.bytes, 0),
    totalPhotos: perGroup.reduce((a, g) => a + g.photos, 0),
    cleanupPending: pending,
    deletionOutbox: tasks,
    oldestPhotoAt: oldest?.uploadedAt ?? null,
    groups: perGroup.map((g) => ({
      groupId: String(g._id),
      name: groups.find((x) => String(x._id) === String(g._id))?.name ?? '?',
      photos: g.photos,
      bytes: g.bytes,
      retentionDays: resolveSettings(groups.find((x) => String(x._id) === String(g._id)) ?? { settings: {} }, global).retentionDays,
    })),
  };
}

// -------------------------------------------------------------------- audit

export async function listAudit(query: { page: number; action?: string; actorId?: string; alertsOnly?: boolean }) {
  const filter: Record<string, unknown> = {};
  if (query.action) filter.action = new RegExp(`^${escapeRegex(query.action)}`);
  if (query.actorId) filter.actorId = query.actorId;
  if (query.alertsOnly) filter['metadata.severity'] = 'alert';
  const { skip, page, pageSize } = pageOf(query.page);
  const [items, total] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(pageSize).lean(),
    AuditLog.countDocuments(filter),
  ]);
  return {
    items: items.map((a) => ({
      id: String(a._id),
      actorType: a.actorType,
      actorId: a.actorId,
      action: a.action,
      targetType: a.targetType,
      targetId: a.targetId,
      metadata: a.metadata ?? {}, // Mongoose drops empty objects (minimize), so default here
      createdAt: a.createdAt,
    })),
    total,
    page,
    pageSize,
  };
}

// ---------------------------------------------------------------- moderation

/** Recent accepted photos of a group, for moderation in the admin panel. */
export async function listGroupSubmissions(groupId: string) {
  if (!Types.ObjectId.isValid(groupId)) throw notFound();
  const submissions = await Submission.find({ groupId, status: 'accepted' }).sort({ uploadedAt: -1 }).limit(48).lean();
  const users = await User.find({ _id: { $in: submissions.map((s) => s.userId) } }).select('displayName').lean();
  const assignments = await DailyAssignment.find({ _id: { $in: submissions.map((s) => s.assignmentId) } }).select('date colorHex').lean();
  return submissions.map((s) => ({
    id: String(s._id),
    displayName: users.find((u) => String(u._id) === String(s.userId))?.displayName ?? '?',
    date: assignments.find((a) => String(a._id) === String(s.assignmentId))?.date ?? '',
    colorHex: assignments.find((a) => String(a._id) === String(s.assignmentId))?.colorHex ?? '#000000',
    closenessScore: Math.round(s.closenessScore ?? 0),
    uploadedAt: s.uploadedAt,
  }));
}
