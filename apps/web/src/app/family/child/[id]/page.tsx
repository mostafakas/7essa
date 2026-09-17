'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api';
import { ATTENDANCE_LABEL, cairoMonth, egp, fmtDate, fmtDateTime, fmtMonth, METHOD_LABEL, num } from '@/lib/format';
import { useLoad } from '@/lib/use-load';
import { Chip, Empty, ErrorNote, Ledger, Loading, MonthInput, Tabs } from '@/components/ui';

type Tab = 'attendance' | 'results' | 'receipts';

interface AttendanceRow { id: string; status: 'PRESENT' | 'LATE' | 'ABSENT'; at: string; sessionStartsAt: string; group: string; subject: string }
interface ResultRow { attemptId: string; exam: string; submittedAt: string; late: boolean; score: number | null; maxScore: number | null; pendingRelease: boolean }
interface ReceiptRow { id: string; number: number; amount: string; discountAmount: string; method: string; forMonth: string; status: string; createdAt: string; workspace: string; group: string }

export default function ChildPage() {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState<Tab>('attendance');
  const [month, setMonth] = useState(cairoMonth());
  const attendance = useLoad(
    () => (tab === 'attendance' ? api<AttendanceRow[]>(`/family/children/${id}/attendance`, { query: { month }, workspace: false }) : Promise.resolve(null)),
    [id, month, tab],
  );
  const results = useLoad(() => (tab === 'results' ? api<ResultRow[]>(`/family/children/${id}/results`, { workspace: false }) : Promise.resolve(null)), [id, tab]);
  const receipts = useLoad(() => (tab === 'receipts' ? api<ReceiptRow[]>(`/family/children/${id}/receipts`, { workspace: false }) : Promise.resolve(null)), [id, tab]);

  const counts = { PRESENT: 0, LATE: 0, ABSENT: 0 };
  for (const a of attendance.data ?? []) counts[a.status]++;

  return (
    <div className="stack">
      <Link href="/family">كل الأبناء</Link>
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        items={[
          { id: 'attendance', label: 'الحضور' },
          { id: 'results', label: 'الدرجات' },
          { id: 'receipts', label: 'المدفوعات' },
        ]}
      />

      {tab === 'attendance' ? (
        <section className="stack">
          <div className="row-between">
            <div style={{ width: 200 }}><MonthInput value={month} onChange={setMonth} /></div>
            <div className="row">
              <Chip tone="ok">حضر {num(counts.PRESENT)}</Chip>
              <Chip tone="warn">تأخر {num(counts.LATE)}</Chip>
              <Chip tone="bad">غاب {num(counts.ABSENT)}</Chip>
            </div>
          </div>
          <ErrorNote error={attendance.error} onRetry={attendance.reload} />
          {attendance.loading && !attendance.data ? <Loading what="الحضور" /> : null}
          {attendance.data && !attendance.data.length ? <Empty>لا يوجد حضور مسجل في {fmtMonth(month)}.</Empty> : null}
          {attendance.data?.length ? (
            <Ledger head={<tr><th>الحصة</th><th>المادة</th><th>الحالة</th><th>وقت الوصول</th></tr>}>
              {attendance.data.map((a) => (
                <tr key={a.id}>
                  <td>{fmtDateTime(a.sessionStartsAt)}</td>
                  <td>{a.subject}<div className="faint">{a.group}</div></td>
                  <td><Chip tone={a.status === 'PRESENT' ? 'ok' : a.status === 'LATE' ? 'warn' : 'bad'}>{ATTENDANCE_LABEL[a.status]}</Chip></td>
                  <td className="faint">{a.status === 'ABSENT' ? '—' : fmtDateTime(a.at)}</td>
                </tr>
              ))}
            </Ledger>
          ) : null}
        </section>
      ) : null}

      {tab === 'results' ? (
        <section className="stack">
          <ErrorNote error={results.error} onRetry={results.reload} />
          {results.loading && !results.data ? <Loading what="الدرجات" /> : null}
          {results.data && !results.data.length ? <Empty>لا توجد امتحانات مسلّمة بعد.</Empty> : null}
          {results.data?.length ? (
            <Ledger head={<tr><th>الامتحان</th><th>الدرجة</th><th>التسليم</th><th /></tr>}>
              {results.data.map((r) => (
                <tr key={r.attemptId}>
                  <td>{r.exam}</td>
                  <td className="num">{r.pendingRelease ? <Chip>تظهر بعد إغلاق الامتحان</Chip> : `${r.score} / ${r.maxScore}`}</td>
                  <td>{fmtDateTime(r.submittedAt)} {r.late ? <Chip tone="warn">متأخر</Chip> : null}</td>
                  <td><Link href={`/family/attempt/${r.attemptId}`}>المراجعة</Link></td>
                </tr>
              ))}
            </Ledger>
          ) : null}
        </section>
      ) : null}

      {tab === 'receipts' ? (
        <section className="stack">
          <ErrorNote error={receipts.error} onRetry={receipts.reload} />
          {receipts.loading && !receipts.data ? <Loading what="المدفوعات" /> : null}
          {receipts.data && !receipts.data.length ? <Empty>لا توجد إيصالات.</Empty> : null}
          {receipts.data?.length ? (
            <Ledger head={<tr><th>الإيصال</th><th>المكان</th><th>عن شهر</th><th className="amount">المبلغ</th><th>التاريخ</th></tr>}>
              {receipts.data.map((r) => (
                <tr key={r.id} className={r.status === 'CANCELLED' ? 'is-void' : undefined}>
                  <td className="num">{r.number}</td>
                  <td>{r.workspace}<div className="faint">{r.group}</div></td>
                  <td>{fmtMonth(r.forMonth)}</td>
                  <td className="amount num">{egp(r.amount)}<div className="faint">{METHOD_LABEL[r.method] ?? r.method}</div></td>
                  <td>{fmtDate(r.createdAt)} {r.status === 'CANCELLED' ? <Chip tone="bad">ملغى</Chip> : null}</td>
                </tr>
              ))}
            </Ledger>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
