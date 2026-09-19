'use client';

import Link from 'next/link';
import { api } from '@/lib/api';
import { ACCESS_LABEL, ACCESS_TONE, egp, fmtDate, fmtDateTime, fmtMonth, num } from '@/lib/format';
import { actionLabel } from '@/lib/platform';
import type { AccessReason } from '@/lib/session';
import { useLoad } from '@/lib/use-load';
import { Chip, Empty, ErrorNote, Ledger, Loading, PageHead } from '@/components/ui';

interface Overview {
  workspaces: { total: number; byReason: Record<AccessReason, number>; byType: { CENTER: number; TEACHER: number } };
  users: { total: number; admins: number; locked: number; noPassword: number; active30d: number };
  activeStudents: number;
  engaged: number;
  mrr: string;
  revenue: { month: string; total: string; count: number }[];
  signups: { month: string; n: number }[];
  trialsEnding: { id: string; name: string; until: string | null; daysLeft: number | null }[];
  renewals: { id: string; name: string; until: string | null; reason: AccessReason; daysLeft: number | null }[];
  recent: { id: string; action: string; createdAt: string; actor: string; workspace: string | null }[];
}

/** آخر 12 شهرًا بترتيبها حتى تظهر الأشهر الفارغة */
function lastMonths(n: number) {
  const out: string[] = [];
  const d = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    out.push(`${m.getUTCFullYear()}-${String(m.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

function Bars({ data, format }: { data: { month: string; value: number }[]; format: (v: number) => string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <>
      <div className="bars" role="img" aria-label="رسم بياني شهري">
        {data.map((d, i) => (
          <div key={d.month} className={i === data.length - 1 ? 'today' : undefined} style={{ height: `${(d.value / max) * 100}%` }} title={`${fmtMonth(d.month)}: ${format(d.value)}`} />
        ))}
      </div>
      <div className="bars-labels">{data.map((d) => <span key={d.month}>{d.month.slice(5)}</span>)}</div>
    </>
  );
}

export default function PlatformOverview() {
  const o = useLoad(() => api<Overview>('/platform/overview', { workspace: false }), []);
  const d = o.data;
  const months = lastMonths(12);
  const rev = new Map(d?.revenue.map((r) => [r.month, Number(r.total)]) ?? []);
  const sign = new Map(d?.signups.map((r) => [r.month, r.n]) ?? []);
  const thisMonth = months[months.length - 1];

  return (
    <>
      <PageHead title="لوحة المؤشرات" sub="نظرة عامة على المنصة: أعداد مجمعة دون بيانات الطلاب أو مبالغ السناتر." >
        <Link className="btn" href="/platform/workspaces?new=1">سنتر أو مدرس جديد</Link>
        <Link className="btn quiet" href="/platform/users?new=1">مستخدم جديد</Link>
      </PageHead>
      <ErrorNote error={o.error} onRetry={o.reload} />
      {o.loading && !d ? <Loading what="المؤشرات" /> : null}
      {d ? (
        <div className="stack">
          <div className="kpis">
            <Link className="kpi" href="/platform/workspaces"><span className="v num">{num(d.workspaces.total)}</span><span className="l">مساحة عمل ({num(d.workspaces.byType.CENTER)} سنتر، {num(d.workspaces.byType.TEACHER)} مدرس)</span></Link>
            <Link className="kpi" href="/platform/workspaces?status=ACTIVE"><span className="v num">{num(d.workspaces.byReason.ACTIVE + d.workspaces.byReason.GRACE)}</span><span className="l">اشتراك مدفوع ساري</span></Link>
            <Link className="kpi" href="/platform/workspaces?status=TRIAL"><span className="v num">{num(d.workspaces.byReason.TRIAL)}</span><span className="l">في الفترة التجريبية</span></Link>
            <Link className={`kpi ${d.workspaces.byReason.EXPIRED + d.workspaces.byReason.TRIAL_ENDED ? 'alert' : ''}`} href="/platform/workspaces?due=expired">
              <span className="v num">{num(d.workspaces.byReason.EXPIRED + d.workspaces.byReason.TRIAL_ENDED)}</span><span className="l">منتهية (عرض فقط)</span>
            </Link>
            <div className="kpi"><span className="v num">{egp(d.mrr)}</span><span className="l">الإيراد الشهري المتوقع (حسب الخطط)</span></div>
            <Link className="kpi" href="/platform/billing"><span className="v num">{egp(rev.get(thisMonth) ?? 0)}</span><span className="l">محصل هذا الشهر</span></Link>
            <div className="kpi"><span className="v num">{num(d.activeStudents)}</span><span className="l">طالب نشط على المنصة</span></div>
            <div className="kpi"><span className="v num">{num(d.engaged)}</span><span className="l">مساحة نشطة فعليًا (آخر 30 يومًا)</span></div>
            <Link className="kpi" href="/platform/users"><span className="v num">{num(d.users.total)}</span><span className="l">مستخدم ({num(d.users.active30d)} دخلوا آخر 30 يومًا)</span></Link>
            <Link className={`kpi ${d.users.noPassword ? 'warn' : ''}`} href="/platform/users?kind=nopassword"><span className="v num">{num(d.users.noPassword)}</span><span className="l">حساب بلا كلمة مرور</span></Link>
            <Link className={`kpi ${d.users.locked ? 'alert' : ''}`} href="/platform/users?kind=locked"><span className="v num">{num(d.users.locked)}</span><span className="l">حساب مقفول مؤقتًا</span></Link>
            <Link className="kpi" href="/platform/users?kind=admin"><span className="v num">{num(d.users.admins)}</span><span className="l">عضو في فريق المنصة</span></Link>
          </div>

          <div className="split-even">
            <section className="panel">
              <h2>التحصيل الشهري</h2>
              <Bars data={months.map((m) => ({ month: m, value: rev.get(m) ?? 0 }))} format={(v) => egp(v)} />
            </section>
            <section className="panel">
              <h2>مساحات جديدة شهريًا</h2>
              <Bars data={months.map((m) => ({ month: m, value: sign.get(m) ?? 0 }))} format={(v) => num(v)} />
            </section>
          </div>

          <div className="split-even">
            <section className="panel stack-sm">
              <h2>تجارب تنتهي خلال أسبوع</h2>
              {d.trialsEnding.length ? (
                <Ledger head={<tr><th>المساحة</th><th>تنتهي</th><th>باقي</th></tr>}>
                  {d.trialsEnding.map((t) => (
                    <tr key={t.id}>
                      <td><Link href={`/platform/workspaces/${t.id}`}>{t.name}</Link></td>
                      <td>{t.until ? fmtDate(t.until) : '—'}</td>
                      <td className="num">{num(t.daysLeft)} يوم</td>
                    </tr>
                  ))}
                </Ledger>
              ) : <Empty>لا توجد تجارب قريبة الانتهاء.</Empty>}
            </section>
            <section className="panel stack-sm">
              <h2>تجديدات مطلوبة</h2>
              {d.renewals.length ? (
                <Ledger head={<tr><th>المساحة</th><th>الحالة</th><th>حتى</th></tr>}>
                  {d.renewals.map((r) => (
                    <tr key={r.id}>
                      <td><Link href={`/platform/workspaces/${r.id}`}>{r.name}</Link></td>
                      <td><Chip tone={ACCESS_TONE[r.reason]}>{ACCESS_LABEL[r.reason]}</Chip></td>
                      <td>{r.until ? fmtDate(r.until) : '—'}</td>
                    </tr>
                  ))}
                </Ledger>
              ) : <Empty>لا توجد اشتراكات قريبة الانتهاء.</Empty>}
            </section>
          </div>

          <section className="panel stack-sm">
            <div className="row-between"><h2>آخر إجراءات فريق المنصة</h2><Link href="/platform/audit?scope=platform">السجل كاملًا</Link></div>
            {d.recent.length ? (
              <Ledger head={<tr><th>الوقت</th><th>بواسطة</th><th>العملية</th><th>المساحة</th></tr>}>
                {d.recent.map((r) => (
                  <tr key={r.id}>
                    <td className="faint nowrap">{fmtDateTime(r.createdAt)}</td>
                    <td>{r.actor}</td>
                    <td>{actionLabel(r.action)}</td>
                    <td>{r.workspace ?? '—'}</td>
                  </tr>
                ))}
              </Ledger>
            ) : <Empty>لا توجد إجراءات بعد.</Empty>}
          </section>
        </div>
      ) : null}
    </>
  );
}
