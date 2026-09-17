'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';
import { cairoMonth, egpP, fmtMonth, localPhone, num } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { GroupRow } from '@/lib/types';
import { useLoad } from '@/lib/use-load';
import { Guard } from '@/components/app-shell';
import { Empty, ErrorNote, Field, Ledger, Loading, MonthInput, PageHead } from '@/components/ui';

interface DuesResponse {
  month: string;
  count: number;
  totalRemaining: number;
  items: {
    enrollmentId: string;
    code: string;
    student: string;
    guardianName: string;
    guardianPhone: string;
    group: string;
    teacher: string;
    paid: number;
    remaining: number;
  }[];
}

export default function DuesPage() {
  return (
    <Guard perm="finance.dues">
      <Dues />
    </Guard>
  );
}

function Dues() {
  const { current } = useSession();
  const [month, setMonth] = useState(cairoMonth());
  const [groupId, setGroupId] = useState('');
  const groups = useLoad(() => api<GroupRow[]>('/academics/groups').catch(() => [] as GroupRow[]), [current?.workspace.id]);
  const dues = useLoad(() => api<DuesResponse>('/finance/dues', { query: { month, groupId } }), [month, groupId, current?.workspace.id]);

  const reminder = (i: DuesResponse['items'][number]) =>
    encodeURIComponent(
      `السلام عليكم ${i.guardianName}، نذكّركم بأن اشتراك ${i.student} في ${i.group} عن شهر ${fmtMonth(month)} متبقٍ منه ${egpP(i.remaining)}. ${current?.workspace.name ?? ''}`,
    );

  return (
    <>
      <PageHead title="المتأخرات" sub={dues.data ? `${num(dues.data.count)} طالب، إجمالي المتبقي ${egpP(dues.data.totalRemaining)}` : undefined}>
        <button className="btn ghost no-print" onClick={() => window.print()}>اطبع القائمة</button>
      </PageHead>
      <div className="form-grid no-print" style={{ marginBottom: '1rem' }}>
        <MonthInput value={month} onChange={setMonth} />
        <Field label="المجموعة">
          <select className="select" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <option value="">كل المجموعات</option>
            {groups.data?.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </Field>
      </div>
      <ErrorNote error={dues.error} onRetry={dues.reload} />
      {dues.loading && !dues.data ? <Loading what="المتأخرات" /> : null}
      {dues.data && !dues.data.items.length ? <Empty>لا توجد متأخرات لشهر {fmtMonth(month)}.</Empty> : null}
      {dues.data?.items.length ? (
        <Ledger
          head={<tr><th>الطالب</th><th>المجموعة</th><th>ولي الأمر</th><th className="amount">المدفوع</th><th className="amount">المتبقي</th><th className="no-print">تواصل</th></tr>}
          foot={<tr><td colSpan={4}>الإجمالي</td><td className="amount num">{egpP(dues.data.totalRemaining)}</td><td className="no-print" /></tr>}
        >
          {dues.data.items.map((i) => (
            <tr key={i.enrollmentId}>
              <td>{i.student}<div className="faint num">كود {i.code}</div></td>
              <td>{i.group}<div className="faint">{i.teacher}</div></td>
              <td>{i.guardianName}<div className="faint num">{localPhone(i.guardianPhone)}</div></td>
              <td className="amount num">{egpP(i.paid)}</td>
              <td className="amount num"><span className="mark">{egpP(i.remaining)}</span></td>
              <td className="no-print">
                <div className="row" style={{ gap: '0.25rem' }}>
                  <a className="btn ghost" href={`tel:${i.guardianPhone}`}>اتصال</a>
                  <a className="btn ghost" href={`https://wa.me/${i.guardianPhone.replace(/^\+/, '')}?text=${reminder(i)}`} target="_blank" rel="noopener noreferrer">واتساب</a>
                </div>
              </td>
            </tr>
          ))}
        </Ledger>
      ) : null}
      <p className="faint no-print" style={{ marginTop: '1rem' }}>
        التحصيل يتم من <Link href="/app/cash">الخزنة</Link> بكود الطالب.
      </p>
    </>
  );
}
