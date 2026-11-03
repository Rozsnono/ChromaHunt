/** Platform independent translation helpers (unit tested). */
import { en, type Key } from './en';
import { hu } from './hu';

export type Lang = 'hu' | 'en';
export type { Key };

const dictionaries: Record<Lang, Record<Key, string>> = { en, hu };

export function translate(lang: Lang, key: Key, vars?: Record<string, string | number>): string {
  return (dictionaries[lang][key] ?? en[key]).replace(/\{(\w+)\}/g, (_, name: string) => String(vars?.[name] ?? `{${name}}`));
}

/** Localised text for an API error code; unknown codes fall back to a generic message. */
export function translateError(lang: Lang, code: string): string {
  const key = `error.${code}` as Key;
  return key in dictionaries[lang] ? dictionaries[lang][key] : dictionaries[lang]['error.UNKNOWN'];
}

/** Hungarian is the default; English is used when the device language is English. */
export function pickLanguage(deviceLanguageCode: string | null | undefined): Lang {
  return deviceLanguageCode?.toLowerCase().startsWith('en') ? 'en' : 'hu';
}
