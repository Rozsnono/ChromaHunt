/**
 * Account lifecycle: registration, login, rotating refresh tokens with reuse detection,
 * password change, device-bound biometric login and admin password reset.
 */
import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_DAYS } from '@/shared';
import { audit, SYSTEM_ACTOR, type Actor } from '../audit';
import { generateTemporaryPassword, hmacHash, randomToken } from '../crypto';
import { env } from '../env';
import { AppError, forbidden, notFound, unauthenticated } from '../errors';
import { log } from '../logger';
import { BiometricBinding, RefreshToken, User, type UserDoc } from '../models';
import { getDummyHash, hashPassword, verifyPassword } from '../password';
import { signAccessToken } from '../tokens';
import { getGlobalSettings } from './settings';

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  locale: 'hu' | 'en';
  permissions: string[];
  mustChangePassword: boolean;
  privacyPolicyVersion: string;
  /** True when a newer policy version has to be accepted again. */
  privacyReacceptanceRequired: boolean;
}

export function toPublicUser(user: UserDoc): PublicUser {
  return {
    id: String(user._id),
    email: user.email,
    displayName: user.displayName,
    locale: user.locale,
    permissions: user.permissions,
    mustChangePassword: user.mustChangePassword,
    privacyPolicyVersion: user.privacyPolicyVersion,
    privacyReacceptanceRequired: user.privacyPolicyVersion !== env().PRIVACY_POLICY_VERSION,
  };
}

const refreshExpiry = (): Date => new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 3600 * 1000);

async function issueTokens(user: UserDoc, deviceId: string, family?: { familyId: string; rotatedFrom: Types.ObjectId }) {
  const refreshToken = randomToken(32);
  await RefreshToken.create({
    userId: user._id,
    familyId: family?.familyId ?? randomUUID(),
    tokenHash: hmacHash(refreshToken),
    deviceId,
    expiresAt: refreshExpiry(),
    rotatedFrom: family?.rotatedFrom ?? null,
  });
  const accessToken = await signAccessToken({
    userId: String(user._id),
    deviceId,
    mustChangePassword: user.mustChangePassword,
  });
  return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS } satisfies SessionTokens;
}

export interface RegisterInput {
  email: string;
  password: string;
  displayName: string;
  locale: 'hu' | 'en';
  deviceId: string;
  privacyPolicyVersion: string;
}

export async function registerUser(input: RegisterInput): Promise<{ user: PublicUser; tokens: SessionTokens }> {
  const global = await getGlobalSettings();
  if (!global.registrationOpen) throw new AppError('REGISTRATION_CLOSED', 403);
  if (input.privacyPolicyVersion !== env().PRIVACY_POLICY_VERSION) throw new AppError('PRIVACY_NOT_ACCEPTED', 400);
  let user: UserDoc;
  try {
    const created = await User.create({
      email: input.email,
      passwordHash: await hashPassword(input.password),
      displayName: input.displayName,
      locale: input.locale,
      termsAcceptedAt: new Date(),
      privacyPolicyVersion: input.privacyPolicyVersion,
    });
    user = created.toObject();
  } catch (error) {
    if ((error as { code?: number }).code === 11000) throw new AppError('EMAIL_TAKEN', 409);
    throw error;
  }
  return { user: toPublicUser(user), tokens: await issueTokens(user, input.deviceId) };
}

export async function loginUser(input: {
  email: string;
  password: string;
  deviceId: string;
}): Promise<{ user: PublicUser; tokens: SessionTokens }> {
  const user = await User.findOne({ email: input.email }).lean();
  // Always run one argon2 verification so that unknown e-mails are not distinguishable by timing.
  const valid = await verifyPassword(user?.passwordHash ?? (await getDummyHash()), input.password);
  if (!user || !valid) throw new AppError('INVALID_CREDENTIALS', 401);
  if (user.isDisabled) throw new AppError('ACCOUNT_DISABLED', 403);
  return { user: toPublicUser(user), tokens: await issueTokens(user, input.deviceId) };
}

/** Revokes every refresh token of one family (a single login chain). */
async function revokeFamily(familyId: string): Promise<void> {
  await RefreshToken.updateMany({ familyId, revokedAt: null }, { revokedAt: new Date() });
}

/**
 * Rotates a refresh token. Presenting an already rotated/revoked token means it was copied:
 * the whole family is revoked and the user has to log in again.
 */
export async function refreshSession(input: {
  refreshToken: string;
  deviceId: string;
}): Promise<{ user: PublicUser; tokens: SessionTokens }> {
  const tokenHash = hmacHash(input.refreshToken);
  const now = new Date();
  const rotated = await RefreshToken.findOneAndUpdate(
    { tokenHash, revokedAt: null, expiresAt: { $gt: now }, deviceId: input.deviceId },
    { revokedAt: now },
    { returnDocument: 'after' },
  ).lean();

  if (!rotated) {
    const known = await RefreshToken.findOne({ tokenHash }).lean();
    if (known && known.revokedAt) {
      await revokeFamily(known.familyId);
      await audit({
        actor: SYSTEM_ACTOR,
        action: 'auth.refresh_reuse_detected',
        targetType: 'user',
        targetId: String(known.userId),
        metadata: { familyId: known.familyId },
      });
      log.warn('refresh token reuse detected', { familyId: known.familyId });
      throw new AppError('TOKEN_REUSE_DETECTED', 401);
    }
    throw unauthenticated();
  }

  const user = await User.findById(rotated.userId).lean();
  if (!user) throw unauthenticated();
  if (user.isDisabled) {
    await revokeFamily(rotated.familyId);
    throw new AppError('ACCOUNT_DISABLED', 403);
  }
  const tokens = await issueTokens(user, input.deviceId, { familyId: rotated.familyId, rotatedFrom: rotated._id });
  return { user: toPublicUser(user), tokens };
}

