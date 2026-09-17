'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { cairoMonth, cairoToday, egpP, fmtDate, fmtMonth, METHOD_LABEL, num, shiftMonth } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useLoad } from '@/lib/use-load';
import { Guard } from '@/components/app-shell';
import { ErrorNote, Ledger, Loading, MonthInput, PageHead } from '@/components/ui';

interface Summary {
  month: string;
  collected: number;
  discounts: number;
  receiptsCount: number;
  cancelled: { count: number; amount: number };
  byMethod: Record<string, number>;
  byTeacher: { name: string; amount: number }[];
  byGroup: { name: string; amount: number }[];
  days: { date: string; amount: number }[];
  expenses: { total: number; byCategory: { category: string; amount: number }[] };
  net: number;
  collectionRate: { expected: number; paid: number; pct: number };
}

export default function ReportsPage() {
  return (
    <Guard perm="finance.reports">
      <Reports />
    </Guard>
  );
}

function Reports() {
  const { current } = useSession();
  const [month, setMonth] = useState(cairoMonth());
  const data = useLoad(() => api<Summary>('/finance/summary', { query: { month } }), [month, current?.workspace.id]);
  const prev = useLoad(() => api<Summary>('/finance/summary', { query: { month: shiftMonth(month, -1) } }), [month, current?.workspace.id]);
  const s = data.data;
  const max = Math.max(1, ...(s?.days.map((d) => d.amount) ?? [1]));
  const today = cairoToday();
  const delta = s && prev.data && prev.data.collected ? Math.round(((s.collected - prev.data.collected) / prev.data.collected) * 100) : null;

  return (
    <>
      <PageHead title={`تقرير ${fmtMonth(month)}`} sub={current?.workspace.name}>
        <div style={{ width: 200 }} className="no-print"><MonthInput value={month} onChange={setMonth} /></div>
        <button className="btn ghost no-print" onClick={() => window.print()}>اطبع التقرير</button>
      </PageHead>
      <ErrorNote error={data.error} onRetry={data.reload} />
      {data.loading && !s ? <Loading what="التقرير" /> : null}

      {s ? (
        <div className="stack">
          <section className="panel board">
            <div className="split-even">
              <div>
                <h3>المحصّل هذا الشهر</h3>
                <div className="big-figure num">{egpP(s.collected)}</div>
                <p>
                  من {num(s.receiptsCount)} إيصال
                  {delta !== null ? `، ${delta >= 0 ? 'بزيادة' : 'بانخفاض'} ${num(Math.abs(delta))}% عن الشهر السابق` : ''}.
                </p>
              </div>
              <div>
                <h3>الصافي بعد المصروفات</h3>
                <div className="big-figure num">{egpP(s.net)}</div>
                <p>المصروفات {egpP(s.expenses.total)}، والخصومات الممنوحة {egpP(s.discounts)}.</p>
              </div>
              <div>
                <h3>نسبة التحصيل</h3>
                <div className="big-figure num">{num(s.collectionRate.pct)}%</div>
                <p>سُدد {egpP(s.collectionRate.paid)} من {egpP(s.collectionRate.expected)} مستحقة عن الشهر.</p>
              </div>
            </div>
          </section>

          <section className="panel">
            <h2>التحصيل اليومي</h2>
            <div className="bars" role="img" aria-label="رسم التحصيل اليومي">
              {s.days.map((d) => (
                <div
                  key={d.date}
                  className={d.date === today ? 'today' : undefined}
                  style={{ height: `${(d.amount / max) * 100}%` }}
                  title={`${fmtDate(`${d.date}T12:00:00Z`)}: ${egpP(d.amount)}`}
                />
              ))}
            </div>
            <div className="row-between faint num" style={{ direction: 'ltr' }}>
              <span>{s.days[0]?.date.slice(8)}</span>
              <span>{s.days.at(-1)?.date.slice(8)}</span>
            </div>
          </section>

          <div className="split-even">
            <section className="stack-sm">
              <h2>حسب المدرس</h2>
              <Ledger head={<tr><th>المدرس</th><th className="amount">المحصّل</th><th className="amount">النسبة</th></tr>}>
                {s.byTeacher.map((t) => (
                  <tr key={t.name}><td>{t.name}</td><td className="amount num">{egpP(t.amount)}</td><td className="amount num">{num(s.collected ? Math.round((t.amount / s.collected) * 100) : 0)}%</td></tr>
                ))}
              </Ledger>
            </section>
            <section className="stack-sm">
              <h2>حسب طريقة الدفع</h2>
              <Ledger head={<tr><th>الطريقة</th><th className="amount">المبلغ</th></tr>}>
                {Object.entries(s.byMethod).map(([m, v]) => (
                  <tr key={m}><td>{METHOD_LABEL[m] ?? m}</td><td className="amount num">{egpP(v)}</td></tr>
                ))}
              </Ledger>
              {s.cancelled.count ? (
                <p className="note warn">أُلغي {num(s.cancelled.count)} إيصال بقيمة {egpP(s.cancelled.amount)} هذا الشهر.</p>
              ) : null}
            </section>
            <section className="stack-sm">
              <h2>حسب المجموعة</h2>
              <Ledger head={<tr><th>المجموعة</th><th className="amount">المحصّل</th></tr>}>
                {s.byGroup.map((g) => (
                  <tr key={g.name}><td>{g.name}</td><td className="amount num">{egpP(g.amount)}</td></tr>
                ))}
              </Ledger>
            </section>
            <section className="stack-sm">
              <h2>المصروفات</h2>
              {s.expenses.byCategory.length ? (
                <Ledger
                  head={<tr><th>البند</th><th className="amount">المبلغ</th></tr>}
                  foot={<tr><td>الإجمالي</td><td className="amount num">{egpP(s.expenses.total)}</td></tr>}
                >
                  {s.expenses.byCategory.map((c) => (
                    <tr key={c.category}><td>{c.category}</td><td className="amount num">{egpP(c.amount)}</td></tr>
                  ))}
                </Ledger>
              ) : <p className="faint">لا توجد مصروفات.</p>}
            </section>
          </div>
        </div>
      ) : null}
    </>
  );
}
