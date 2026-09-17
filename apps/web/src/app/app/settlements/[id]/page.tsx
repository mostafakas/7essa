'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api';
import { CONTRACT_LABEL, egp, egpP, fmtDateTime, fmtMonth, METHOD_LABEL, num, SETTLEMENT_LABEL } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { SettlementView } from '@/lib/types';
import { useAction, useLoad } from '@/lib/use-load';
import { Chip, ErrorNote, Field, Ledger, Loading, Stamp } from '@/components/ui';

interface Detail extends SettlementView {
  workspaceName: string;
  approvedBy: string | null;
  paidBy: string | null;
  isMine: boolean;
}

const STEPS: SettlementView['status'][] = ['DRAFT', 'TEACHER_CONFIRMED', 'APPROVED', 'PAID'];

export default function StatementPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const s = useLoad(() => api<Detail>(`/settlements/${id}`), [id]);
  const action = useAction();
  const [dispute, setDispute] = useState('');
  const [method, setMethod] = useState('CASH');

  const act = (path: string, body?: unknown) =>
    void action.run(async () => {
      await api(`/settlements/${id}/${path}`, { method: 'POST', body });
      await s.reload();
    });

  const d = s.data;
  const stepIndex = d ? (d.status === 'DISPUTED' ? 0 : STEPS.indexOf(d.status)) : 0;

  return (
    <div className="statement stack">
      <div className="row-between no-print">
        <Link href="/app/settlements">كل الكشوف</Link>
        <button className="btn ghost" onClick={() => window.print()}>اطبع الكشف</button>
      </div>

      <ErrorNote error={s.error ?? action.error} onRetry={s.reload} />
      {s.loading && !d ? <Loading what="الكشف" /> : null}

      {d ? (
        <>
          <header className="row-between" style={{ alignItems: 'flex-start' }}>
            <div>
              <p className="muted">{d.workspaceName}</p>
              <h1>كشف حساب {d.teacherName}</h1>
              <p className="muted">عن شهر {fmtMonth(d.month)}، بصيغة {CONTRACT_LABEL[d.contractType] ?? d.contractType}</p>
            </div>
            {d.status === 'PAID' ? <Stamp tone="ok" word="تم الصرف" sub={d.paidAt ? fmtDateTime(d.paidAt) : undefined} /> : null}
            {d.status === 'DISPUTED' ? <Stamp tone="bad" word="معترض عليه" /> : null}
          </header>

          <ol className="row no-print" style={{ listStyle: 'none', padding: 0, margin: 0 }} aria-label="مراحل الكشف">
            {STEPS.map((st, i) => (
              <li key={st}>
                <Chip tone={i < stepIndex || d.status === 'PAID' ? 'ok' : i === stepIndex ? (d.status === 'DISPUTED' ? 'bad' : 'warn') : 'plain'}>
                  {num(i + 1)}. {SETTLEMENT_LABEL[st]}
                </Chip>
              </li>
            ))}
          </ol>

          <Ledger
            head={<tr><th>البند</th><th className="amount">المبلغ</th></tr>}
            foot={<tr><td>الصافي المستحق للمدرس</td><td className="amount num">{egp(d.net)}</td></tr>}
          >
            <tr><td>إجمالي المحصّل من طلاب المدرس ({num(d.receipts)} إيصال، {num(d.payingStudents)} طالب)</td><td className="amount num">{egp(d.grossCollected)}</td></tr>
            {d.lines.map((l, i) => (
              <tr key={i}><td>{l.label}</td><td className="amount num">{egpP(l.amount)}</td></tr>
            ))}
            <tr><td>نصيب السنتر</td><td className="amount num">{egp(d.centerShare)}</td></tr>
            <tr><td>نصيب المدرس</td><td className="amount num">{egp(d.teacherShare)}</td></tr>
            {Number(d.advancesDeducted) ? <tr><td>سلف مخصومة</td><td className="amount num">− {egp(d.advancesDeducted)}</td></tr> : null}
          </Ledger>

          {Number(d.hoursUsed) ? <p className="muted">ساعات استخدام القاعات: <span className="num">{d.hoursUsed}</span></p> : null}
          {d.advancesCarried ? <p className="note warn">يتبقى {egpP(d.advancesCarried)} من السلف تُخصم من الشهر التالي.</p> : null}
          {d.pendingCancellations ? (
            <p className="note warn">يوجد {num(d.pendingCancellations)} إيصال عليه طلب إلغاء لم يُحسم، ولم يُحتسب في هذا الكشف.</p>
          ) : null}
          {d.disputeNote ? <p className="note error">اعتراض المدرس: {d.disputeNote}</p> : null}

          {d.confirmedAt || d.approvedAt || d.paidAt ? (
            <dl className="sign-off">
              {d.confirmedAt ? (<><dt>أكّده المدرس</dt><dd>{fmtDateTime(d.confirmedAt)}</dd></>) : null}
              {d.approvedAt ? (<><dt>اعتمده</dt><dd>{d.approvedBy} في {fmtDateTime(d.approvedAt)}</dd></>) : null}
              {d.paidAt ? (<><dt>صرفه</dt><dd>{d.paidBy} في {fmtDateTime(d.paidAt)} ({METHOD_LABEL[d.paymentMethod ?? ''] ?? d.paymentMethod})</dd></>) : null}
            </dl>
          ) : null}

          <section className="panel stack no-print">
            {d.isMine && (d.status === 'DRAFT' || d.status === 'DISPUTED') ? (
              <>
                <h3>مراجعتك</h3>
                <p className="muted">إن كانت الأرقام صحيحة أكّد الكشف ليُعتمد ويُصرف. وإن وجدت خطأ اكتب ملاحظتك وستصل للإدارة.</p>
                <div className="row">
                  <button className="btn" disabled={action.busy} onClick={() => act('confirm')}>أؤكد صحة الكشف</button>
                </div>
                {d.status === 'DRAFT' ? (
                  <div className="stack-sm">
                    <Field label="ملاحظة الاعتراض">
                      <textarea className="textarea" value={dispute} onChange={(e) => setDispute(e.target.value)} maxLength={500} />
                    </Field>
                    <div className="row">
                      <button className="btn quiet" disabled={action.busy || dispute.trim().length < 5} onClick={() => act('dispute', { note: dispute })}>
                        أرسل الاعتراض
                      </button>
                    </div>
                  </div>
                ) : null}
              </>
            ) : null}

            {!d.isMine && d.status === 'DISPUTED' && can('settlements.manage') ? (
              <p>راجع الاعتراض ثم أعد حساب الشهر من صفحة الكشوف بعد التصحيح، أو تواصل مع المدرس ليؤكد.</p>
            ) : null}

            {!d.isMine && d.status === 'TEACHER_CONFIRMED' && can('settlements.approve') ? (
              <div className="row">
                <button className="btn" disabled={action.busy} onClick={() => act('approve')}>اعتمد الكشف للصرف</button>
              </div>
            ) : null}

            {d.status === 'APPROVED' && can('settlements.pay') ? (
              <div className="row" style={{ alignItems: 'flex-end' }}>
                <Field label="طريقة الصرف">
                  <select className="select" value={method} onChange={(e) => setMethod(e.target.value)}>
                    {Object.entries(METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </Field>
                <button className="btn" disabled={action.busy} onClick={() => act('pay', { method })}>
                  سجّل صرف {egp(d.net)}
                </button>
                {method === 'CASH' ? <span className="faint">يُسجل مصروفًا على ورديتك المفتوحة.</span> : null}
              </div>
            ) : null}

            {d.status === 'PAID' ? <p className="muted">اكتملت دورة هذا الكشف.</p> : null}
          </section>
        </>
      ) : null}
    </div>
  );
}
