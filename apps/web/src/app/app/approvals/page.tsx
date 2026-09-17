'use client';

import { api } from '@/lib/api';
import { egp, fmtDateTime } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { Receipt, Shift } from '@/lib/types';
import { useAction, useLoad } from '@/lib/use-load';
import { Guard } from '@/components/app-shell';
import { Chip, Empty, ErrorNote, Ledger, Loading, PageHead } from '@/components/ui';

export default function ApprovalsPage() {
  return (
    <Guard perm="finance.cancel.approve">
      <Approvals />
    </Guard>
  );
}

function Approvals() {
  const { current } = useSession();
  const wsId = current?.workspace.id;
  const cancels = useLoad(() => api<Receipt[]>('/finance/receipts', { query: { status: 'CANCEL_REQUESTED' } }), [wsId]);
  const shifts = useLoad(() => api<Shift[]>('/finance/shifts', { query: { status: 'CLOSED' } }), [wsId]);
  const action = useAction();

  const decide = (id: string, approve: boolean) =>
    void action.run(async () => {
      await api(`/finance/receipts/${id}/cancel-decision`, { method: 'POST', body: { approve } });
      await cancels.reload();
    });

  const approveShift = (id: string) =>
    void action.run(async () => {
      await api(`/finance/shifts/${id}/approve`, { method: 'POST' });
      await shifts.reload();
    });

  return (
    <>
      <PageHead title="الموافقات" sub="لا يعتمد الشخص طلبًا قدمه بنفسه ولا ورديته، حتى تبقى كل حركة مالية بعلم شخصين." />
      <ErrorNote error={action.error} />

      <section className="stack-sm" style={{ marginBottom: '2rem' }}>
        <h2>طلبات إلغاء الإيصالات</h2>
        <ErrorNote error={cancels.error} onRetry={cancels.reload} />
        {cancels.loading && !cancels.data ? <Loading what="الطلبات" /> : null}
        {cancels.data && !cancels.data.length ? <Empty>لا توجد طلبات إلغاء معلقة.</Empty> : null}
        {cancels.data?.length ? (
          <Ledger head={<tr><th>رقم</th><th>الطالب</th><th className="amount">المبلغ</th><th>السبب</th><th>تاريخ الإيصال</th><th /></tr>}>
            {cancels.data.map((r) => (
              <tr key={r.id}>
                <td className="num">{r.number}</td>
                <td>{r.student}<div className="faint">{r.group}</div></td>
                <td className="amount num">{egp(r.amount)}</td>
                <td>{r.cancelReason}</td>
                <td className="faint">{fmtDateTime(r.createdAt)}</td>
                <td>
                  <div className="row" style={{ gap: '0.25rem' }}>
                    <button className="btn danger" disabled={action.busy} onClick={() => decide(r.id, true)}>اعتمد الإلغاء</button>
                    <button className="btn quiet" disabled={action.busy} onClick={() => decide(r.id, false)}>ارفض</button>
                  </div>
                </td>
              </tr>
            ))}
          </Ledger>
        ) : null}
      </section>

      <section className="stack-sm">
        <h2>ورديات مغلقة بانتظار الاعتماد</h2>
        <ErrorNote error={shifts.error} onRetry={shifts.reload} />
        {shifts.loading && !shifts.data ? <Loading what="الورديات" /> : null}
        {shifts.data && !shifts.data.length ? <Empty>كل الورديات المغلقة معتمدة.</Empty> : null}
        {shifts.data?.length ? (
          <Ledger head={<tr><th>الموظف</th><th>الفترة</th><th className="amount">المتوقع</th><th className="amount">الفعلي</th><th className="amount">الفرق</th><th>ملاحظة</th><th /></tr>}>
            {shifts.data.map((s) => {
              const v = Number(s.variance ?? 0);
              return (
                <tr key={s.id}>
                  <td>{s.openedBy}</td>
                  <td className="faint">{fmtDateTime(s.openedAt)}{s.closedAt ? ` حتى ${fmtDateTime(s.closedAt)}` : ''}</td>
                  <td className="amount num">{egp(s.expectedCash)}</td>
                  <td className="amount num">{egp(s.countedCash)}</td>
                  <td className="amount">
                    {v === 0 ? <Chip tone="ok">مطابق</Chip> : <Chip tone={v < 0 ? 'bad' : 'warn'}>{v < 0 ? 'عجز' : 'زيادة'} {egp(Math.abs(v))}</Chip>}
                  </td>
                  <td>{s.closeNote ?? '—'}</td>
                  <td><button className="btn" disabled={action.busy} onClick={() => approveShift(s.id)}>اعتمد</button></td>
                </tr>
              );
            })}
          </Ledger>
        ) : null}
      </section>
    </>
  );
}
