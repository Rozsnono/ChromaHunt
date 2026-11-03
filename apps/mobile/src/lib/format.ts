/** Date/time formatting helpers (device timezone). */
export function formatTime(iso: string, lang: 'hu' | 'en'): string {
  return new Intl.DateTimeFormat(lang === 'hu' ? 'hu-HU' : 'en-GB', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

export function formatDateTime(iso: string, lang: 'hu' | 'en'): string {
  return new Intl.DateTimeFormat(lang === 'hu' ? 'hu-HU' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}

/** `3 ó 12 p` / `3h 12m` style remaining time; empty when the time has passed. */
export function formatRemaining(ms: number, lang: 'hu' | 'en'): string {
  if (ms <= 0) return '';
  const totalMinutes = Math.floor(ms / 60000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  const [hs, ms2] = lang === 'hu' ? ['ó', 'p'] : ['h', 'm'];
  return h > 0 ? `${h} ${hs} ${m} ${ms2}` : `${m} ${ms2}`;
}
