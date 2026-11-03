/** Invite code helpers (pure, unit tested). */

/** Extracts the code from `chromahunt://join?code=XXXX`, a bare code, or any text containing one. */
export function parseInviteCode(input: string): string | null {
  const trimmed = input.trim();
  const fromLink = /[?&]code=([A-Za-z0-9-]{6,64})/.exec(trimmed);
  const candidate = (fromLink?.[1] ?? trimmed).toUpperCase().replace(/[\s-]/g, '');
  return /^[0-9A-Z]{6,64}$/.test(candidate) ? candidate : null;
}
