'use client';

import Link from 'next/link';
import { api } from '@/lib/api';
import { fmtDate, num } from '@/lib/format';
import { logout } from '@/lib/session';
import { useAction, useLoad } from '@/lib/use-load';
import { Chip, ErrorNote, Ledger, Loading } from '@/components/ui';

interface Overview {
  totals: {
    users: number;
    workspaces: number;
    centers: number;
    teachers: number;
    active: number;
    trial: number;
    suspended: number;
    activeStudents: number;
    engaged: number;
  };
  workspaces: {
    id: string;
    name: string;
    type: 'CENTER' | 'TEACHER';
    status: 'TRIAL' | 'ACTIVE' | 'SUSPENDED';
    plan: string;
    trialEndsAt: string | null;
    createdAt: string;
    members: number;
    activeStudents: number;
    receipts30d: number;
  }[];
}

const STATUS = { TRIAL: 'تجريبي', ACTIVE: 'مفعّل', SUSPENDED: 'موقوف' } as const;

export default function PlatformPage() {
  const data = useLoad(() => api<Overview>('/platform/overview', { workspace: false }), []);
  const action = useAction();

  const setStatus = (id: string, status: string) =>
    void action.run(async () => {
      await api(`/platform/workspaces/${id}`, { method: 'PATCH', body: { status }, workspace: false });
      await data.reload();
    });

  const extend = (id: string) =>
    void action.run(async () => {
      await api(`/platform/workspaces/${id}`, {
        method: 'PATCH',
        body: { trialEndsAt: new Date(Date.now() + 14 * 86_400_000).toISOString(), status: 'TRIAL' },
        workspace: false,
      });
      await data.reload();
    });

  const t = data.data?.totals;

  return (
    <>
      <header className="top-bar">
        <Link href="/" className="brand" style={{ padding: 0 }}>حصّة</Link>
        <nav>
          <span style={{ color: '#fff' }}>إدارة المنصة</span>
          <button className="btn ghost" onClick={() => void logout()}>خروج</button>
        </nav>
      </header>
      <main className="main" style={{ margin: '0 auto' }}>
        <div className="stack">
          <h1>المشتركون</h1>
          <p className="muted">أرقام تشغيلية مجمعة فقط. بيانات الطلاب والمبالغ داخل كل مساحة لا تظهر هنا.</p>
          <ErrorNote error={data.error ?? action.error} onRetry={data.reload} />
          {data.loading && !t ? <Loading what="الإحصاءات" /> : null}
          {t ? (
            <section className="panel board">
              <div className="split-even">
                <div>
                  <h3>مساحات العمل</h3>
                  <div className="big-figure num">{num(t.workspaces)}</div>
                  <p>{num(t.centers)} سنتر و{num(t.teachers)} مدرس خاص. مفعّل {num(t.active)}، تجريبي {num(t.trial)}، موقوف {num(t.suspended)}.</p>
                </div>
                <div>
                  <h3>نشطة فعليًا</h3>
                  <div className="big-figure num">{num(t.engaged)}</div>
                  <p>أصدرت إيصالًا واحدًا على الأقل خلال 30 يومًا.</p>
                </div>
                <div>
                  <h3>الطلاب النشطون</h3>
                  <div className="big-figure num">{num(t.activeStudents)}</div>
                  <p>من إجمالي {num(t.users)} حساب مستخدم.</p>
                </div>
              </div>
            </section>
          ) : null}
          {data.data?.workspaces.length ? (
            <Ledger head={<tr><th>المساحة</th><th>النوع</th><th>الأعضاء</th><th>الطلاب</th><th>إيصالات 30 يومًا</th><th>الحالة</th><th /></tr>}>
              {data.data.workspaces.map((w) => (
                <tr key={w.id}>
                  <td>{w.name}<div className="faint">منذ {fmtDate(w.createdAt)}، خطة {w.plan}</div></td>
                  <td>{w.type === 'CENTER' ? 'سنتر' : 'مدرس'}</td>
                  <td className="num">{num(w.members)}</td>
                  <td className="num">{num(w.activeStudents)}</td>
                  <td className="num">{w.receipts30d ? num(w.receipts30d) : <span className="mark">0</span>}</td>
                  <td>
                    <Chip tone={w.status === 'ACTIVE' ? 'ok' : w.status === 'TRIAL' ? 'warn' : 'bad'}>{STATUS[w.status]}</Chip>
                    {w.status === 'TRIAL' && w.trialEndsAt ? <div className="faint">حتى {fmtDate(w.trialEndsAt)}</div> : null}
                  </td>
                  <td>
                    <div className="row" style={{ gap: '0.25rem' }}>
                      {w.status !== 'ACTIVE' ? <button className="btn quiet" disabled={action.busy} onClick={() => setStatus(w.id, 'ACTIVE')}>تفعيل</button> : null}
                      {w.status === 'TRIAL' ? <button className="btn ghost" disabled={action.busy} onClick={() => extend(w.id)}>مد التجربة 14 يومًا</button> : null}
                      {w.status !== 'SUSPENDED' ? (
                        <button className="btn ghost" disabled={action.busy} onClick={() => window.confirm(`إيقاف «${w.name}»؟ سيُمنع فريقها من الدخول.`) && setStatus(w.id, 'SUSPENDED')}>إيقاف</button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </Ledger>
          ) : null}
        </div>
      </main>
    </>
  );
}
