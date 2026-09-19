'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';
import { downloadCsv, fetchAllPages } from '@/lib/csv';
import { egp, fmtDate, METHOD_LABEL, num } from '@/lib/format';
import type { Paged, PaymentRow } from '@/lib/platform';
import { useAction, useLoad } from '@/lib/use-load';
import { IfCan, Pager } from '@/components/platform-shell';
import { Empty, ErrorNote, Field, Ledger, Loading, PageHead } from '@/components/ui';

type PaymentsPage = Paged<PaymentRow> & { sum: string };

const startOfMonth = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
};

export default function BillingPage() {
  const [from, setFrom] = useState(startOfMonth());
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const query = { from: from ? `${from}T00:00:00Z` : undefined, to: to ? `${to}T23:59:59Z` : undefined };
  const list = useLoad(() => api<PaymentsPage>('/platform/payments', { workspace: false, query: { ...query, page } }), [from, to, page]);
  const action = useAction();

  const exportCsv = () =>
    void action.run(async () => {
      const items = await fetchAllPages((p) => api<PaymentsPage>('/platform/payments', { workspace: false, query: { ...query, page: p, pageSize: 200 } }));
      downloadCsv(
        `مدفوعات-المنصة-${from || 'الكل'}`,
        ['التاريخ', 'المساحة', 'المبلغ', 'الأشهر', 'الخطة', 'من', 'إلى', 'الطريقة', 'سجّلها', 'ملاحظة'],
        items.map((p) => [p.paidAt.slice(0, 10), p.workspace?.name, p.amount, p.months, p.planCode, p.periodStart.slice(0, 10), p.periodEnd.slice(0, 10), METHOD_LABEL[p.method] ?? p.method, p.recordedBy, p.note]),
      );
    });

  const remove = (p: PaymentRow) =>
    window.confirm(`حذف دفعة ${egp(p.amount)} لـ ${p.workspace?.name ?? ''}؟ لن يتغير تاريخ نهاية الاشتراك تلقائيًا.`) &&
    void action.run(async () => {
      await api(`/platform/payments/${p.id}`, { method: 'DELETE', workspace: false });
      await list.reload();
    });

  return (
    <>
      <PageHead title="المدفوعات" sub="اشتراكات السناتر والمدرسين المسجلة يدويًا. لتسجيل دفعة افتح صفحة المساحة ← تبويب الاشتراك.">
        <button className="btn quiet" onClick={exportCsv} disabled={action.busy}>تصدير Excel</button>
      </PageHead>
      <div className="form-grid" style={{ marginBottom: '1rem' }}>
        <Field label="من"><input className="input" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} /></Field>
        <Field label="إلى"><input className="input" type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} /></Field>
      </div>
      <ErrorNote error={list.error ?? action.error} onRetry={list.reload} />
      {list.loading && !list.data ? <Loading what="المدفوعات" /> : null}
      {list.data ? (
        <div className="kpis" style={{ marginBottom: '1rem' }}>
          <div className="kpi"><span className="v num">{egp(list.data.sum)}</span><span className="l">إجمالي الفترة</span></div>
          <div className="kpi"><span className="v num">{num(list.data.total)}</span><span className="l">دفعة</span></div>
        </div>
      ) : null}
      {list.data && !list.data.items.length ? <Empty>لا توجد مدفوعات في هذه الفترة.</Empty> : null}
      {list.data?.items.length ? (
        <Ledger head={<tr><th>التاريخ</th><th>المساحة</th><th>المبلغ</th><th>المدة</th><th>الفترة</th><th>الطريقة</th><th>سجّلها</th><th /></tr>}>
          {list.data.items.map((p) => (
            <tr key={p.id}>
              <td>{fmtDate(p.paidAt)}</td>
              <td>{p.workspace ? <Link href={`/platform/workspaces/${p.workspace.id}`}>{p.workspace.name}</Link> : '—'}{p.note ? <div className="faint">{p.note}</div> : null}</td>
              <td className="num">{egp(p.amount)}</td>
              <td className="num">{num(p.months)} شهر</td>
              <td className="faint">{fmtDate(p.periodStart)} ← {fmtDate(p.periodEnd)}</td>
              <td>{METHOD_LABEL[p.method] ?? p.method}</td>
              <td>{p.recordedBy}</td>
              <td><IfCan perm="platform.settings.manage"><button className="btn ghost" onClick={() => remove(p)} disabled={action.busy}>حذف</button></IfCan></td>
            </tr>
          ))}
        </Ledger>
      ) : null}
      {list.data ? <Pager page={page} total={list.data.total} pageSize={list.data.pageSize} onPage={setPage} /> : null}
    </>
  );
}
