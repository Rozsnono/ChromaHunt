/**
 * Authentication state for the whole app: sign in/up, biometric unlock, forced password change,
 * privacy re-acceptance and sign out. The API client lives here so every screen shares one
 * single-flight token refresh.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useI18n } from '@/i18n';
import { api, onSignedOut } from './api';
import { ApiError, type ApiClient } from './api-core';
import * as biometric from './biometric';
import { getDeviceId, tokenStore } from './storage';
import { unregisterFromPush } from './push';
import { clearQueue } from './upload-queue';
import type { AuthResult, PublicUser } from './types';

type Status = 'loading' | 'signedOut' | 'signedIn';

interface Meta {
  privacyPolicyVersion: string;
  registrationOpen: boolean;
}

interface SessionValue {
  status: Status;
  user: PublicUser | null;
  api: ApiClient;
  meta: Meta | null;
  biometricReady: boolean;
  /** True right after a password login on a device that was not offered biometrics yet. */
  biometricOffer: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (input: { email: string; password: string; displayName: string }) => Promise<void>;
  loginWithBiometrics: () => Promise<void>;
  logout: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  acceptTerms: () => Promise<void>;
  deleteAccount: (password: string) => Promise<void>;
  refreshUser: () => Promise<void>;
  enableBiometrics: () => Promise<boolean>;
  disableBiometrics: () => Promise<void>;
  dismissBiometricOffer: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const { lang, t } = useI18n();
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<PublicUser | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [biometricReady, setBiometricReady] = useState(false);
  const [biometricOffer, setBiometricOffer] = useState(false);

  const resetToSignedOut = useCallback(() => {
    setUser(null);
    setStatus('signedOut');
  }, []);
  useEffect(() => onSignedOut(resetToSignedOut), [resetToSignedOut]);

  const refreshBiometricReady = useCallback(async () => {
    setBiometricReady((await biometric.isBiometricAvailable()) && (await biometric.isBiometricEnabled()));
  }, []);

  // Boot: restore the session from the stored tokens.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      api.request<Meta>('/api/meta', { auth: false }).then((m) => !cancelled && setMeta(m)).catch(() => undefined);
      await refreshBiometricReady();
      const tokens = await tokenStore.load();
      if (!tokens) return !cancelled && setStatus('signedOut');
      try {
        const me = await api.request<PublicUser>('/api/me');
        if (!cancelled) {
          setUser(me);
          setStatus('signedIn');
        }
      } catch (error) {
        // Offline at start-up keeps the session; only a definitive rejection signs out.
        if (cancelled) return;
        if (error instanceof ApiError && error.isTransient) setStatus('signedIn');
        else setStatus('signedOut');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshBiometricReady]);

  const finishLogin = useCallback(
    async (result: AuthResult, passwordLogin: boolean) => {
      setUser(result.user);
      setStatus('signedIn');
      if (passwordLogin && (await biometric.isBiometricAvailable()) && !(await biometric.wasOffered())) setBiometricOffer(true);
      await refreshBiometricReady();
    },
    [refreshBiometricReady],
  );

  const value = useMemo<SessionValue>(
    () => ({
      status,
      user,
      api,
      meta,
      biometricReady,
      biometricOffer,
      login: async (email, password) => finishLogin(await api.authenticate('/api/auth/login', { email, password }), true),
      register: async (input) => {
        const current = meta ?? (await api.request<Meta>('/api/meta', { auth: false }));
        setMeta(current);
        await finishLogin(
          await api.authenticate('/api/auth/register', {
            ...input,
            locale: lang,
            acceptedPrivacy: true,
            privacyPolicyVersion: current.privacyPolicyVersion,
          }),
          true,
        );
      },
      loginWithBiometrics: async () => {
        const secret = await biometric.readSecret(t('biometric.prompt'));
        if (!secret) throw new ApiError('BIOMETRIC_UNAVAILABLE', 0);
        try {
          await finishLogin(await api.authenticate('/api/auth/biometric/login', { secret }), false);
        } catch (error) {
          // The server no longer knows this device secret (password change, reset...): forget it.
          if (error instanceof ApiError && error.status === 401) await biometric.clearSecret();
          await refreshBiometricReady();
          throw error;
        }
      },
      deleteAccount: async (password) => {
        await api.request('/api/me', { method: 'DELETE', body: { password } });
        await clearQueue().catch(() => undefined);
        await tokenStore.clear();
        await biometric.clearSecret();
        await refreshBiometricReady();
        resetToSignedOut();
      },
      logout: async () => {
        await unregisterFromPush();
        await clearQueue().catch(() => undefined); // photos must not outlive the session
        await api.signOut();
        await biometric.clearSecret();
        await refreshBiometricReady();
        setBiometricOffer(false);
        resetToSignedOut();
      },
      changePassword: async (currentPassword, newPassword) => {
        const result = await api.authenticate('/api/auth/change-password', { currentPassword, newPassword });
        await biometric.clearSecret(); // the server dropped all bindings
        await refreshBiometricReady();
        setUser(result.user);
      },
      acceptTerms: async () => {
        const version = meta?.privacyPolicyVersion ?? (await api.request<Meta>('/api/meta', { auth: false })).privacyPolicyVersion;
        setUser(await api.request<PublicUser>('/api/me/terms', { body: { privacyPolicyVersion: version } }));
      },
      refreshUser: async () => setUser(await api.request<PublicUser>('/api/me')),
      enableBiometrics: async () => {
        const secret = await biometric.createSecret(t('biometric.prompt'));
        if (!secret) return false;
        try {
          await api.request('/api/auth/biometric/enroll', { body: { deviceId: await getDeviceId(), secret } });
        } catch {
          await biometric.clearSecret();
          return false;
        }
        await biometric.markOffered();
        setBiometricOffer(false);
        await refreshBiometricReady();
        return true;
      },
      disableBiometrics: async () => {
        await biometric.clearSecret();
        await refreshBiometricReady();
      },
      dismissBiometricOffer: async () => {
        await biometric.markOffered();
        setBiometricOffer(false);
      },
    }),
    [status, user, meta, biometricReady, biometricOffer, finishLogin, lang, t, refreshBiometricReady, resetToSignedOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}
