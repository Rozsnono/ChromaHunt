'use client';
import { AnimatePresence, motion } from 'framer-motion';
import {
  HardDrive,
  Languages,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Palette,
  ScrollText,
  Settings,
  ShieldCheck,
  Sun,
  Users,
  UsersRound,
  X,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { useI18n, type Key } from '@/lib/i18n';
import { cn } from './ui';

const NAV: Array<{ href: string; label: Key; icon: LucideIcon }> = [
  { href: '/admin', label: 'nav.dashboard', icon: LayoutDashboard },
  { href: '/admin/groups', label: 'nav.groups', icon: UsersRound },
  { href: '/admin/users', label: 'nav.users', icon: Users },
  { href: '/admin/permissions', label: 'nav.permissions', icon: ShieldCheck },
  { href: '/admin/palette', label: 'nav.palette', icon: Palette },
  { href: '/admin/storage', label: 'nav.storage', icon: HardDrive },
  { href: '/admin/settings', label: 'nav.settings', icon: Settings },
  { href: '/admin/audit', label: 'nav.audit', icon: ScrollText },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useI18n();
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1" aria-label="Main">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = href === '/admin' ? pathname === '/admin' : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
              active ? 'text-brand-700 dark:text-brand-200' : 'text-slate-600 hover:bg-slate-200/60 dark:text-slate-300 dark:hover:bg-slate-800',
            )}
          >
            {active && (
              <motion.span layoutId="nav-active" className="absolute inset-0 rounded-lg bg-brand-50 dark:bg-indigo-950" transition={{ type: 'spring', stiffness: 400, damping: 34 }} />
            )}
            <Icon className="relative size-[18px]" aria-hidden />
            <span className="relative">{t(label)}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-3 py-1">
      <div className="rounded-lg bg-brand-600 p-1.5 text-white">
        <Palette className="size-5" aria-hidden />
      </div>
      <span className="text-lg font-semibold tracking-tight">ChromaHunt</span>
    </div>
  );
}

/** Dark mode lives on `<html class="dark">` (set before first paint by the inline script in the root layout). */
function useDarkMode(): [boolean, (dark: boolean) => void] {
  const dark = useSyncExternalStore(
    (notify) => {
      const observer = new MutationObserver(notify);
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
      return () => observer.disconnect();
    },
    () => document.documentElement.classList.contains('dark'),
    () => false,
  );
  const set = (next: boolean) => {
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem('ch_theme', next ? 'dark' : 'light');
    } catch {
      /* storage unavailable: the theme is just not remembered */
    }
  };
  return [dark, set];
}

export function AdminShell({ children }: { children: ReactNode }) {
  const { t, lang, setLang } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [dark, setDark] = useDarkMode();

  async function logout() {
    await api('/api/admin/session', { method: 'DELETE' }).catch(() => undefined);
    router.replace('/admin/login');
    router.refresh();
  }

  const tools = (
    <div className="mt-auto flex flex-col gap-1 border-t border-slate-200 pt-3 dark:border-slate-800">
      <button onClick={() => setLang(lang === 'hu' ? 'en' : 'hu')} className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-slate-600 hover:bg-slate-200/60 dark:text-slate-300 dark:hover:bg-slate-800">
        <Languages className="size-[18px]" aria-hidden />
        {lang === 'hu' ? 'English' : 'Magyar'}
      </button>
      <button
        onClick={() => setDark(!dark)}
        className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-slate-600 hover:bg-slate-200/60 dark:text-slate-300 dark:hover:bg-slate-800"
      >
        {dark ? <Sun className="size-[18px]" aria-hidden /> : <Moon className="size-[18px]" aria-hidden />}
        {dark ? t('shell.light') : t('shell.dark')}
      </button>
      <button onClick={logout} className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40">
        <LogOut className="size-[18px]" aria-hidden />
        {t('shell.logout')}
      </button>
    </div>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_1fr]">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh flex-col gap-6 border-r border-slate-200 bg-white p-4 lg:flex dark:border-slate-800 dark:bg-slate-900">
        <Brand />
        <NavLinks />
        {tools}
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur lg:hidden dark:border-slate-800 dark:bg-slate-900/90">
        <Brand />
        <button onClick={() => setOpen(true)} aria-label={t('shell.menu')} className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-800">
          <Menu className="size-5" />
        </button>
      </header>

      <AnimatePresence>
        {open && (
          <motion.div className="fixed inset-0 z-50 lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="absolute inset-0 bg-slate-950/50" onClick={() => setOpen(false)} aria-hidden />
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', stiffness: 340, damping: 34 }}
              className="absolute inset-y-0 left-0 flex w-72 flex-col gap-6 bg-white p-4 dark:bg-slate-900"
            >
              <div className="flex items-center justify-between">
                <Brand />
                <button onClick={() => setOpen(false)} aria-label={t('common.close')} className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-800">
                  <X className="size-5" />
                </button>
              </div>
              <NavLinks onNavigate={() => setOpen(false)} />
              {tools}
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="min-w-0 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
