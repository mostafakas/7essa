'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { PLATFORM_ROLE_LABEL } from '@/lib/format';
import { logout, useSession, type PlatformRole } from '@/lib/session';
import { Loading } from './ui';

const NAV = [
  { href: '/platform', label: 'لوحة المؤشرات' },
  { href: '/platform/workspaces', label: 'السناتر والمدرسون' },
  { href: '/platform/users', label: 'المستخدمون' },
  { href: '/platform/plans', label: 'الخطط والأسعار' },
  { href: '/platform/billing', label: 'المدفوعات' },
  { href: '/platform/announcements', label: 'الإعلانات' },
  { href: '/platform/audit', label: 'سجل العمليات' },
  { href: '/platform/settings', label: 'الإعدادات وصحة النظام' },
];

interface PlatformValue {
  role: PlatformRole;
  can: (permission: string) => boolean;
}

const Ctx = createContext<PlatformValue | null>(null);

export function usePlatform() {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePlatform خارج PlatformShell');
  return v;
}

export function PlatformShell({ children }: { children: ReactNode }) {
  const { me, loading } = useSession();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [who, setWho] = useState<{ role: PlatformRole; permissions: string[] } | null>(null);
  const [denied, setDenied] = useState<string | null>(null);

  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!me) return;
    api<{ role: PlatformRole; permissions: string[] }>('/platform/whoami', { workspace: false })
      .then(setWho)
      .catch((e: unknown) => setDenied(e instanceof Error ? e.message : 'غير مسموح'));
  }, [me]);

  const value = useMemo<PlatformValue | null>(
    () => (who ? { role: who.role, can: (p) => who.permissions.includes(p) } : null),
    [who],
  );

  if (loading || (!who && !denied)) return <main className="main"><Loading what="لوحة الإدارة" /></main>;
  if (!me) return null;
  if (denied || !value) {
    return (
      <main className="narrow stack">
        <h1>لوحة إدارة المنصة</h1>
        <div className="note error">{denied ?? 'غير مسموح'}</div>
        <div className="row"><Link className="btn quiet" href="/">الصفحة الرئيسية</Link></div>
      </main>
    );
  }

  const isActive = (href: string) => (href === '/platform' ? path === '/platform' : path.startsWith(href));
  return (
    <Ctx.Provider value={value}>
      <div className="shell">
        <div className="mobile-bar no-print">
          <Link href="/platform" className="brand">حصّة</Link>
          <button className="btn ghost" style={{ color: '#fff' }} onClick={() => setOpen(true)} aria-expanded={open}>القائمة</button>
        </div>
        <aside className="rail no-print" data-open={open} aria-label="إدارة المنصة">
          <div className="row-between">
            <Link href="/platform" className="brand">حصّة</Link>
            {open ? <button className="btn ghost" onClick={() => setOpen(false)}>إغلاق</button> : null}
          </div>
          <div style={{ paddingInline: '0.6rem', color: '#fff', fontWeight: 600 }}>إدارة المنصة</div>
          <nav className="nav">
            {NAV.map((i) => (
              <Link key={i.href} href={i.href} aria-current={isActive(i.href) ? 'page' : undefined}>{i.label}</Link>
            ))}
            <div className="nav-group">حسابي</div>
            <Link href="/account">كلمة المرور</Link>
            {me.memberships.length ? <Link href="/app">مساحة العمل</Link> : null}
            {me.children ? <Link href="/family">الأبناء</Link> : null}
          </nav>
          <div className="rail-foot">
            <div style={{ color: '#fff' }}>{me.user.name}</div>
            <div style={{ color: '#9fb8ae' }}>{PLATFORM_ROLE_LABEL[value.role]}</div>
            <button className="btn ghost" onClick={() => void logout()}>تسجيل الخروج</button>
          </div>
        </aside>
        <main className="main" id="main">{children}</main>
      </div>
    </Ctx.Provider>
  );
}

/** زر أو قسم لا يظهر إلا لمن يملك الصلاحية (الخادم يفرضها أيضًا) */
export function IfCan({ perm, children }: { perm: string; children: ReactNode }) {
  const { can } = usePlatform();
  return can(perm) ? <>{children}</> : null;
}

/** ترقيم الصفحات */
export function Pager({ page, total, pageSize, onPage }: { page: number; total: number; pageSize: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="row" style={{ marginTop: '1rem' }}>
      <button className="btn quiet" disabled={page <= 1} onClick={() => onPage(page - 1)}>السابق</button>
      <span className="num">{page} / {pages}</span>
      <button className="btn quiet" disabled={page >= pages} onClick={() => onPage(page + 1)}>التالي</button>
    </div>
  );
}
