'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { cairoMonth, cairoToday, CONTRACT_LABEL, egp, fmtDate, fmtMonth, num, SETTLEMENT_LABEL, shiftMonth } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { SettlementView, TeacherOption } from '@/lib/types';
import { useAction, useLoad } from '@/lib/use-load';
import { Chip, Empty, ErrorNote, Field, Ledger, Loading, Modal, MonthInput, PageHead, Tabs } from '@/components/ui';

type Tab = 'statements' | 'contracts' | 'advances';

interface Contract {
  id: string;
  teacherMembershipId: string;
  type: keyof typeof CONTRACT_LABEL;
  teacherPct: string | null;
  hourlyRent: string | null;
  perStudentAmount: string | null;
  startsOn: string;
  endsOn: string | null;
  notes: string | null;
  teacher: { id: string; user: { name: string } };
}

interface Advance {
  id: string;
  amount: string;
  month: string;
  note: string | null;
  createdAt: string;
  teacher: { user: { name: string } };
}

const statusTone = (s: SettlementView['status']) =>
  s === 'PAID' ? 'ok' : s === 'APPROVED' ? 'info' : s === 'DISPUTED' ? 'bad' : s === 'DRAFT' ? 'warn' : 'plain';

function contractTerms(c: Pick<Contract, 'type' | 'teacherPct' | 'hourlyRent' | 'perStudentAmount'>) {
  switch (c.type) {
    case 'PERCENTAGE':
      return `${num(Number(c.teacherPct))}% للمدرس`;
    case 'HALL_RENT_HOURLY':
      return `${egp(c.hourlyRent)} للساعة`;
    case 'PER_STUDENT':
      return `${egp(c.perStudentAmount)} للسنتر عن كل طالب`;
    case 'MIXED':
      return `${num(Number(c.teacherPct))}% للمدرس، وللسنتر ${egp(c.perStudentAmount)} على الأقل عن كل طالب`;
    default:
      return '';
  }
}

export default function SettlementsPage() {
  const { can } = useSession();
  if (can('settlements.manage')) return <Manager />;
  if (can('settlements.read.own')) return <Mine />;
  return <div className="note warn">هذه الصفحة غير متاحة لدورك.</div>;
}

function Mine() {
  const list = useLoad(() => api<SettlementView[]>('/settlements/mine'), []);
  return (
    <>
      <PageHead title="كشوف حسابي" sub="راجع كل كشف وأكّده أو اعترض عليه قبل اعتماده وصرفه." />
      <ErrorNote error={list.error} onRetry={list.reload} />
      {list.loading && !list.data ? <Loading what="الكشوف" /> : null}
      {list.data && !list.data.length ? <Empty>لا توجد كشوف بعد. تظهر هنا بعد أن يحسب السنتر تسوية الشهر.</Empty> : null}
      {list.data?.length ? (
        <Ledger head={<tr><th>الشهر</th><th className="amount">المحصّل</th><th className="amount">نصيبك</th><th className="amount">الصافي</th><th>الحالة</th><th /></tr>}>
          {list.data.map((s) => (
            <tr key={s.id}>
              <td>{fmtMonth(s.month)}</td>
              <td className="amount num">{egp(s.grossCollected)}</td>
              <td className="amount num">{egp(s.teacherShare)}</td>
              <td className="amount num"><strong>{egp(s.net)}</strong></td>
              <td><Chip tone={statusTone(s.status)}>{SETTLEMENT_LABEL[s.status]}</Chip></td>
              <td><Link href={`/app/settlements/${s.id}`}>{s.status === 'DRAFT' ? 'راجع وأكّد' : 'افتح'}</Link></td>
            </tr>
          ))}
        </Ledger>
      ) : null}
    </>
  );
}

function Manager() {
  const [tab, setTab] = useState<Tab>('statements');
  return (
    <>
      <PageHead title="تسويات المدرسين" sub="الحساب من الإيصالات السارية فقط، والكشف لا يُصرف قبل تأكيد المدرس واعتماد الإدارة." />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        items={[
          { id: 'statements', label: 'الكشوف الشهرية' },
          { id: 'contracts', label: 'العقود' },
          { id: 'advances', label: 'السلف' },
        ]}
      />
      {tab === 'statements' ? <Statements /> : null}
      {tab === 'contracts' ? <Contracts /> : null}
      {tab === 'advances' ? <Advances /> : null}
    </>
  );
}

