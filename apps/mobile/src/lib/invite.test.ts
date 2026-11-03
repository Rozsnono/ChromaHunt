import { describe, expect, it } from 'vitest';
import { parseInviteCode } from './invite';

describe('parseInviteCode', () => {
  it('reads codes from QR links and typed input', () => {
    expect(parseInviteCode('chromahunt://join?code=ABCD1234')).toBe('ABCD1234');
    expect(parseInviteCode(' abcd-1234 ')).toBe('ABCD1234');
    expect(parseInviteCode('https://x.test/j?foo=1&code=zz99zz99')).toBe('ZZ99ZZ99');
  });
  it('rejects garbage', () => {
    for (const bad of ['', 'abc', 'hello world!', 'chromahunt://join']) expect(parseInviteCode(bad)).toBeNull();
  });
});
