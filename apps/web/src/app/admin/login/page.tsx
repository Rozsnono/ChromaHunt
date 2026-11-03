'use client';
import { motion } from 'framer-motion';
import { Languages, LockKeyhole, Palette } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button, TextInput, Card } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

export default function AdminLogin() {
  const { t, tError, lang, setLang } = useI18n();
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/admin/session', { body: { password } });
      router.replace('/admin');
      router.refresh();
    } catch (e) {
      setError(tError(e instanceof ApiError ? e.code : 'INTERNAL_ERROR'));
      setBusy(false);
    }
  }

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden p-4">
      <motion.div aria-hidden className="absolute -top-32 -right-24 size-96 rounded-full bg-brand-400/30 blur-3xl" animate={{ scale: [1, 1.15, 1] }} transition={{ duration: 9, repeat: Infinity }} />
      <motion.div aria-hidden className="absolute -bottom-32 -left-24 size-96 rounded-full bg-pink-400/20 blur-3xl" animate={{ scale: [1.1, 1, 1.1] }} transition={{ duration: 11, repeat: Infinity }} />
      <button
        onClick={() => setLang(lang === 'hu' ? 'en' : 'hu')}
        className="absolute top-4 right-4 flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-slate-200/70 dark:hover:bg-slate-800"
      >
        <Languages className="size-4" aria-hidden />
        {lang === 'hu' ? 'English' : 'Magyar'}
      </button>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="relative w-full max-w-sm">
        <Card className="space-y-6 p-6 sm:p-8">
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="rounded-2xl bg-brand-600 p-3 text-white shadow-lg shadow-brand-600/30">
              <Palette className="size-7" aria-hidden />
            </div>
            <div>
              <h1 className="text-xl font-semibold">ChromaHunt</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">{t('login.subtitle')}</p>
            </div>
          </div>
          <form onSubmit={submit} className="space-y-4">
            <TextInput
              label={t('login.password')}
              type="password"
              autoComplete="current-password"
              autoFocus
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={error ?? undefined}
            />
            <Button type="submit" className="w-full" loading={busy} icon={<LockKeyhole className="size-4" aria-hidden />}>
              {t('login.submit')}
            </Button>
          </form>
        </Card>
      </motion.div>
    </main>
  );
}