function Statements() {
  const { current } = useSession();
  const [month, setMonth] = useState(shiftMonth(cairoMonth(), -1));
  const list = useLoad(() => api<SettlementView[]>('/settlements', { query: { month } }), [month, current?.workspace.id]);
  const action = useAction();
  const [notice, setNotice] = useState<string | null>(null);

  const calculate = () =>
    void action.run(async () => {
      const r = await api<{ results: { teacher: string; skipped?: string }[] }>('/settlements/calculate', { method: 'POST', body: { month } });
      const skipped = r.results.filter((x) => x.skipped).length;
      setNotice(
        r.results.length
          ? `حُسبت ${num(r.results.length - skipped)} كشوف${skipped ? `، وتُركت ${num(skipped)} مؤكدة كما هي` : ''}. أُبلغ المدرسون للمراجعة.`
          : 'لا توجد عقود سارية في هذا الشهر. أضف عقود المدرسين أولًا.',
      );
      await list.reload();
    });

  const total = (list.data ?? []).reduce((t, s) => t + Number(s.net), 0);

  return (
    <div className="stack">
      <div className="row-between">
        <div style={{ width: 200 }}><MonthInput value={month} onChange={setMonth} /></div>
        <button className="btn" onClick={calculate} disabled={action.busy}>
          {action.busy ? 'جارٍ الحساب…' : `احسب تسويات ${fmtMonth(month)}`}
        </button>
      </div>
      {notice ? <div className="note info">{notice}</div> : null}
      <ErrorNote error={list.error ?? action.error} onRetry={list.reload} />
      {list.loading && !list.data ? <Loading what="الكشوف" /> : null}
      {list.data && !list.data.length ? <Empty>لم تُحسب تسويات هذا الشهر بعد.</Empty> : null}
      {list.data?.length ? (
        <Ledger
          head={<tr><th>المدرس</th><th>الصيغة</th><th className="amount">المحصّل</th><th className="amount">نصيب المدرس</th><th className="amount">نصيب السنتر</th><th className="amount">السلف</th><th className="amount">الصافي</th><th>الحالة</th><th /></tr>}
          foot={<tr><td colSpan={6}>إجمالي المستحق للمدرسين</td><td className="amount num">{egp(total)}</td><td colSpan={2} /></tr>}
        >
          {list.data.map((s) => (
            <tr key={s.id}>
              <td>{s.teacherName}</td>
              <td className="faint">{CONTRACT_LABEL[s.contractType] ?? s.contractType}</td>
              <td className="amount num">{egp(s.grossCollected)}</td>
              <td className="amount num">{egp(s.teacherShare)}</td>
              <td className="amount num">{egp(s.centerShare)}</td>
              <td className="amount num">{Number(s.advancesDeducted) ? `− ${egp(s.advancesDeducted)}` : '—'}</td>
              <td className="amount num"><strong>{egp(s.net)}</strong></td>
              <td>
                <Chip tone={statusTone(s.status)}>{SETTLEMENT_LABEL[s.status]}</Chip>
                {s.pendingCancellations ? <div className="faint">{num(s.pendingCancellations)} طلب إلغاء معلق</div> : null}
              </td>
              <td><Link href={`/app/settlements/${s.id}`}>الكشف</Link></td>
            </tr>
          ))}
        </Ledger>
      ) : null}
    </div>
  );
}

