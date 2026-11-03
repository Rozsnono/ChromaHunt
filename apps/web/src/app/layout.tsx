import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui';
import { I18nProvider, type Lang } from '@/lib/i18n';
import './globals.css';

export const metadata: Metadata = {
  title: 'ChromaHunt Admin',
  description: 'ChromaHunt administration panel',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const lang: Lang = (await cookies()).get('ch_lang')?.value === 'en' ? 'en' : 'hu';
  return (
    <html lang={lang} suppressHydrationWarning>
      <head>
        {/* Applies the stored (or OS) theme before first paint to avoid a light flash. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('ch_theme');if(t?t==='dark':matchMedia('(prefers-color-scheme: dark)').matches)document.documentElement.classList.add('dark')}catch(e){}",
          }}
        />
      </head>
      <body>
        <I18nProvider initialLang={lang}>
          <ToastProvider>{children}</ToastProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
