'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { addDays, cairoToday, fmtDay, fmtTime } from '@/lib/format';
import { useLoad } from '@/lib/use-load';
import { Chip, Empty, ErrorNote, Loading } from '@/components/ui';

interface Row {
  sessionId: string;
  startsAt: string;
  endsAt: string;
  status: string;
  cancelReason: string | null;
  group: string;
  subject: string;
  teacher: string;
  hall: string | null;
  workspace: string;
}

const cairoDate = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date(iso));

export default function FamilySchedule() {
  const [from, setFrom] = useState(cairoToday());
  const to = addDays(from, 13);
  const rows = useLoad(() => api<Row[]>('/family/schedule', { query: { from, to }, workspace: false }), [from]);

  const days = [...new Set((rows.data ?? []).map((r) => cairoDate(r.startsAt)))];

  return (
    <div className="stack">
      <div className="row-between">
        <h1>جدول الأسبوعين</h1>
        <div className="row">
          <button className="btn quiet" onClick={() => setFrom(addDays(from, -14))}>السابق</button>
          <button className="btn ghost" onClick={() => setFrom(cairoToday())}>من اليوم</button>
          <button className="btn quiet" onClick={() => setFrom(addDays(from, 14))}>التالي</button>
        </div>
      </div>
      <p className="muted">كل حصص أبنائك في كل الأماكن في جدول واحد. الحصص الملغاة تظهر مشطوبة مع سبب الإلغاء.</p>
      <ErrorNote error={rows.error} onRetry={rows.reload} />
      {rows.loading && !rows.data ? <Loading what="الجدول" /> : null}
      {rows.data && !rows.data.length ? <Empty>لا توجد حصص في هذه الفترة.</Empty> : null}
      {days.map((d) => (
        <section key={d} className="panel">
          <h3>{fmtDay(`${d}T12:00:00Z`)}</h3>
          <div className="timeline">
            {(rows.data ?? []).filter((r) => cairoDate(r.startsAt) === d).map((r) => (
              <div key={r.sessionId} className={`slot${r.status === 'CANCELLED' ? ' is-cancelled' : ''}`}>
                <span className="time num">{fmtTime(r.startsAt)}</span>
                <div>
                  <div className="title">{r.subject}: {r.group}</div>
                  <div className="faint">{r.teacher}، {r.workspace}{r.hall ? `، ${r.hall}` : ''}</div>
                  {r.cancelReason ? <div className="faint">سبب الإلغاء: {r.cancelReason}</div> : null}
                </div>
                {r.status === 'CANCELLED' ? <Chip tone="bad">ملغاة</Chip> : <span />}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
