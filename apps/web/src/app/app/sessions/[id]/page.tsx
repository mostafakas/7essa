'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api';
import { ATTENDANCE_LABEL, egpP, fmtDay, fmtTime, num } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { DueView } from '@/lib/types';
import { useAction, useLoad } from '@/lib/use-load';
import { Chip, ErrorNote, Ledger, Loading, PageHead } from '@/components/ui';

interface Sheet {
  session: { id: string; startsAt: string; endsAt: string; status: string; group: string; subject: string; hall: string | null };
  counts: { enrolled: number; present: number; late: number; absent: number };
  rows: {
    studentId: string;
    fullName: string;
    code: string;
    enrollmentStatus: string;
    attendance: { status: 'PRESENT' | 'LATE' | 'ABSENT'; method: string; at: string; offline: boolean } | null;
    due?: DueView;
  }[];
}

type Filter = 'all' | 'missing' | 'dues';

export default function SessionSheetPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const sheet = useLoad(() => api<Sheet>(`/attendance/sessions/${id}`), [id]);
  const action = useAction();
  const [filter, setFilter] = useState<Filter>('all');
  const [closedMsg, setClosedMsg] = useState<string | null>(null);

  const mark = (studentId: string, status: 'PRESENT' | 'LATE' | 'ABSENT') =>
    void action.run(async () => {
      await api(`/attendance/sessions/${id}/manual`, { method: 'POST', body: { studentId, status } });
      await sheet.reload();
    });

  const close = () => {
    if (!window.confirm('إغلاق الكشف يسجل كل من لم يحضر غائبًا ويرسل إشعار الغياب لأولياء الأمور. متابعة؟')) return;
    void action.run(async () => {
      const r = await api<{ present: number; absent: number }>(`/attendance/sessions/${id}/close`, { method: 'POST' });
      setClosedMsg(`أُغلق الكشف: ${num(r.present)} حضور و${num(r.absent)} غياب، وأُرسلت إشعارات الغياب.`);
      await sheet.reload();
    });
  };

  const d = sheet.data;
  const rows = (d?.rows ?? []).filter((r) =>
    filter === 'missing' ? !r.attendance || r.attendance.status === 'ABSENT' : filter === 'dues' ? r.due?.state !== 'OK' : true,
  );
  const open = d && d.session.status !== 'CLOSED' && d.session.status !== 'CANCELLED';

  return (
    <>
      <PageHead
        title={d ? d.session.group : 'كشف الحصة'}
        sub={d ? `${fmtDay(d.session.startsAt)}، الساعة ${fmtTime(d.session.startsAt)}${d.session.hall ? `، ${d.session.hall}` : ''}` : undefined}
      >
        <Link className="btn quiet no-print" href="/app/reception">محطة الحضور</Link>
        {open ? <button className="btn danger no-print" onClick={close} disabled={action.busy}>أغلق الكشف</button> : null}
        <button className="btn ghost no-print" onClick={() => window.print()}>اطبع الكشف</button>
      </PageHead>

      <ErrorNote error={sheet.error ?? action.error} onRetry={sheet.reload} />
      {closedMsg ? <div className="note info" role="status">{closedMsg}</div> : null}
      {sheet.loading && !d ? <Loading what="الكشف" /> : null}

      {d ? (
        <div className="stack">
          <div className="row">
            <Chip tone="ok">حاضر {num(d.counts.present)}</Chip>
            <Chip tone="warn">متأخر {num(d.counts.late)}</Chip>
            <Chip tone="bad">غائب {num(d.counts.absent)}</Chip>
            <Chip>المسجلون {num(d.counts.enrolled)}</Chip>
            {d.session.status === 'CLOSED' ? <Chip tone="info">الكشف مغلق</Chip> : null}
            {d.session.status === 'CANCELLED' ? <Chip tone="bad">الحصة ملغاة</Chip> : null}
            <span className="grow" />
            <label className="row no-print">
              <span className="faint">عرض</span>
              <select className="select" style={{ width: 'auto' }} value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
                <option value="all">كل الطلاب</option>
                <option value="missing">من لم يحضر</option>
                <option value="dues">عليه متأخرات أو موقوف</option>
              </select>
            </label>
          </div>

          <Ledger
            head={
              <tr>
                <th>الطالب</th>
                <th>الكود</th>
                <th>الحضور</th>
                <th>الاشتراك</th>
                <th className="no-print">تسجيل يدوي</th>
              </tr>
            }
          >
            {rows.map((r) => (
              <tr key={r.studentId}>
                <td>
                  <Link href={`/app/students/${r.studentId}`}>{r.fullName}</Link>
                </td>
                <td className="num">{r.code}</td>
                <td>
                  {r.attendance ? (
                    <span className="row" style={{ gap: '0.4rem' }}>
                      <Chip tone={r.attendance.status === 'PRESENT' ? 'ok' : r.attendance.status === 'LATE' ? 'warn' : 'bad'}>
                        {ATTENDANCE_LABEL[r.attendance.status]}
                      </Chip>
                      {r.attendance.status !== 'ABSENT' ? <span className="faint num">{fmtTime(r.attendance.at)}</span> : null}
                      {r.attendance.offline ? <span className="faint">سُجل دون اتصال</span> : null}
                    </span>
                  ) : (
                    <span className="faint">لم يُسجل بعد</span>
                  )}
                </td>
                <td>
                  {r.due?.state === 'SUSPENDED' ? <Chip tone="bad">موقوف</Chip> : null}
                  {r.due?.state === 'DUES' ? (
                    <Chip tone="warn">{r.due.remaining !== undefined ? `متبقي ${egpP(r.due.remaining)}` : 'عليه متأخرات'}</Chip>
                  ) : null}
                  {r.due?.state === 'OK' ? <Chip tone="ok">مسدد</Chip> : null}
                </td>
                <td className="no-print">
                  {d.session.status !== 'CANCELLED' && can('attendance.record') ? (
                    <div className="row" style={{ gap: '0.25rem' }}>
                      {(['PRESENT', 'LATE', 'ABSENT'] as const).map((s) => (
                        <button
                          key={s}
                          className="btn ghost"
                          disabled={action.busy || r.attendance?.status === s}
                          onClick={() => mark(r.studentId, s)}
                        >
                          {ATTENDANCE_LABEL[s]}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </Ledger>
          {!rows.length ? <p className="faint">لا يوجد طلاب في هذا العرض.</p> : null}
        </div>
      ) : null}
    </>
  );
}
