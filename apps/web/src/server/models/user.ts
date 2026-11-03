import { Schema, model, models, type Model, type Types } from 'mongoose';
import { PERMISSIONS } from '@chromahunt/shared';

export interface PushTokenEntry {
  token: string;
  deviceId: string;
  createdAt: Date;
}

export interface UserDoc {
  _id: Types.ObjectId;
  email: string;
  passwordHash: string;
  displayName: string;
  locale: 'hu' | 'en';
  /** Dynamic permission strings; there is no role hierarchy. */
  permissions: string[];
  isDisabled: boolean;
  /** Set after an admin password reset; only `change-password` works until it is cleared. */
  mustChangePassword: boolean;
  termsAcceptedAt: Date;
  privacyPolicyVersion: string;
  pushTokens: PushTokenEntry[];
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<UserDoc>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
    passwordHash: { type: String, required: true },
    displayName: { type: String, required: true, trim: true, minlength: 2, maxlength: 40 },
    locale: { type: String, enum: ['hu', 'en'], default: 'hu' },
    permissions: { type: [{ type: String, enum: PERMISSIONS }], default: [] },
    isDisabled: { type: Boolean, default: false },
    mustChangePassword: { type: Boolean, default: false },
    termsAcceptedAt: { type: Date, required: true },
    privacyPolicyVersion: { type: String, required: true },
    pushTokens: {
      type: [
        new Schema<PushTokenEntry>(
          {
            token: { type: String, required: true },
            deviceId: { type: String, required: true },
            createdAt: { type: Date, default: Date.now },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
  },
  { timestamps: true },
);
userSchema.index({ displayName: 'text' });

export const User: Model<UserDoc> = (models.User as Model<UserDoc>) ?? model<UserDoc>('User', userSchema);

export interface RefreshTokenDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  /** All tokens descending from one login share a family; reuse revokes the whole family. */
  familyId: string;
  tokenHash: string;
  deviceId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  rotatedFrom: Types.ObjectId | null;
}

const refreshTokenSchema = new Schema<RefreshTokenDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    familyId: { type: String, required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    deviceId: { type: String, required: true },
    expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
    revokedAt: { type: Date, default: null },
    rotatedFrom: { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: true },
);

export const RefreshToken: Model<RefreshTokenDoc> =
  (models.RefreshToken as Model<RefreshTokenDoc>) ?? model<RefreshTokenDoc>('RefreshToken', refreshTokenSchema);

export interface BiometricBindingDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  deviceId: string;
  /** HMAC of the random per-device secret held in the device's secure store. */
  secretHash: string;
  lastUsedAt: Date | null;
}

const biometricSchema = new Schema<BiometricBindingDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    deviceId: { type: String, required: true },
    secretHash: { type: String, required: true, unique: true },
    lastUsedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
biometricSchema.index({ userId: 1, deviceId: 1 }, { unique: true });

export const BiometricBinding: Model<BiometricBindingDoc> =
  (models.BiometricBinding as Model<BiometricBindingDoc>) ??
  model<BiometricBindingDoc>('BiometricBinding', biometricSchema);
