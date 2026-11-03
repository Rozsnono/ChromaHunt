import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AdminShell } from '@/components/admin-shell';
import { ADMIN_COOKIE } from '@/server/auth';
import { verifyAdminSession } from '@/server/tokens';

/** Server side guard: without a valid admin session cookie nothing of the panel is rendered. */
export default async function PanelLayout({ children }: { children: ReactNode }) {
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!token || !(await verifyAdminSession(token))) redirect('/admin/login');
  return <AdminShell>{children}</AdminShell>;
}
