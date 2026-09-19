'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { logout, useSession } from '@/lib/session';
import { AnnouncementsBar } from './announcements';
import { Loading } from './ui';

const LINKS = [
  { href: '/family', label: 'الأبناء' },
  { href: '/family/schedule', label: 'الجدول' },
  { href: '/family/exams', label: 'الامتحانات' },
  { href: '/notifications', label: 'الإشعارات' },
];

export function FamilyShell({ children }: { children: ReactNode }) {
  const { me, loading } = useSession();
  const path = usePathname();
  if (loading) return <main className="narrow"><Loading what="حسابك" /></main>;
  if (!me) return null;
  return (
    <>
      <header className="top-bar no-print">
        <Link href="/family" className="brand" style={{ padding: 0 }}>حصّة</Link>
        <nav aria-label="بوابة الأسرة">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} aria-current={(l.href === '/family' ? path === l.href : path.startsWith(l.href)) ? 'page' : undefined}>
              {l.label}
            </Link>
          ))}
          {me.memberships.length ? <Link href="/app">مساحة العمل</Link> : null}
          {me.user.platformRole ? <Link href="/platform">إدارة المنصة</Link> : null}
          <Link href="/account" aria-current={path === '/account' ? 'page' : undefined}>حسابي</Link>
          <button className="btn ghost" onClick={() => void logout()}>خروج</button>
        </nav>
      </header>
      <main className="narrow">
        <AnnouncementsBar />
        {children}
      </main>
    </>
  );
}
