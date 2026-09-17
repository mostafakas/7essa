'use client';

import Link from 'next/link';
import { api } from '@/lib/api';
import { fmtDateTime, num } from '@/lib/format';
import { useAction, useLoad } from '@/lib/use-load';
import { Chip, Empty, ErrorNote, Loading } from '@/components/ui';

interface Row {
  examId: string;
  title: string;
  group: string | null;
  subject: string | null;
  durationMin: number;
  opensAt: string;
  closesAt: string;
  studentId: string;
  studentName: string;
  attemptId: string | null;
  state: 'UPCOMING' | 'AVAILABLE' | 'IN_PROGRESS' | 'SUBMITTED' | 'EXPIRED';
}

export default function FamilyExams() {
  const rows = useLoad(() => api<Row[]>('/family/exams', { workspace: false }), []);
  const action = useAction();

  const start = (r: Row) => {
    if (!window.confirm(`بمجرد البدء يبدأ عد ${r.durationMin} دقيقة ولا يتوقف. هل ${r.studentName} جاهز؟`)) return;
    void action.run(async () => {
      const paper = await api<{ attemptId: string }>(`/family/exams/${r.examId}/start`, {
        method: 'POST',
        body: { studentId: r.studentId },
        workspace: false,
      });
      window.location.assign(`/family/attempt/${paper.attemptId}`);
    });
  };

  return (
    <div className="stack">
      <h1>الامتحانات</h1>
      <ErrorNote error={rows.error ?? action.error} onRetry={rows.reload} />
      {rows.loading && !rows.data ? <Loading what="الامتحانات" /> : null}
      {rows.data && !rows.data.length ? <Empty>لا توجد امتحانات متاحة حاليًا.</Empty> : null}
      {rows.data?.map((r) => (
        <section key={`${r.examId}:${r.studentId}`} className="panel row-between">
          <div className="stack-sm">
            <h3>{r.title}</h3>
            <span className="muted">{r.studentName}، {r.subject ?? ''} {r.group ? `(${r.group})` : ''}</span>
            <span className="faint">
              {num(r.durationMin)} دقيقة، متاح من {fmtDateTime(r.opensAt)} حتى {fmtDateTime(r.closesAt)}
            </span>
          </div>
          <div>
            {r.state === 'UPCOMING' ? <Chip>لم يبدأ بعد</Chip> : null}
            {r.state === 'AVAILABLE' ? <button className="btn big" disabled={action.busy} onClick={() => start(r)}>ابدأ الامتحان</button> : null}
            {r.state === 'IN_PROGRESS' && r.attemptId ? <Link className="btn big" href={`/family/attempt/${r.attemptId}`}>أكمل الحل</Link> : null}
            {r.state === 'SUBMITTED' && r.attemptId ? <Link className="btn quiet" href={`/family/attempt/${r.attemptId}`}>النتيجة</Link> : null}
            {r.state === 'EXPIRED' ? <Chip tone="bad">انتهى الوقت دون تسليم</Chip> : null}
          </div>
        </section>
      ))}
    </div>
  );
}
