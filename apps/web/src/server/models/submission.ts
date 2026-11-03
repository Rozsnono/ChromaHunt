import { Schema, model, models, type Model, type Types } from 'mongoose';
import { SUBMISSION_STATUSES, type SubmissionStatus } from '@chromahunt/shared';

export interface SubmissionDoc {
  _id: Types.ObjectId;
  groupId: Types.ObjectId;
  userId: Types.ObjectId;
  assignmentId: Types.ObjectId;
  /** Internal WebDAV object key. Never sent to clients. */
  storageKey: string | null;
  status: SubmissionStatus;
  /** Idempotency key chosen by the client for offline-queue retries. */
  idempotencyKey: string;
  /** Jti of the currently valid upload token and whether it was already used. */
  uploadJti: string | null;
  uploadConsumedAt: Date | null;
  /** UX-only value from the app; stored for diagnostics, never trusted. */
  clientColorScore: number | null;
  clientSha256: string | null;
  /** Authoritative server-side result. */
  deltaE: number | null;
  closenessScore: number | null;
  dominantHex: string | null;
  dominanceShare: number | null;
  /** Device clock at capture time (sanity-checked, never used for the deadline). */
  capturedAt: Date;
  /** Server receive time of the upload (authoritative for the deadline). */
  uploadedAt: Date | null;
  acceptedAt: Date | null;
  /** SHA-256 of the sanitised (re-encoded, EXIF-free) image that is stored. */
  sha256: string | null;
  width: number | null;
  height: number | null;
  sizeBytes: number | null;
  exifStripped: boolean;
  rejectionReason: string | null;
  cleanupState: 'none' | 'cleanup_pending';
  cleanupFailures: number;
  deletedAt: Date | null;
  deletedReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const submissionSchema = new Schema<SubmissionDoc>(
  {
    groupId: { type: Schema.Types.ObjectId, ref: 'Group', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    assignmentId: { type: Schema.Types.ObjectId, ref: 'DailyAssignment', required: true },
    storageKey: { type: String, default: null },
    status: { type: String, enum: SUBMISSION_STATUSES, required: true, default: 'awaiting_upload' },
    idempotencyKey: { type: String, required: true },
    uploadJti: { type: String, default: null },
    uploadConsumedAt: { type: Date, default: null },
    clientColorScore: { type: Number, default: null },
    clientSha256: { type: String, default: null },
    deltaE: { type: Number, default: null },
    closenessScore: { type: Number, default: null, min: 0, max: 100 },
    dominantHex: { type: String, default: null },
    dominanceShare: { type: Number, default: null },
    capturedAt: { type: Date, required: true },
    uploadedAt: { type: Date, default: null },
    acceptedAt: { type: Date, default: null },
    sha256: { type: String, default: null },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    sizeBytes: { type: Number, default: null },
    exifStripped: { type: Boolean, default: false },
    rejectionReason: { type: String, default: null },
    cleanupState: { type: String, enum: ['none', 'cleanup_pending'], default: 'none' },
    cleanupFailures: { type: Number, default: 0 },
    deletedAt: { type: Date, default: null },
    deletedReason: { type: String, default: null },
  },
  { timestamps: true },
);
submissionSchema.index({ groupId: 1, assignmentId: 1 });
submissionSchema.index({ userId: 1, assignmentId: 1 });
submissionSchema.index({ userId: 1, idempotencyKey: 1 }, { unique: true });
submissionSchema.index({ status: 1, updatedAt: 1 });
submissionSchema.index({ groupId: 1, status: 1, uploadedAt: 1 });

export const Submission: Model<SubmissionDoc> =
  (models.Submission as Model<SubmissionDoc>) ?? model<SubmissionDoc>('Submission', submissionSchema);
