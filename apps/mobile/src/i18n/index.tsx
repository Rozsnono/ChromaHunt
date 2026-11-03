import * as Localization from 'expo-localization';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { prefs } from '@/lib/storage';
import { pickLanguage, translate, translateError, type Key, type Lang } from './translate';

export type { Key, Lang };

const LANG_PREF = 'ch_lang';

interface I18nValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: Key, vars?: Record<string, string | number>) => string;
  tError: (code: string) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => pickLanguage(Localization.getLocales()[0]?.languageCode));

  useEffect(() => {
    prefs
      .get(LANG_PREF)
      .then((stored) => {
        if (stored === 'hu' || stored === 'en') setLangState(stored);
      })
      .catch(() => undefined);
  }, []);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    prefs.set(LANG_PREF, next).catch(() => undefined);
  }, []);

  const value = useMemo<I18nValue>(
    () => ({ lang, setLang, t: (key, vars) => translate(lang, key, vars), tError: (code) => translateError(lang, code) }),
    [lang, setLang],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}
