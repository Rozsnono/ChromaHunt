import { describe, expect, it } from 'vitest';
import { isEmail, isValidDisplayName, isValidPassword } from './validation';

describe('validation', () => {
  it('accepts and rejects e-mail addresses', () => {
    expect(isEmail(' anna@example.com ')).toBe(true);
    for (const bad of ['', 'anna', 'anna@', 'anna@x', 'a nna@x.com']) expect(isEmail(bad)).toBe(false);
  });
  it('enforces the password and name limits of the backend', () => {
    expect(isValidPassword('123456789')).toBe(false);
    expect(isValidPassword('1234567890')).toBe(true);
    expect(isValidPassword('x'.repeat(129))).toBe(false);
    expect(isValidDisplayName('A')).toBe(false);
    expect(isValidDisplayName(' Al ')).toBe(true);
  });
});
