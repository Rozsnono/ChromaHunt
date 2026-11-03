/** Constants shared between the backend, the admin UI and the mobile app. */

/** Dynamic permission strings (there is no role hierarchy). */
export const PERMISSIONS = [
  'palette.manage',
  'users.manage',
  'groups.manage',
  'storage.manage',
  'settings.manage',
  'permissions.manage',
  'audit.view',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Machine readable API error codes. `message` carries an i18n key of the same name. */
export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'PAYLOAD_TOO_LARGE',
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
  'INVALID_CREDENTIALS',
  'ACCOUNT_DISABLED',
  'EMAIL_TAKEN',
  'REGISTRATION_CLOSED',
  'PRIVACY_NOT_ACCEPTED',
  'PASSWORD_CHANGE_REQUIRED',
  'TOKEN_REUSE_DETECTED',
  'INVITE_INVALID',
  'ALREADY_MEMBER',
  'JOIN_REQUEST_PENDING',
  'GROUP_ARCHIVED',
  'NO_ACTIVE_ASSIGNMENT',
  'DEADLINE_PASSED',
  'QUOTA_REACHED',
  'STORAGE_QUOTA_EXCEEDED',
  'UPLOAD_TOKEN_INVALID',
  'INVALID_IMAGE',
  'COLOR_MISMATCH',
  'ADMIN_ACCOUNT_PROTECTED',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** Per-group settings. Every field has a global default and an optional group override. */
export interface GroupSettings {
  /** Photos each member must submit per day. */
  requiredPhotosPerDay: number;
  /** Daily draw time, HH:mm in `timezone`. */
  dailyDrawTime: string;
  /** IANA timezone of the group. */
  timezone: string;
  /** Hours the members have after the draw (capped so the deadline never passes the next draw). */
  deadlineHours: number;
  /** Days an accepted photo stays browsable before it is deleted. */
  retentionDays: number;
  scoringEnabled: boolean;
  /** The same colour is not drawn again within this many days. */
  colorCooldownDays: number;
  /** Minimum closeness (0-100) for a photo to be accepted. */
  acceptanceThreshold: number;
  /** Points deducted for every missing photo of a day. */
  missingPhotoPenalty: number;
  /** Floor (<= 0) of the daily points. */
  minDailyPoints: number;
  /** Hours before the deadline of the reminder push (0 = disabled). */
  deadlineReminderHours: number;
  notifyDailyColor: boolean;
  notifyDeadline: boolean;
}

export const DEFAULT_GROUP_SETTINGS: GroupSettings = {
  requiredPhotosPerDay: 1,
  dailyDrawTime: '08:00',
  timezone: 'Europe/Budapest',
  deadlineHours: 24,
  retentionDays: 30,
  scoringEnabled: false,
  colorCooldownDays: 3,
  acceptanceThreshold: 55,
  missingPhotoPenalty: 10,
  minDailyPoints: -10,
  deadlineReminderHours: 2,
  notifyDailyColor: true,
  notifyDeadline: true,
};

/** Global (instance wide) settings that are not part of a group's settings. */
export interface GlobalLimits {
  /** Groups cannot configure an acceptance threshold below this value. */
  minAcceptanceThreshold: number;
  /** Groups cannot configure a longer retention. */
  maxRetentionDays: number;
  /** Total accepted-photo storage in bytes (0 = unlimited). */
  storageQuotaBytes: number;
  /** When false, `POST /api/auth/register` is rejected. */
  registrationOpen: boolean;
}

export const DEFAULT_GLOBAL_LIMITS: GlobalLimits = {
  minAcceptanceThreshold: 30,
  maxRetentionDays: 365,
  storageQuotaBytes: 0,
  registrationOpen: true,
};

/** Authentication / token lifetimes. */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_DAYS = 30;
export const ADMIN_SESSION_TTL_SECONDS = 8 * 60 * 60;
export const INVITE_TTL_HOURS = 24;
export const UPLOAD_TOKEN_TTL_SECONDS = 10 * 60;

/** Image pipeline. */
export const IMAGE_MAX_EDGE_PX = 1080;
export const IMAGE_JPEG_QUALITY = 80;
/**
 * Maximum raw upload size. Vercel Functions reject request bodies above ~4.5 MB, so the
 * limit is kept safely below it. A 1080 px JPEG is normally 200-800 KB.
 */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export const SUBMISSION_STATUSES = [
  'awaiting_upload',
  'pending_verification',
  'accepted',
  'rejected',
  'deleted',
] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];
