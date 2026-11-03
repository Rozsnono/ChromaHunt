import { Schema, model, models, type Model, type Types } from 'mongoose';

export interface AuditLogDoc {
  _id: Types.ObjectId;
  /** `admin` = env-password panel session, `user` = a permission holder or group admin, `system` = jobs. */
  actorType: 'admin' | 'user' | 'system';
  /** User id, `admin` or `system`. Anonymised to `deleted-user` when the account is deleted. */
  actorId: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

const auditSchema = new Schema<AuditLogDoc>(
  {
    actorType: { type: String, enum: ['admin', 'user', 'system'], required: true },
    actorId: { type: String, required: true, index: true },
    action: { type: String, required: true, index: true },
    targetType: { type: String, default: null },
    targetId: { type: String, default: null },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, minimize: false },
);
auditSchema.index({ createdAt: -1 });

export const AuditLog: Model<AuditLogDoc> =
  (models.AuditLog as Model<AuditLogDoc>) ?? model<AuditLogDoc>('AuditLog', auditSchema);

export interface RateLimitDoc {
  _id: Types.ObjectId;
  key: string;
  count: number;
  resetAt: Date;
}

const rateLimitSchema = new Schema<RateLimitDoc>(
  {
    key: { type: String, required: true, unique: true },
    count: { type: Number, required: true, default: 0 },
    resetAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
  },
  { timestamps: true },
);

export const RateLimit: Model<RateLimitDoc> =
  (models.RateLimit as Model<RateLimitDoc>) ?? model<RateLimitDoc>('RateLimit', rateLimitSchema);

/** Expo push ticket awaiting its receipt (used to detect `DeviceNotRegistered`). */
export interface PushTicketDoc {
  _id: Types.ObjectId;
  ticketId: string;
  userId: Types.ObjectId;
  token: string;
  createdAt: Date;
}

const pushTicketSchema = new Schema<PushTicketDoc>(
  {
    ticketId: { type: String, required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, required: true },
    token: { type: String, required: true },
    createdAt: { type: Date, default: Date.now, index: { expireAfterSeconds: 3 * 24 * 3600 } },
  },
  { timestamps: false },
);

export const PushTicket: Model<PushTicketDoc> =
  (models.PushTicket as Model<PushTicketDoc>) ?? model<PushTicketDoc>('PushTicket', pushTicketSchema);

/** Outbox of WebDAV objects that still have to be deleted (account deletion, retention). */
export interface StorageDeletionTaskDoc {
  _id: Types.ObjectId;
  storageKey: string;
  attempts: number;
  lastError: string | null;
  nextAttemptAt: Date;
}

const deletionTaskSchema = new Schema<StorageDeletionTaskDoc>(
  {
    storageKey: { type: String, required: true, unique: true },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: null },
    nextAttemptAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true },
);

export const StorageDeletionTask: Model<StorageDeletionTaskDoc> =
  (models.StorageDeletionTask as Model<StorageDeletionTaskDoc>) ??
  model<StorageDeletionTaskDoc>('StorageDeletionTask', deletionTaskSchema);
