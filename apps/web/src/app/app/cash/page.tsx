'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { cairoMonth, egp, egpP, fmtDateTime, fmtTime, METHOD_LABEL, num } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { DueView, Receipt, Shift, ShiftTotals, StudentListItem } from '@/lib/types';
import { useAction, useLoad } from '@/lib/use-load';
import { Guard } from '@/components/app-shell';
import { Chip, Empty, ErrorNote, Field, Ledger, Loading, Modal, PageHead } from '@/components/ui';

interface ProfileLite {
  student: { id: string; fullName: string; grade: string };
  enrollments: { id: string; code: string; status: string; discountPct: number; group: { name: string; teacherName: string }; due?: DueView }[];
}

interface Issued extends Receipt {
  remainingAfter: number;
}

export default function CashPage() {
  return (
    <Guard perm="finance.collect">
      <Cash />
    </Guard>
  );
}

function Cash() {
  const { can, current } = useSession();
  const wsId = current?.workspace.id;
  const shift = useLoad(() => api<{ shift: Shift | null; totals?: ShiftTotals }>('/finance/shifts/current'), [wsId]);
  const receipts = useLoad(() => api<Receipt[]>('/finance/receipts', { query: { month: cairoMonth() } }), [wsId]);
  const [cancelFor, setCancelFor] = useState<Receipt | null>(null);
  const [expense, setExpense] = useState(false);

  const refresh = useCallback(() => {
    void shift.reload();
    void receipts.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shift.reload, receipts.reload]);

  return (
    <>
      <PageHead title="الخزنة والتحصيل" sub="كل مبلغ يُستلم بإيصال مرقم تسلسليًا. النقدي يحتاج وردية مفتوحة.">
        {can('finance.expense') ? <button className="btn quiet" onClick={() => setExpense(true)}>سجّل مصروفًا</button> : null}
      </PageHead>

      <div className="split">
        <div className="stack">
          <CollectPanel hasShift={Boolean(shift.data?.shift)} onIssued={refresh} />

          <section className="stack-sm">
            <div className="row-between">
              <h2>{can('finance.reports') ? 'إيصالات هذا الشهر' : 'إيصالاتك هذا الشهر'}</h2>
              <button className="btn ghost" onClick={() => void receipts.reload()}>تحديث</button>
            </div>
            <ErrorNote error={receipts.error} onRetry={receipts.reload} />
            {receipts.loading && !receipts.data ? <Loading what="الإيصالات" /> : null}
            {receipts.data && !receipts.data.length ? <Empty>لم يصدر أي إيصال هذا الشهر.</Empty> : null}
            {receipts.data?.length ? (
              <Ledger head={<tr><th>رقم</th><th>الطالب</th><th>عن شهر</th><th className="amount">المبلغ</th><th>الطريقة</th><th>الوقت</th><th /></tr>}>
                {receipts.data.slice(0, 100).map((r) => (
                  <tr key={r.id} className={r.status === 'CANCELLED' ? 'is-void' : undefined}>
                    <td className="num">{r.number}</td>
                    <td>{r.student}<div className="faint">{r.group}</div></td>
                    <td className="num">{r.forMonth}</td>
                    <td className="amount num">{egp(r.amount)}{Number(r.discountAmount) ? <div className="faint">خصم {egp(r.discountAmount)}</div> : null}</td>
                    <td>{METHOD_LABEL[r.method] ?? r.method}</td>
                    <td className="faint">{fmtDateTime(r.createdAt)}</td>
                    <td>
                      <div className="row" style={{ gap: '0.25rem' }}>
                        {r.status === 'CANCEL_REQUESTED' ? <Chip tone="warn">بانتظار اعتماد الإلغاء</Chip> : null}
                        {r.status === 'CANCELLED' ? <Chip tone="bad">ملغى</Chip> : null}
                        {r.status === 'VALID' ? <Link className="btn ghost" href={`/print/receipt/${r.id}`} target="_blank">اطبع</Link> : null}
                        {r.status === 'VALID' && can('finance.cancel.request') ? (
                          <button className="btn ghost" onClick={() => setCancelFor(r)}>طلب إلغاء</button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </Ledger>
            ) : null}
          </section>
        </div>

        <aside className="stack">
          {can('finance.shift') ? <ShiftPanel data={shift.data} loading={shift.loading} error={shift.error} onChange={refresh} /> : null}
        </aside>
      </div>

      <Modal open={Boolean(cancelFor)} title={`طلب إلغاء الإيصال ${cancelFor?.number ?? ''}`} onClose={() => setCancelFor(null)}>
        {cancelFor ? <CancelRequest receipt={cancelFor} onDone={() => { setCancelFor(null); refresh(); }} /> : null}
      </Modal>
      <Modal open={expense} title="مصروف جديد" onClose={() => setExpense(false)}>
        {expense ? <ExpenseForm hasShift={Boolean(shift.data?.shift)} onDone={() => { setExpense(false); refresh(); }} /> : null}
      </Modal>
    </>
  );
}

function ShiftPanel({ data, loading, error, onChange }: { data: { shift: Shift | null; totals?: ShiftTotals } | null; loading: boolean; error: string | null; onChange: () => void }) {
  const [opening, setOpening] = useState('0');
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const [result, setResult] = useState<number | null>(null);
  const action = useAction();

  if (loading && !data) return <section className="panel"><Loading what="الوردية" /></section>;

  const open = (e: FormEvent) => {
    e.preventDefault();
    void action.run(async () => {
      await api('/finance/shifts/open', { method: 'POST', body: { openingBalance: Number(opening) || 0 } });
      setResult(null);
      onChange();
    });
  };

  const close = (e: FormEvent) => {
    e.preventDefault();
    if (!data?.shift) return;
    void action.run(async () => {
      const r = await api<{ variance: number }>(`/finance/shifts/${data.shift!.id}/close`, {
        method: 'POST',
        body: { countedCash: Number(counted), note: note || undefined },
      });
      setResult(r.variance);
      setCounted('');
      setNote('');
      onChange();
    });
  };

  return (
    <section className="panel board stack">
      <h2>الوردية</h2>
      {error ? <div className="note error">{error}</div> : null}
      {result !== null ? (
        <div className={`note ${result === 0 ? 'info' : 'warn'}`}>
          {result === 0 ? 'أُغلقت الوردية والنقدية مطابقة.' : `أُغلقت الوردية بفرق ${egpP(result)}، وأُبلغت الإدارة.`}
        </div>
      ) : null}

      {!data?.shift ? (
        <form className="stack-sm" onSubmit={open}>
          <p>لا توجد وردية مفتوحة لك.</p>
          <Field label="رصيد الدرج عند البداية (ج.م)">
            <input className="input" type="number" min={0} step="0.5" value={opening} onChange={(e) => setOpening(e.target.value)} />
          </Field>
          <button className="btn" disabled={action.busy}>افتح الوردية</button>
        </form>
      ) : (
        <>
          <p>مفتوحة منذ الساعة <span className="num">{fmtTime(data.shift.openedAt)}</span></p>
          {data.totals ? (
            <>
              <div>
                <div className="faint" style={{ color: '#b8cec5' }}>المتوقع في الدرج</div>
                <div className="big-figure num">{egpP(data.totals.expectedCash)}</div>
              </div>
              <table style={{ width: '100%', fontSize: '0.875rem' }}>
                <tbody>
                  <tr><td>رصيد البداية</td><td className="num" style={{ textAlign: 'end' }}>{egpP(data.totals.opening)}</td></tr>
                  {Object.entries(data.totals.methods).map(([m, v]) => (
                    <tr key={m}><td>{METHOD_LABEL[m] ?? m} ({num(v.count)})</td><td className="num" style={{ textAlign: 'end' }}>{egpP(v.amount)}</td></tr>
                  ))}
                  <tr><td>مصروفات من الدرج</td><td className="num" style={{ textAlign: 'end' }}>− {egpP(data.totals.expenses)}</td></tr>
                </tbody>
              </table>
            </>
          ) : null}
          <form className="stack-sm" onSubmit={close}>
            <Field label="النقدية الفعلية بعد العد (ج.م)">
              <input className="input" type="number" min={0} step="0.5" value={counted} onChange={(e) => setCounted(e.target.value)} required />
            </Field>
            <Field label="ملاحظة (اختياري)">
              <input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
            </Field>
            <button className="btn danger" disabled={action.busy || counted === ''}>اقفل الوردية</button>
          </form>
        </>
      )}
      {action.error ? <div className="note error">{action.error}</div> : null}
    </section>
  );
}

function CollectPanel({ hasShift, onIssued }: { hasShift: boolean; onIssued: () => void }) {
  const { can, current } = useSession();
  const [search, setSearch] = useState('');
  const [matches, setMatches] = useState<StudentListItem[]>([]);
  const [profile, setProfile] = useState<ProfileLite | null>(null);
  const [f, setF] = useState({ enrollmentId: '', forMonth: cairoMonth(), amount: '', method: 'CASH', discountAmount: '', note: '' });
  const [issued, setIssued] = useState<Issued | null>(null);
  const action = useAction();

  const loadStudent = useCallback(
    async (studentId: string, enrollmentId?: string) => {
      const p = await api<ProfileLite>(`/students/${studentId}`);
      setProfile(p);
      setMatches([]);
      const e = p.enrollments.find((x) => x.id === enrollmentId) ?? p.enrollments.find((x) => x.status === 'ACTIVE') ?? p.enrollments[0];
      setF((old) => ({
        ...old,
        enrollmentId: e?.id ?? '',
        amount: e?.due?.remaining ? String(e.due.remaining / 100) : '',
        discountAmount: '',
        note: '',
      }));
    },
    [],
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sid = params.get('student');
    if (sid) void action.run(() => loadStudent(sid, params.get('enrollment') ?? undefined));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadStudent]);

  const find = (e: FormEvent) => {
    e.preventDefault();
    const term = search.trim();
    if (!term) return;
    setIssued(null);
    void action.run(async () => {
      if (/^\d{6}$/.test(term)) {
        const r = await api<{ studentId: string; enrollmentId: string }>(`/students/by-code/${term}`);
        await loadStudent(r.studentId, r.enrollmentId);
      } else {
        const r = await api<{ items: StudentListItem[] }>('/students', { query: { q: term } });
        setProfile(null);
        setMatches(r.items);
      }
    });
  };

  const collect = (e: FormEvent) => {
    e.preventDefault();
    void action.run(async () => {
      const r = await api<Issued>('/finance/receipts', {
        method: 'POST',
        body: {
          enrollmentId: f.enrollmentId,
          forMonth: f.forMonth,
          amount: Number(f.amount),
          method: f.method,
          discountAmount: f.discountAmount ? Number(f.discountAmount) : undefined,
          note: f.note || undefined,
        },
      });
      setIssued(r);
      setProfile(null);
      setSearch('');
      onIssued();
    });
  };

  const enrollment = profile?.enrollments.find((x) => x.id === f.enrollmentId);
  const isManager = current?.me.role === 'OWNER' || current?.me.role === 'MANAGER';

  return (
    <section className="panel stack">
      <h2>استلام مبلغ</h2>
      <form className="row" onSubmit={find}>
        <label className="grow">
          <span className="sr-only">كود الطالب أو اسمه</span>
          <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="كود الطالب (6 أرقام) أو اسمه" />
        </label>
        <button className="btn quiet" disabled={action.busy || !search.trim()}>ابحث</button>
      </form>

      {issued ? (
        <div className="note info row-between" role="status">
          <span>
            صدر الإيصال رقم <strong className="num">{issued.number}</strong> بمبلغ {egp(issued.amount)}.
            {issued.remainingAfter > 0 ? ` المتبقي على الطالب لهذا الشهر ${egpP(issued.remainingAfter)}.` : ' الشهر مسدد بالكامل.'}
          </span>
          <Link className="btn" href={`/print/receipt/${issued.id}`} target="_blank">اطبع الإيصال</Link>
        </div>
      ) : null}

      {matches.length ? (
        <ul className="stack-sm" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {matches.slice(0, 10).map((m) => (
            <li key={m.enrollmentId} className="row-between">
              <span>{m.fullName} <span className="faint">({m.group.name}، كود {m.code})</span></span>
              <button className="btn ghost" onClick={() => void action.run(() => loadStudent(m.studentId, m.enrollmentId))}>اختر</button>
            </li>
          ))}
        </ul>
      ) : null}

      {profile ? (
        <form className="stack" onSubmit={collect}>
          <div className="row-between">
            <div>
              <strong>{profile.student.fullName}</strong>
              <div className="faint">{profile.student.grade}</div>
            </div>
            <Link href={`/app/students/${profile.student.id}`}>ملف الطالب</Link>
          </div>
          <div className="form-grid">
            <Field label="الاشتراك">
              <select className="select" value={f.enrollmentId} onChange={(e) => {
                const en = profile.enrollments.find((x) => x.id === e.target.value);
                setF({ ...f, enrollmentId: e.target.value, amount: en?.due?.remaining ? String(en.due.remaining / 100) : '' });
              }}>
                {profile.enrollments.map((x) => (
                  <option key={x.id} value={x.id} disabled={x.status === 'WAITLIST' || x.status === 'LEFT'}>
                    {x.group.name} ({x.group.teacherName})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="عن شهر">
              <input className="input" type="month" value={f.forMonth} onChange={(e) => e.target.value && setF({ ...f, forMonth: e.target.value })} />
            </Field>
            <Field label="المبلغ (ج.م)" hint={enrollment?.due?.remaining !== undefined && f.forMonth === cairoMonth() ? `المتبقي هذا الشهر ${egpP(enrollment.due.remaining)}` : undefined}>
              <input className="input" type="number" min={0.01} step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} required />
            </Field>
            <Field label="طريقة الدفع">
              <select className="select" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>
                {Object.entries(METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            {can('finance.discount') ? (
              <Field label="خصم (ج.م)" hint={isManager ? undefined : `حتى ${num(current?.workspace.receptionMaxDiscountPct)}% من الاشتراك`}>
                <input className="input" type="number" min={0} step="0.01" value={f.discountAmount} onChange={(e) => setF({ ...f, discountAmount: e.target.value })} />
              </Field>
            ) : null}
            <Field label="ملاحظة">
              <input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={200} />
            </Field>
          </div>
          {f.method === 'CASH' && !hasShift ? <div className="note warn">افتح وردية أولًا لاستلام النقدية.</div> : null}
          <div className="row">
            <button className="btn big" disabled={action.busy || !f.enrollmentId || !Number(f.amount) || (f.method === 'CASH' && !hasShift)}>
              {action.busy ? 'جارٍ الإصدار…' : `استلم ${f.amount ? egp(f.amount) : ''} وأصدر الإيصال`}
            </button>
          </div>
        </form>
      ) : null}
      {action.error ? <div className="note error" role="alert">{action.error}</div> : null}
    </section>
  );
}

function CancelRequest({ receipt, onDone }: { receipt: Receipt; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const { busy, error, run } = useAction();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api(`/finance/receipts/${receipt.id}/cancel-request`, { method: 'POST', body: { reason } });
      onDone();
    });
  };
  return (
    <form className="stack" onSubmit={submit}>
      <p>
        إيصال بمبلغ {egp(receipt.amount)} للطالب {receipt.student}. الإلغاء لا يتم إلا بعد اعتماد المدير، ويبقى الإيصال
        ظاهرًا في السجل مشطوبًا.
      </p>
      <Field label="سبب الإلغاء">
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} required minLength={5} maxLength={300} />
      </Field>
      {error ? <div className="note error">{error}</div> : null}
      <button className="btn danger" disabled={busy || reason.trim().length < 5}>أرسل طلب الإلغاء</button>
    </form>
  );
}

function ExpenseForm({ hasShift, onDone }: { hasShift: boolean; onDone: () => void }) {
  const [f, setF] = useState({ amount: '', category: '', note: '', fromCash: hasShift });
  const { busy, error, run } = useAction();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api('/finance/expenses', { method: 'POST', body: { amount: Number(f.amount), category: f.category, note: f.note || undefined, fromCash: f.fromCash } });
      onDone();
    });
  };
  return (
    <form className="stack" onSubmit={submit}>
      <div className="form-grid">
        <Field label="المبلغ (ج.م)"><input className="input" type="number" min={0.01} step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} required /></Field>
        <Field label="البند">
          <input className="input" list="expense-cats" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} required minLength={2} maxLength={40} />
          <datalist id="expense-cats">
            {['كهرباء', 'إيجار', 'مرتبات', 'بوفيه وأدوات', 'طباعة وورق', 'صيانة', 'دعاية'].map((c) => <option key={c} value={c} />)}
          </datalist>
        </Field>
        <Field label="ملاحظة"><input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={200} /></Field>
      </div>
      <label className="row">
        <input type="checkbox" checked={f.fromCash} disabled={!hasShift} onChange={(e) => setF({ ...f, fromCash: e.target.checked })} />
        <span>مدفوع من درج ورديتي الحالية{!hasShift ? ' (لا توجد وردية مفتوحة)' : ''}</span>
      </label>
      {error ? <div className="note error">{error}</div> : null}
      <button className="btn" disabled={busy}>سجّل المصروف</button>
    </form>
  );
}
