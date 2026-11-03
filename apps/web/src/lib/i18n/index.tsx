'use client';
/**
 * Key based i18n (Hungarian / English). `en` is the source of truth for the key set and
 * `hu` must be complete (enforced by the type), so no screen ever shows a raw key.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { en, type Key } from './en';
import { hu } from './hu';

export type Lang = 'hu' | 'en';
export type { Key };

const dictionaries: Record<Lang, Record<Key, string>> = { en, hu };

interface I18nValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: Key, vars?: Record<string, string | number>) => string;
  /** Localized text of an API error code (`error.<CODE>`), with a generic fallback. */
  tError: (code: string) => string;
  formatDate: (value: string | Date) => string;
  formatNumber: (value: number) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ initialLang, children }: { initialLang: Lang; children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    document.cookie = `ch_lang=${next}; path=/; max-age=31536000; samesite=strict`;
    document.documentElement.lang = next;
  }, []);

  const value = useMemo<I18nValue>(() => {
    const dict = dictionaries[lang];
    const t: I18nValue['t'] = (key, vars) =>
      (dict[key] ?? en[key]).replace(/\{(\w+)\}/g, (_, name: string) => String(vars?.[name] ?? `{${name}}`));
    return {
      lang,
      setLang,
      t,
      tError: (code) => {
        const key = `error.${code}` as Key;
        return key in dict ? dict[key] : dict['error.UNKNOWN'];
      },
      formatDate: (v) =>
        new Intl.DateTimeFormat(lang === 'hu' ? 'hu-HU' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(v)),
      formatNumber: (n) => new Intl.NumberFormat(lang === 'hu' ? 'hu-HU' : 'en-GB').format(n),
    };
  }, [lang, setLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}
