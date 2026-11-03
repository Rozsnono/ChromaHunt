import { Schema, model, models, type Model, type Types } from 'mongoose';
import { DEFAULT_GLOBAL_LIMITS, type GroupSettingsPatch } from '@/shared';

/** Field definitions shared by `Group.settings` (overrides) and `GlobalSettings.defaults`. */
const settingsFields = {
  requiredPhotosPerDay: { type: Number, min: 1, max: 10 },
  dailyDrawTime: { type: String, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
  timezone: { type: String },
  deadlineHours: { type: Number, min: 1, max: 24 },
  retentionDays: { type: Number, min: 1, max: 3650 },
  scoringEnabled: { type: Boolean },
  colorCooldownDays: { type: Number, min: 0, max: 30 },
  acceptanceThreshold: { type: Number, min: 0, max: 100 },
  missingPhotoPenalty: { type: Number, min: 0, max: 100 },
  minDailyPoints: { type: Number, min: -100, max: 0 },
  deadlineReminderHours: { type: Number, min: 0, max: 12 },
  notifyDailyColor: { type: Boolean },
  notifyDeadline: { type: Boolean },
} as const;

export interface GroupDoc {
  _id: Types.ObjectId;
  name: string;
  /** Groups are never deleted, only archived (read-only, no new draws). */
  isArchived: boolean;
  archivedAt: Date | null;
  archivedReason: string | null;
  /** Only the fields the group overrides; everything else comes from the global defaults. */
  settings: GroupSettingsPatch;
  createdBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const groupSchema = new Schema<GroupDoc>(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 60 },
    isArchived: { type: Boolean, default: false, index: true },
    archivedAt: { type: Date, default: null },
    archivedReason: { type: String, default: null },
    settings: { type: new Schema(settingsFields, { _id: false }), default: () => ({}) },
    createdBy: { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: true },
);

export const Group: Model<GroupDoc> = (models.Group as Model<GroupDoc>) ?? model<GroupDoc>('Group', groupSchema);

export interface GroupMembershipDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  groupId: Types.ObjectId;
  /** Exactly one admin per group. Pending joiners live in JoinRequest, not here. */
  role: 'admin' | 'member';
  joinedAt: Date;
}

const membershipSchema = new Schema<GroupMembershipDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    groupId: { type: Schema.Types.ObjectId, ref: 'Group', required: true },
    role: { type: String, enum: ['admin', 'member'], default: 'member' },
    joinedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);
membershipSchema.index({ userId: 1, groupId: 1 }, { unique: true });
membershipSchema.index({ groupId: 1, joinedAt: 1 });

export const GroupMembership: Model<GroupMembershipDoc> =
  (models.GroupMembership as Model<GroupMembershipDoc>) ??
  model<GroupMembershipDoc>('GroupMembership', membershipSchema);

export interface InviteCodeDoc {
  _id: Types.ObjectId;
  groupId: Types.ObjectId;
  /** HMAC of the code; the plaintext is shown once at creation. */
  codeHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  usedByUserId: Types.ObjectId | null;
  createdByUserId: Types.ObjectId;
}

const inviteSchema = new Schema<InviteCodeDoc>(
  {
    groupId: { type: Schema.Types.ObjectId, ref: 'Group', required: true, index: true },
    codeHash: { type: String, required: true, unique: true },
    // Cleanup only: usage/expiry is enforced in code. Kept 7 days after expiry for auditing.
    expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 7 * 24 * 3600 } },
    usedAt: { type: Date, default: null },
    usedByUserId: { type: Schema.Types.ObjectId, default: null },
    createdByUserId: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: true },
);

export const InviteCode: Model<InviteCodeDoc> =
  (models.InviteCode as Model<InviteCodeDoc>) ?? model<InviteCodeDoc>('InviteCode', inviteSchema);

export interface JoinRequestDoc {
  _id: Types.ObjectId;
  groupId: Types.ObjectId;
  userId: Types.ObjectId;
  inviteCodeId: Types.ObjectId;
  status: 'pending' | 'approved' | 'rejected';
  decidedBy: Types.ObjectId | null;
  decidedAt: Date | null;
  createdAt: Date;
}

const joinRequestSchema = new Schema<JoinRequestDoc>(
  {
    groupId: { type: Schema.Types.ObjectId, ref: 'Group', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    inviteCodeId: { type: Schema.Types.ObjectId, required: true },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    decidedBy: { type: Schema.Types.ObjectId, default: null },
    decidedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
joinRequestSchema.index(
  { groupId: 1, userId: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' } },
);
joinRequestSchema.index({ groupId: 1, status: 1, createdAt: 1 });

export const JoinRequest: Model<JoinRequestDoc> =
  (models.JoinRequest as Model<JoinRequestDoc>) ?? model<JoinRequestDoc>('JoinRequest', joinRequestSchema);

export interface GlobalSettingsDoc {
  _id: Types.ObjectId;
  /** Singleton marker. */
  key: 'global';
  defaults: GroupSettingsPatch;
  minAcceptanceThreshold: number;
  maxRetentionDays: number;
  storageQuotaBytes: number;
  registrationOpen: boolean;
}

const globalSettingsSchema = new Schema<GlobalSettingsDoc>(
  {
    key: { type: String, enum: ['global'], default: 'global', unique: true },
    defaults: { type: new Schema(settingsFields, { _id: false }), default: () => ({}) },
    minAcceptanceThreshold: { type: Number, min: 0, max: 100, default: DEFAULT_GLOBAL_LIMITS.minAcceptanceThreshold },
    maxRetentionDays: { type: Number, min: 1, max: 3650, default: DEFAULT_GLOBAL_LIMITS.maxRetentionDays },
    storageQuotaBytes: { type: Number, min: 0, default: DEFAULT_GLOBAL_LIMITS.storageQuotaBytes },
    registrationOpen: { type: Boolean, default: DEFAULT_GLOBAL_LIMITS.registrationOpen },
  },
  { timestamps: true },
);

export const GlobalSettings: Model<GlobalSettingsDoc> =
  (models.GlobalSettings as Model<GlobalSettingsDoc>) ??
  model<GlobalSettingsDoc>('GlobalSettings', globalSettingsSchema);