function Contracts() {
  const { current, can } = useSession();
  const contracts = useLoad(() => api<Contract[]>('/settlements/contracts'), [current?.workspace.id]);
  const teachers = useLoad(() => api<TeacherOption[]>('/workspaces/current/teachers'), [current?.workspace.id]);
  const [open, setOpen] = useState(false);
  const action = useAction();

  const end = (c: Contract) => {
    const endsOn = window.prompt('تاريخ انتهاء العقد (YYYY-MM-DD)', cairoToday());
    if (!endsOn) return;
    void action.run(async () => {
      await api(`/settlements/contracts/${c.id}/end`, { method: 'POST', body: { endsOn } });
      await contracts.reload();
    });
  };

  return (
    <div className="stack">
      {can('staff.manage') ? <div className="row"><button className="btn" onClick={() => setOpen(true)}>عقد جديد</button></div> : null}
      <ErrorNote error={contracts.error ?? action.error} onRetry={contracts.reload} />
      {contracts.loading && !contracts.data ? <Loading what="العقود" /> : null}
      {contracts.data && !contracts.data.length ? <Empty>لا توجد عقود. العقد يحدد طريقة تقسيم الإيراد مع كل مدرس.</Empty> : null}
      {contracts.data?.length ? (
        <Ledger head={<tr><th>المدرس</th><th>الصيغة</th><th>الشروط</th><th>من</th><th>إلى</th><th /></tr>}>
          {contracts.data.map((c) => (
            <tr key={c.id} className={c.endsOn && c.endsOn.slice(0, 10) < cairoToday() ? 'is-void' : undefined}>
              <td>{c.teacher.user.name}</td>
              <td>{CONTRACT_LABEL[c.type]}</td>
              <td>{contractTerms(c)}{c.notes ? <div className="faint">{c.notes}</div> : null}</td>
              <td className="num">{c.startsOn.slice(0, 10)}</td>
              <td className="num">{c.endsOn ? c.endsOn.slice(0, 10) : <Chip tone="ok">ساري</Chip>}</td>
              <td>{!c.endsOn && can('staff.manage') ? <button className="btn ghost" onClick={() => end(c)}>إنهاء</button> : null}</td>
            </tr>
          ))}
        </Ledger>
      ) : null}
      <p className="faint">إضافة عقد جديد لمدرس تنهي عقده السابق تلقائيًا في اليوم السابق لبدايته.</p>

      <Modal open={open} title="عقد مدرس" onClose={() => setOpen(false)}>
        {open ? (
          <ContractForm
            teachers={(teachers.data ?? []).filter((t) => t.role === 'TEACHER')}
            onDone={() => { setOpen(false); void contracts.reload(); }}
          />
        ) : null}
      </Modal>
    </div>
  );
}

function ContractForm({ teachers, onDone }: { teachers: TeacherOption[]; onDone: () => void }) {
  const [f, setF] = useState({ teacherMembershipId: '', type: 'PERCENTAGE', teacherPct: '70', hourlyRent: '', perStudentAmount: '', startsOn: `${cairoMonth()}-01`, notes: '' });
  const { busy, error, run } = useAction();
  const needPct = f.type === 'PERCENTAGE' || f.type === 'MIXED';
  const needRent = f.type === 'HALL_RENT_HOURLY';
  const needPer = f.type === 'PER_STUDENT' || f.type === 'MIXED';

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api('/settlements/contracts', {
        method: 'POST',
        body: {
          teacherMembershipId: f.teacherMembershipId,
          type: f.type,
          teacherPct: needPct ? Number(f.teacherPct) : undefined,
          hourlyRent: needRent ? Number(f.hourlyRent) : undefined,
          perStudentAmount: needPer ? Number(f.perStudentAmount) : undefined,
          startsOn: f.startsOn,
          notes: f.notes || undefined,
        },
      });
      onDone();
    });
  };

  if (!teachers.length) return <p>لا يوجد مدرسون في الفريق. أضفهم من صفحة الفريق أولًا.</p>;

  return (
    <form className="stack" onSubmit={submit}>
      <div className="form-grid">
        <Field label="المدرس">
          <select className="select" value={f.teacherMembershipId} onChange={(e) => setF({ ...f, teacherMembershipId: e.target.value })} required>
            <option value="">اختر</option>
            {teachers.map((t) => <option key={t.membershipId} value={t.membershipId}>{t.name}</option>)}
          </select>
        </Field>
        <Field label="صيغة التعاقد">
          <select className="select" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
            {Object.entries(CONTRACT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        {needPct ? (
          <Field label="نسبة المدرس %"><input className="input" type="number" min={0} max={100} step="0.5" value={f.teacherPct} onChange={(e) => setF({ ...f, teacherPct: e.target.value })} required /></Field>
        ) : null}
        {needRent ? (
          <Field label="إيجار الساعة (ج.م)"><input className="input" type="number" min={0} step="0.5" value={f.hourlyRent} onChange={(e) => setF({ ...f, hourlyRent: e.target.value })} required /></Field>
        ) : null}
        {needPer ? (
          <Field label={f.type === 'MIXED' ? 'الحد الأدنى للسنتر عن كل طالب (ج.م)' : 'نصيب السنتر عن كل طالب (ج.م)'}>
            <input className="input" type="number" min={0} step="0.5" value={f.perStudentAmount} onChange={(e) => setF({ ...f, perStudentAmount: e.target.value })} required />
          </Field>
        ) : null}
        <Field label="يبدأ من"><input className="input" type="date" value={f.startsOn} onChange={(e) => setF({ ...f, startsOn: e.target.value })} required /></Field>
        <Field label="ملاحظات"><input className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} maxLength={300} /></Field>
      </div>
      {error ? <div className="note error">{error}</div> : null}
      <button className="btn" disabled={busy}>احفظ العقد</button>
    </form>
  );
}

