'use client';

import { useParams } from 'next/navigation';
import { useEffect } from 'react';
import { api } from '@/lib/api';
import { egp, fmtDateTime, fmtMonth, METHOD_LABEL } from '@/lib/format';
import { useLoad } from '@/lib/use-load';
import { ErrorNote, Loading, Stamp } from '@/components/ui';

interface PrintableReceipt {
  id: string;
  number: number;
  workspaceName: string;
  amount: string;
  discountAmount: string;
  method: string;
  forMonth: string;
  note: string | null;
  status: 'VALID' | 'CANCEL_REQUESTED' | 'CANCELLED';
  createdAt: string;
  issuedBy: string;
  student: { fullName: string; grade: string };
  code: string;
  group: string;
  subject: string;
  teacher: string;
}

/** إيصال بعرض 80 مم يناسب الطابعات الحرارية */
export default function ReceiptPrint() {
  const { id } = useParams<{ id: string }>();
  const r = useLoad(() => api<PrintableReceipt>(`/finance/receipts/${id}`), [id]);

  useEffect(() => {
    if (r.data && r.data.status !== 'CANCELLED') {
      const t = setTimeout(() => window.print(), 400);
      return () => clearTimeout(t);
    }
  }, [r.data]);

  const d = r.data;
  return (
    <main>
      <ErrorNote error={r.error} onRetry={r.reload} />
      {r.loading && !d ? <Loading what="الإيصال" /> : null}
      {d ? (
        <>
          <article className="receipt">
            <h1>{d.workspaceName}</h1>
            <p style={{ textAlign: 'center', margin: 0 }}>إيصال استلام نقدية رقم <strong className="num">{d.number}</strong></p>
            <dl>
              <dt>الطالب</dt><dd>{d.student.fullName}</dd>
              <dt>الكود</dt><dd className="num">{d.code}</dd>
              <dt>المجموعة</dt><dd>{d.group}</dd>
              <dt>المدرس</dt><dd>{d.teacher}</dd>
              <dt>عن شهر</dt><dd>{fmtMonth(d.forMonth)}</dd>
              <dt>المبلغ</dt><dd className="num" style={{ fontSize: '1.2rem' }}>{egp(d.amount)}</dd>
              {Number(d.discountAmount) ? (<><dt>خصم</dt><dd className="num">{egp(d.discountAmount)}</dd></>) : null}
              <dt>الطريقة</dt><dd>{METHOD_LABEL[d.method] ?? d.method}</dd>
              <dt>التاريخ</dt><dd>{fmtDateTime(d.createdAt)}</dd>
              <dt>المستلم</dt><dd>{d.issuedBy}</dd>
              {d.note ? (<><dt>ملاحظة</dt><dd>{d.note}</dd></>) : null}
            </dl>
            {d.status === 'CANCELLED' ? <Stamp tone="bad" word="ملغى" /> : <Stamp tone="ok" word="مدفوع" />}
            <p className="faint" style={{ textAlign: 'center', marginTop: '3.5rem' }}>
              يصل ولي الأمر إشعار بكل إيصال على تطبيق حصّة. احتفظ بهذا الإيصال.
            </p>
          </article>
          <div className="row no-print" style={{ justifyContent: 'center' }}>
            <button className="btn" onClick={() => window.print()}>اطبع</button>
            <button className="btn ghost" onClick={() => window.close()}>إغلاق</button>
          </div>
        </>
      ) : null}
    </main>
  );
}