/** Logout revokes the token family and invalidates the biometric binding of that device. */
export async function logoutSession(input: { refreshToken: string; deviceId?: string }): Promise<void> {
  const token = await RefreshToken.findOne({ tokenHash: hmacHash(input.refreshToken) }).lean();
  if (!token) return; // idempotent
  await revokeFamily(token.familyId);
  await BiometricBinding.deleteMany({ userId: token.userId, deviceId: input.deviceId ?? token.deviceId });
}

/** Revokes all sessions and biometric bindings of a user (password change / reset / disable). */
export async function revokeAllSessions(userId: Types.ObjectId): Promise<void> {
  await RefreshToken.updateMany({ userId, revokedAt: null }, { revokedAt: new Date() });
  await BiometricBinding.deleteMany({ userId });
}

export async function changePassword(
  user: UserDoc,
  input: { currentPassword: string; newPassword: string; deviceId: string },
): Promise<{ user: PublicUser; tokens: SessionTokens }> {
  if (!(await verifyPassword(user.passwordHash, input.currentPassword))) throw new AppError('INVALID_CREDENTIALS', 401);
  const updated = await User.findByIdAndUpdate(
    user._id,
    { passwordHash: await hashPassword(input.newPassword), mustChangePassword: false },
    { returnDocument: 'after' },
  ).lean();
  if (!updated) throw notFound();
  await revokeAllSessions(user._id);
  await audit({ actor: { type: 'user', id: String(user._id) }, action: 'auth.password_changed', targetType: 'user', targetId: String(user._id) });
  return { user: toPublicUser(updated), tokens: await issueTokens(updated, input.deviceId) };
}

/** Binds a random per-device secret (kept in the device's secure store) to the user. */
export async function enrollBiometric(user: UserDoc, input: { deviceId: string; secret: string }): Promise<void> {
  await BiometricBinding.findOneAndUpdate(
    { userId: user._id, deviceId: input.deviceId },
    { secretHash: hmacHash(input.secret), lastUsedAt: null },
    { upsert: true },
  );
}

export async function biometricLogin(input: {
  deviceId: string;
  secret: string;
}): Promise<{ user: PublicUser; tokens: SessionTokens }> {
  const binding = await BiometricBinding.findOne({ secretHash: hmacHash(input.secret), deviceId: input.deviceId }).lean();
  // Missing binding: the app silently falls back to the password screen.
  if (!binding) throw new AppError('INVALID_CREDENTIALS', 401);
  const user = await User.findById(binding.userId).lean();
  if (!user) throw new AppError('INVALID_CREDENTIALS', 401);
  if (user.isDisabled) throw new AppError('ACCOUNT_DISABLED', 403);
  if (user.mustChangePassword) throw new AppError('PASSWORD_CHANGE_REQUIRED', 403);
  await BiometricBinding.updateOne({ _id: binding._id }, { lastUsedAt: new Date() });
  return { user: toPublicUser(user), tokens: await issueTokens(user, input.deviceId) };
}

/** Admin reset: sets a random temporary password, forces a change at next login, revokes sessions. */
export async function adminResetPassword(userId: string, actor: Actor): Promise<{ temporaryPassword: string }> {
  const temporaryPassword = generateTemporaryPassword();
  const user = await User.findByIdAndUpdate(userId, {
    passwordHash: await hashPassword(temporaryPassword),
    mustChangePassword: true,
  }).lean();
  if (!user) throw notFound();
  await revokeAllSessions(user._id);
  await audit({ actor, action: 'user.password_reset', targetType: 'user', targetId: userId });
  return { temporaryPassword };
}

export async function acceptCurrentTerms(user: UserDoc, version: string): Promise<PublicUser> {
  if (version !== env().PRIVACY_POLICY_VERSION) throw new AppError('PRIVACY_NOT_ACCEPTED', 400);
  const updated = await User.findByIdAndUpdate(
    user._id,
    { privacyPolicyVersion: version, termsAcceptedAt: new Date() },
    { returnDocument: 'after' },
  ).lean();
  if (!updated) throw notFound();
  return toPublicUser(updated);
}

/** Registers (or moves) an Expo push token for the user's device. */
export async function savePushToken(user: UserDoc, input: { token: string; deviceId: string }): Promise<void> {
  // A token belongs to exactly one user: remove it from anyone else first (shared devices).
  await User.updateMany({ _id: { $ne: user._id }, 'pushTokens.token': input.token }, { $pull: { pushTokens: { token: input.token } } });
  await User.updateOne({ _id: user._id }, { $pull: { pushTokens: { deviceId: input.deviceId } } });
  await User.updateOne({ _id: user._id }, { $push: { pushTokens: { token: input.token, deviceId: input.deviceId, createdAt: new Date() } } });
}

export function assertNotDisabled(user: UserDoc): void {
  if (user.isDisabled) throw forbidden('ACCOUNT_DISABLED');
}
