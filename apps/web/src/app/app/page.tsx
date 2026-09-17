'use client';

import Link from 'next/link';
import { api } from '@/lib/api';
import { cairoToday, egp, egpP, fmtDay, fmtTime, num, SETTLEMENT_LABEL } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { SessionRow, SettlementView, TodaySession } from '@/lib/types';
import { useLoad } from '@/lib/use-load';
import { Chip, Empty, ErrorNote, Loading, PageHead } from '@/components/ui';

interface FinanceToday {
  collectedToday: number;
  receiptsToday: number;
  scope: 'mine' | 'all';
  pendingCancels: number | null;
  closedShiftsAwaitingApproval: number | null;
  openShifts: number;
}

interface DayRow {
  id: string;
  startsAt: string;
  endsAt: string;
  status: TodaySession['status'];
  title: string;
  meta: string;
  present?: number;
  enrolled?: number;
}

export default function DayPage() {
  const { current, can } = useSession();
  const today = cairoToday();

  const sessions = useLoad<DayRow[]>(async () => {
    if (can('attendance.record')) {
      const rows = await api<TodaySession[]>('/attendance/today');
      return rows.map((s) => ({
        id: s.id, startsAt: s.startsAt, endsAt: s.endsAt, status: s.status, title: s.group,
        meta: [s.teacherName, s.hall].filter(Boolean).join('، '), present: s.present, enrolled: s.enrolled,
      }));
    }
    if (!can('academics.read')) return [];
    const rows = await api<SessionRow[]>('/academics/sessions', { query: { from: today, to: today } });
    return rows.map((s) => ({
      id: s.id, startsAt: s.startsAt, endsAt: s.endsAt, status: s.status, title: s.group.name,
      meta: [s.teacherName, s.hall?.name].filter(Boolean).join('، '),
    }));
  }, [current?.workspace.id]);

  const money = useLoad(() => (can('finance.collect') ? api<FinanceToday>('/finance/today') : Promise.resolve(null)), [current?.workspace.id]);
  const mine = useLoad(
    () => (can('settlements.read.own') && !can('settlements.manage') ? api<SettlementView[]>('/settlements/mine') : Promise.resolve([])),
    [current?.workspace.id],
  );

  const now = Date.now();
  const latest = mine.data?.[0];

  return (
    <>
      <PageHead title={fmtDay(new Date())} sub={current?.workspace.name}>
        {can('attendance.record') ? <Link className="btn" href="/app/reception">افتح محطة الحضور</Link> : null}
        {can('students.write') ? <Link className="btn quiet" href="/app/students?new=1">سجّل طالبًا</Link> : null}
      </PageHead>

      <div className="split">
        <section className="panel" aria-labelledby="today-h">
          <div className="row-between">
            <h2 id="today-h">حصص اليوم</h2>
            {can('academics.read') ? <Link href="/app/schedule">الجدول الكامل</Link> : null}
          </div>
          <ErrorNote error={sessions.error} onRetry={sessions.reload} />
          {sessions.loading && !sessions.data ? <Loading what="الحصص" /> : null}
          {sessions.data && !sessions.data.length ? (
            <Empty action={can('academics.write') ? <Link className="btn quiet" href="/app/schedule">أضف مجموعة وجدولها</Link> : undefined}>
              لا توجد حصص اليوم.
            </Empty>
          ) : null}
          <div className="timeline">
            {sessions.data?.map((s) => {
              const live = new Date(s.startsAt).getTime() - 15 * 60_000 <= now && new Date(s.endsAt).getTime() >= now && s.status !== 'CANCELLED';
              const pct = s.enrolled ? Math.round(((s.present ?? 0) / s.enrolled) * 100) : 0;
              const body = (
                <>
                  <span className="time num">{fmtTime(s.startsAt)}</span>
                  <div>
                    <div className="title">{s.title}</div>
                    <div className="faint">{s.meta}</div>
                    {s.enrolled !== undefined && s.status !== 'CANCELLED' ? (
                      <div className="fill" aria-label={`الحضور ${s.present} من ${s.enrolled}`}>
                        <i style={{ width: `${pct}%` }} />
                      </div>
                    ) : null}
                  </div>
                  <div className="stack-sm" style={{ justifyItems: 'end' }}>
                    {s.status === 'CANCELLED' ? <Chip tone="bad">ملغاة</Chip> : null}
                    {s.status === 'CLOSED' ? <Chip>الكشف مغلق</Chip> : null}
                    {live && s.status !== 'CLOSED' ? <Chip tone="info">الآن</Chip> : null}
                    {s.enrolled !== undefined ? <span className="num faint">{num(s.present)} / {num(s.enrolled)}</span> : null}
                  </div>
                </>
              );
              const cls = `slot${live ? ' is-now' : ''}${s.status === 'CANCELLED' ? ' is-cancelled' : ''}`;
              return can('attendance.record') ? (
                <Link key={s.id} href={`/app/sessions/${s.id}`} className={cls}>{body}</Link>
              ) : (
                <div key={s.id} className={cls}>{body}</div>
              );
            })}
          </div>
        </section>

        <aside className="stack">
          {money.data ? (
            <section className="panel board stack-sm" aria-labelledby="drawer-h">
              <h2 id="drawer-h">{money.data.scope === 'mine' ? 'تحصيلك اليوم' : 'تحصيل اليوم'}</h2>
              <div className="big-figure num">{egpP(money.data.collectedToday)}</div>
              <p>{num(money.data.receiptsToday)} إيصال. الورديات المفتوحة الآن: {num(money.data.openShifts)}.</p>
              <div className="row">
                <Link className="btn" href="/app/cash">الخزنة والتحصيل</Link>
              </div>
            </section>
          ) : null}

          {money.data && ((money.data.pendingCancels ?? 0) > 0 || (money.data.closedShiftsAwaitingApproval ?? 0) > 0) ? (
            <section className="panel stack-sm">
              <h3>بانتظار موافقتك</h3>
              {money.data.pendingCancels ? <p><span className="mark">{num(money.data.pendingCancels)} طلب إلغاء إيصال</span></p> : null}
              {money.data.closedShiftsAwaitingApproval ? <p>{num(money.data.closedShiftsAwaitingApproval)} وردية مغلقة تحتاج اعتماد</p> : null}
              <Link href="/app/approvals">راجع الموافقات</Link>
            </section>
          ) : null}

          {latest ? (
            <section className="panel stack-sm">
              <h3>كشف حسابك لشهر {latest.month}</h3>
              <div className="big-figure num">{egp(latest.net)}</div>
              <Chip tone={latest.status === 'DRAFT' || latest.status === 'DISPUTED' ? 'warn' : latest.status === 'PAID' ? 'ok' : 'info'}>
                {SETTLEMENT_LABEL[latest.status]}
              </Chip>
              <Link href={`/app/settlements/${latest.id}`}>افتح الكشف</Link>
            </section>
          ) : null}

          {can('finance.dues') ? (
            <section className="panel stack-sm">
              <h3>المتأخرات</h3>
              <p className="muted">قائمة الطلاب الذين لم يسددوا الشهر الحالي، مع رقم ولي الأمر للتواصل.</p>
              <Link href="/app/dues">افتح قائمة المتأخرات</Link>
            </section>
          ) : null}

          {can('exams.manage') ? (
            <section className="panel stack-sm">
              <h3>الامتحانات</h3>
              <p className="muted">ابنِ امتحانًا من بنك أسئلتك وتابع النتائج وتحليل الأسئلة.</p>
              <Link href="/app/exams">افتح الامتحانات</Link>
            </section>
          ) : null}
        </aside>
      </div>
    </>
  );
}
