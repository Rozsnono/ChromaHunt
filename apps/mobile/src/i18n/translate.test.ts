import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@chromahunt/shared';
import { en } from './en';
import { hu } from './hu';
import { pickLanguage, translate, translateError } from './translate';

describe('i18n', () => {
  it('has the same keys in Hungarian and English and no empty strings', () => {
    expect(Object.keys(hu).sort()).toEqual(Object.keys(en).sort());
    for (const [key, value] of [...Object.entries(en), ...Object.entries(hu)]) expect(value.trim(), key).not.toBe('');
  });

  it('keeps interpolation placeholders consistent between languages', () => {
    const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of Object.keys(en) as (keyof typeof en)[]) expect(placeholders(hu[key]), key).toEqual(placeholders(en[key]));
  });

  it('translates every backend error code', () => {
    for (const code of ERROR_CODES) {
      expect(`error.${code}` in en, code).toBe(true);
      expect(translateError('hu', code)).not.toBe(translateError('hu', 'DOES_NOT_EXIST'));
    }
  });

  it('interpolates variables and falls back for unknown codes', () => {
    expect(translate('en', 'profile.version', { version: '1.2.3' })).toBe('Version 1.2.3');
    expect(translateError('en', 'SOMETHING_NEW')).toBe(en['error.UNKNOWN']);
  });

  it('defaults to Hungarian and honours English devices', () => {
    expect(pickLanguage('hu')).toBe('hu');
    expect(pickLanguage('de')).toBe('hu');
    expect(pickLanguage('en-GB')).toBe('en');
    expect(pickLanguage(undefined)).toBe('hu');
  });
});
