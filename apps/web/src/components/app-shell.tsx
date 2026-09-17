'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { ROLE_LABEL } from '@/lib/format';
import { logout, useSession } from '@/lib/session';
import { Loading } from './ui';

interface NavItem {
  href: string;
  label: string;
  perm?: string | string[];
  group: 'day' | 'money' | 'teach' | 'admin';
}

const NAV: NavItem[] = [
  { href: '/app', label: 'يوم العمل', group: 'day' },
  { href: '/app/reception', label: 'الحضور عند الباب', perm: 'attendance.record', group: 'day' },
  { href: '/app/students', label: 'الطلاب', perm: 'students.read', group: 'day' },
  { href: '/app/schedule', label: 'المجموعات والجدول', perm: 'academics.read', group: 'day' },
  { href: '/app/cash', label: 'الخزنة والتحصيل', perm: 'finance.collect', group: 'money' },
  { href: '/app/dues', label: 'المتأخرات', perm: 'finance.dues', group: 'money' },
  { href: '/app/approvals', label: 'الموافقات', perm: 'finance.cancel.approve', group: 'money' },
  { href: '/app/reports', label: 'التقارير', perm: 'finance.reports', group: 'money' },
  { href: '/app/settlements', label: 'التسويات', perm: ['settlements.read.own', 'settlements.manage'], group: 'money' },
  { href: '/app/exams', label: 'الامتحانات', perm: 'exams.grade', group: 'teach' },
  { href: '/app/staff', label: 'الفريق والسجل', perm: 'staff.manage', group: 'admin' },
  { href: '/app/settings', label: 'الإعدادات', perm: 'workspace.manage', group: 'admin' },
];

const GROUPS: Record<NavItem['group'], string> = { day: '', money: 'المال', teach: 'التعليم', admin: 'الإدارة' };

export function AppShell({ children }: { children: ReactNode }) {
  const { me, current, loading, can, switchWorkspace } = useSession();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);

  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!me) return;
    const load = () =>
      api<{ unread: number }>('/notifications', { workspace: false })
        .then((r) => setUnread(r.unread))
        .catch(() => undefined);
    void load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [me]);

  if (loading) return <main className="main"><Loading what="حسابك" /></main>;
  if (!me) return null;
  if (!current) {
    if (typeof window !== 'undefined') window.location.replace(me.children ? '/family' : '/start');
    return null;
  }

  const items = NAV.filter((i) => !i.perm || (Array.isArray(i.perm) ? i.perm.some(can) : can(i.perm)));
  const isActive = (href: string) => (href === '/app' ? path === '/app' : path.startsWith(href));
  const trialDays = current.workspace.trialEndsAt
    ? Math.ceil((new Date(current.workspace.trialEndsAt).getTime() - Date.now()) / 86_400_000)
    : null;

  return (
    <div className="shell">
      <div className="mobile-bar no-print">
        <Link href="/app" className="brand">حصّة</Link>
        <button className="btn ghost" style={{ color: '#fff' }} onClick={() => setOpen(true)} aria-expanded={open}>القائمة</button>
      </div>
      <aside className="rail no-print" data-open={open} aria-label="التنقل">
        <div className="row-between">
          <Link href="/app" className="brand">حصّة</Link>
          {open ? <button className="btn ghost" onClick={() => setOpen(false)}>إغلاق</button> : null}
        </div>

        {me.memberships.length > 1 ? (
          <label>
            <span className="sr-only">مساحة العمل</span>
            <select className="ws-switch" value={current.workspace.id} onChange={(e) => switchWorkspace(e.target.value)}>
              {me.memberships.map((m) => (
                <option key={m.workspace.id} value={m.workspace.id}>{m.workspace.name}</option>
              ))}
            </select>
          </label>
        ) : (
          <div style={{ paddingInline: '0.6rem', color: '#fff', fontWeight: 600 }}>{current.workspace.name}</div>
        )}

        <nav className="nav">
          {(Object.keys(GROUPS) as NavItem['group'][]).map((g) => {
            const list = items.filter((i) => i.group === g);
            if (!list.length) return null;
            return (
              <div key={g} className="nav">
                {GROUPS[g] ? <div className="nav-group">{GROUPS[g]}</div> : null}
                {list.map((i) => (
                  <Link key={i.href} href={i.href} aria-current={isActive(i.href) ? 'page' : undefined}>
                    {i.label}
                  </Link>
                ))}
              </div>
            );
          })}
          <div className="nav-group">حسابي</div>
          <Link href="/notifications" aria-current={path === '/notifications' ? 'page' : undefined}>
            الإشعارات {unread ? <span className="count">{unread}</span> : null}
          </Link>
          {me.children ? <Link href="/family">أبنائي</Link> : null}
          {me.user.isPlatformAdmin ? <Link href="/platform">إدارة المنصة</Link> : null}
          <Link href="/start">مساحة عمل جديدة</Link>
        </nav>

        <div className="rail-foot">
          {current.workspace.status === 'TRIAL' && trialDays !== null ? (
            <div className="note warn" style={{ color: '#5c4a00' }}>
              {trialDays > 0 ? `باقي ${trialDays} يوم في الفترة التجريبية` : 'انتهت الفترة التجريبية'}
            </div>
          ) : null}
          <div style={{ color: '#fff' }}>{me.user.name}</div>
          <div style={{ color: '#9fb8ae' }}>{ROLE_LABEL[current.me.role] ?? current.me.role}</div>
          <button className="btn ghost" onClick={() => void logout()}>تسجيل الخروج</button>
        </div>
      </aside>
      <main className="main" id="main">{children}</main>
    </div>
  );
}

/** غلاف صفحة يتطلب صلاحية (الخادم يفرضها أيضًا؛ هذا للتجربة فقط) */
export function Guard({ perm, children }: { perm: string; children: ReactNode }) {
  const { can } = useSession();
  if (!can(perm)) {
    return <div className="note warn">هذه الصفحة غير متاحة لدورك في مساحة العمل الحالية.</div>;
  }
  return <>{children}</>;
}