function Advances() {
  const { current } = useSession();
  const [month, setMonth] = useState(cairoMonth());
  const list = useLoad(() => api<Advance[]>('/settlements/advances', { query: { month } }), [month, current?.workspace.id]);
  const teachers = useLoad(() => api<TeacherOption[]>('/workspaces/current/teachers'), [current?.workspace.id]);
  const [f, setF] = useState({ teacherMembershipId: '', amount: '', note: '' });
  const action = useAction();

  const add = (e: FormEvent) => {
    e.preventDefault();
    void action.run(async () => {
      await api('/settlements/advances', { method: 'POST', body: { ...f, amount: Number(f.amount), month, note: f.note || undefined } });
      setF({ teacherMembershipId: '', amount: '', note: '' });
      await list.reload();
    });
  };

  return (
    <div className="split">
      <section className="stack">
        <div style={{ width: 200 }}><MonthInput value={month} onChange={setMonth} /></div>
        <ErrorNote error={list.error} onRetry={list.reload} />
        {list.loading && !list.data ? <Loading what="السلف" /> : null}
        {list.data && !list.data.length ? <Empty>لا توجد سلف مسجلة لشهر {fmtMonth(month)}.</Empty> : null}
        {list.data?.length ? (
          <Ledger head={<tr><th>المدرس</th><th className="amount">المبلغ</th><th>ملاحظة</th><th>التاريخ</th></tr>}>
            {list.data.map((a) => (
              <tr key={a.id}>
                <td>{a.teacher.user.name}</td>
                <td className="amount num">{egp(a.amount)}</td>
                <td>{a.note ?? '—'}</td>
                <td className="faint">{fmtDate(a.createdAt)}</td>
              </tr>
            ))}
          </Ledger>
        ) : null}
        <p className="faint">تُخصم السلفة من تسوية نفس الشهر، وما يزيد عن المستحق يُرحَّل للشهر التالي تلقائيًا.</p>
      </section>
      <form className="panel stack" onSubmit={add}>
        <h3>سلفة جديدة لشهر {fmtMonth(month)}</h3>
        <Field label="المدرس">
          <select className="select" value={f.teacherMembershipId} onChange={(e) => setF({ ...f, teacherMembershipId: e.target.value })} required>
            <option value="">اختر</option>
            {(teachers.data ?? []).filter((t) => t.role === 'TEACHER').map((t) => <option key={t.membershipId} value={t.membershipId}>{t.name}</option>)}
          </select>
        </Field>
        <Field label="المبلغ (ج.م)"><input className="input" type="number" min={0.01} step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} required /></Field>
        <Field label="ملاحظة"><input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={200} /></Field>
        {action.error ? <div className="note error">{action.error}</div> : null}
        <button className="btn" disabled={action.busy}>سجّل السلفة</button>
      </form>
    </div>
  );
}
