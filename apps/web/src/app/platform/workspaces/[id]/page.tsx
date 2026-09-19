'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { ACCESS_LABEL, ACCESS_TONE, egp, fmtDate, fmtDateTime, METHOD_LABEL, num, ROLE_LABEL, WS_STATUS_LABEL } from '@/lib/format';
import {
  actionLabel, dateInput, endOfDayIso, metaText, TYPE_LABEL,
  type AuditItem, type MemberRow, type Plan, type UserRow, type WorkspaceDetail,
} from '@/lib/platform';
import { useAction, useLoad } from '@/lib/use-load';
import { CredentialsCard, type Credentials } from '@/components/credentials';
import { NewUserFields, UserPicker } from '@/components/platform-forms';
import { IfCan, usePlatform } from '@/components/platform-shell';
import { Chip, Empty, ErrorNote, Field, Ledger, Loading, Modal, PageHead, Tabs } from '@/components/ui';

type Tab = 'overview' | 'team' | 'billing' | 'notes' | 'audit' | 'danger';
const ROLES = ['OWNER', 'MANAGER', 'TEACHER', 'RECEPTION', 'ACCOUNTANT', 'ASSISTANT', 'FOLLOWUP'];

export default function WorkspaceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = usePlatform();
  const [tab, setTab] = useState<Tab>('overview');
  const d = useLoad(() => api<WorkspaceDetail>(`/platform/workspaces/${id}`, { workspace: false }), [id]);
  const plans = useLoad(() => api<Plan[]>('/platform/plans', { workspace: false }), []);
  const data = d.data;

  return (
    <>
      <PageHead
        title={data?.workspace.name ?? 'مساحة العمل'}
        sub={data ? `${TYPE_LABEL[data.workspace.type]}${data.workspace.governorate ? ` — ${data.workspace.governorate}` : ''} — أُنشئت ${fmtDate(data.workspace.createdAt)}` : undefined}
      >
        {data ? <Chip tone={ACCESS_TONE[data.access.reason]}>{ACCESS_LABEL[data.access.reason]}</Chip> : null}
        <Link className="btn quiet" href="/platform/workspaces">كل المساحات</Link>
      </PageHead>
      <ErrorNote error={d.error} onRetry={d.reload} />
      {d.loading && !data ? <Loading what="مساحة العمل" /> : null}
      {data ? (
        <>
          <Tabs<Tab>
            value={tab}
            onChange={setTab}
            items={[
              { id: 'overview', label: 'نظرة عامة' },
              { id: 'team', label: `الفريق (${num(data.members.length)})` },
              { id: 'billing', label: 'الاشتراك والمدفوعات' },
              { id: 'notes', label: `الملاحظات (${num(data.notes.length)})` },
              { id: 'audit', label: 'سجل العمليات' },
              { id: 'danger', label: 'الإيقاف والحالة', hidden: !can('platform.workspaces.manage') },
            ]}
          />
          {tab === 'overview' ? <Overview data={data} onSaved={d.reload} /> : null}
          {tab === 'team' ? <Team id={id} data={data} onChanged={d.reload} /> : null}
          {tab === 'billing' ? <Billing id={id} data={data} plans={plans.data ?? []} onChanged={d.reload} /> : null}
          {tab === 'notes' ? <Notes id={id} data={data} onChanged={d.reload} /> : null}
          {tab === 'audit' ? <Audit id={id} /> : null}
          {tab === 'danger' ? <Danger id={id} data={data} onChanged={d.reload} /> : null}
        </>
      ) : null}
    </>
  );
}

function Overview({ data, onSaved }: { data: WorkspaceDetail; onSaved: () => void }) {
  const { can } = usePlatform();
  const w = data.workspace;
  const [f, setF] = useState({
    name: w.name, type: w.type, governorate: w.governorate ?? '', contactPhone: w.contactPhone ?? '',
    receptionMaxDiscountPct: String(w.receptionMaxDiscountPct), lateAfterMinutes: String(w.lateAfterMinutes),
  });
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();
  const u = data.usage;

  const save = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api(`/platform/workspaces/${w.id}`, {
        method: 'PATCH',
        workspace: false,
        body: {
          name: f.name.trim(), type: f.type, governorate: f.governorate.trim() || null, contactPhone: f.contactPhone.trim() || null,
          receptionMaxDiscountPct: Number(f.receptionMaxDiscountPct), lateAfterMinutes: Number(f.lateAfterMinutes),
        },
      });
      setSaved(true);
      onSaved();
    });
  };

  return (
    <div className="stack">
      <div className="kpis">
        <div className="kpi"><span className="v num">{num(u.activeStudents)}</span><span className="l">طالب نشط{data.limits.maxStudents ? ` من ${num(data.limits.maxStudents)}` : ''}</span></div>
        <div className="kpi"><span className="v num">{num(u.members)}</span><span className="l">عضو في الفريق{data.limits.maxStaff ? ` من ${num(data.limits.maxStaff)}` : ''}</span></div>
        <div className="kpi"><span className="v num">{num(u.groups)}</span><span className="l">مجموعة نشطة</span></div>
        <div className="kpi"><span className="v num">{num(u.attendance30d)}</span><span className="l">تسجيل حضور (30 يومًا)</span></div>
        <div className="kpi"><span className="v num">{num(u.receipts30d)}</span><span className="l">إيصال (30 يومًا)</span></div>
        <div className="kpi"><span className="v num">{num(u.attempts30d)}</span><span className="l">محاولة امتحان (30 يومًا)</span></div>
      </div>
      <div className="split-even">
        <section className="panel stack-sm">
          <h2>الاشتراك</h2>
          <dl className="dl">
            <dt>الحالة</dt><dd>{WS_STATUS_LABEL[w.status]} — <Chip tone={ACCESS_TONE[data.access.reason]}>{ACCESS_LABEL[data.access.reason]}</Chip></dd>
            <dt>الخطة</dt><dd>{data.limits.planName}</dd>
            {w.trialEndsAt ? <><dt>نهاية التجربة</dt><dd>{fmtDate(w.trialEndsAt)}</dd></> : null}
            {w.paidUntil ? <><dt>مدفوع حتى</dt><dd>{fmtDate(w.paidUntil)}</dd></> : null}
            {data.access.daysLeft !== null ? <><dt>المتبقي</dt><dd className="num">{num(data.access.daysLeft)} يوم</dd></> : null}
            <dt>حد الطلاب</dt><dd>{data.limits.maxStudents ? num(data.limits.maxStudents) : 'بلا حد'}{w.maxStudents ? ' (مخصص)' : ''}</dd>
            <dt>حد الفريق</dt><dd>{data.limits.maxStaff ? num(data.limits.maxStaff) : 'بلا حد'}{w.maxStaff ? ' (مخصص)' : ''}</dd>
            <dt>آخر نشاط</dt><dd>{u.lastActivity ? fmtDateTime(u.lastActivity) : 'لا نشاط بعد'}</dd>
            {w.suspendReason ? <><dt>سبب الإيقاف</dt><dd>{w.suspendReason}</dd></> : null}
          </dl>
        </section>
        <form className="panel stack" onSubmit={save}>
          <h2>البيانات</h2>
          <div className="form-grid">
            <Field label="الاسم"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required minLength={2} disabled={!can('platform.workspaces.manage')} /></Field>
            <Field label="النوع">
              <select className="select" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as 'CENTER' | 'TEACHER' })} disabled={!can('platform.workspaces.manage')}>
                <option value="CENTER">سنتر</option>
                <option value="TEACHER">مدرس خاص</option>
              </select>
            </Field>
            <Field label="المحافظة"><input className="input" value={f.governorate} onChange={(e) => setF({ ...f, governorate: e.target.value })} disabled={!can('platform.workspaces.manage')} /></Field>
            <Field label="تليفون التواصل"><input className="input" dir="ltr" value={f.contactPhone} onChange={(e) => setF({ ...f, contactPhone: e.target.value })} disabled={!can('platform.workspaces.manage')} /></Field>
            <Field label="أقصى خصم للاستقبال %"><input className="input" type="number" min={0} max={100} value={f.receptionMaxDiscountPct} onChange={(e) => setF({ ...f, receptionMaxDiscountPct: e.target.value })} disabled={!can('platform.workspaces.manage')} /></Field>
            <Field label="التأخير بعد (دقيقة)"><input className="input" type="number" min={0} max={120} value={f.lateAfterMinutes} onChange={(e) => setF({ ...f, lateAfterMinutes: e.target.value })} disabled={!can('platform.workspaces.manage')} /></Field>
          </div>
          {error ? <div className="note error">{error}</div> : null}
          {saved ? <div className="note info">تم الحفظ.</div> : null}
          <IfCan perm="platform.workspaces.manage"><div className="row"><button className="btn" disabled={busy}>احفظ</button></div></IfCan>
        </form>
      </div>
    </div>
  );
}

function Team({ id, data, onChanged }: { id: string; data: WorkspaceDetail; onChanged: () => void }) {
  const { can } = usePlatform();
  const [adding, setAdding] = useState(false);
  const [issued, setIssued] = useState<{ name: string; credentials: Credentials } | null>(null);
  const action = useAction();
  const teachers = data.members.filter((m) => (m.role === 'TEACHER' || m.role === 'OWNER') && m.status === 'ACTIVE');

  const update = (m: MemberRow, body: Record<string, unknown>) =>
    void action.run(async () => {
      await api(`/platform/workspaces/${id}/members/${m.membershipId}`, { method: 'PATCH', workspace: false, body });
      onChanged();
    });

  return (
    <div className="stack">
      <div className="row-between">
        <p className="muted">إضافة عضو هنا تظهر للسنتر في سجل العمليات. لإعادة تعيين كلمة مرور عضو افتح حسابه من اسمه.</p>
        <IfCan perm="platform.workspaces.manage"><button className="btn" onClick={() => setAdding(true)}>أضف عضوًا</button></IfCan>
      </div>
      <ErrorNote error={action.error} />
      {issued ? <CredentialsCard credentials={issued.credentials} name={issued.name} /> : null}
      <Ledger head={<tr><th>الاسم</th><th>الدخول</th><th>الدور</th><th>العضوية</th><th>آخر دخول</th></tr>}>
        {data.members.map((m) => (
          <tr key={m.membershipId} className={m.status === 'DISABLED' ? 'is-void' : undefined}>
            <td><Link href={`/platform/users/${m.user.id}`}>{m.user.name}</Link>{m.user.status !== 'ACTIVE' ? <Chip tone="bad">الحساب موقوف</Chip> : null}</td>
            <td className="num" dir="ltr" style={{ textAlign: 'right' }}>{m.user.login}</td>
            <td>
              {can('platform.workspaces.manage') ? (
                <select className="select" style={{ width: 'auto' }} value={m.role} disabled={action.busy} onChange={(e) => update(m, { role: e.target.value, supervisorMembershipId: e.target.value === 'ASSISTANT' ? teachers[0]?.membershipId : undefined })}>
                  {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </select>
              ) : ROLE_LABEL[m.role]}
              {m.role === 'ASSISTANT' ? <div className="faint">يتبع: {data.members.find((t) => t.membershipId === m.supervisorMembershipId)?.user.name ?? '—'}</div> : null}
            </td>
            <td>
              {can('platform.workspaces.manage') ? (
                <button className="btn ghost" disabled={action.busy} onClick={() => update(m, { status: m.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' })}>
                  {m.status === 'ACTIVE' ? 'نشط — إيقاف' : 'موقوف — تفعيل'}
                </button>
              ) : m.status === 'ACTIVE' ? 'نشط' : 'موقوف'}
            </td>
            <td className="faint">{m.user.lastLoginAt ? fmtDateTime(m.user.lastLoginAt) : m.user.hasPassword ? 'لم يدخل بعد' : 'بلا كلمة مرور'}</td>
          </tr>
        ))}
      </Ledger>
      <Modal open={adding} title="إضافة عضو لمساحة العمل" onClose={() => setAdding(false)}>
        {adding ? (
          <AddMember
            id={id}
            teachers={teachers}
            onDone={(r) => {
              setAdding(false);
              if (r.credentials) setIssued({ name: r.name, credentials: r.credentials });
              onChanged();
            }}
          />
        ) : null}
      </Modal>
    </div>
  );
}

function AddMember({ id, teachers, onDone }: { id: string; teachers: MemberRow[]; onDone: (r: { name: string; credentials: Credentials | null }) => void }) {
  const [mode, setMode] = useState<'existing' | 'new'>('new');
  const [existing, setExisting] = useState<UserRow | null>(null);
  const [nu, setNu] = useState({ name: '', phone: '', username: '' });
  const [role, setRole] = useState('MANAGER');
  const [supervisor, setSupervisor] = useState('');
  const { busy, error, run } = useAction();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const r = await api<{ credentials: Credentials | null }>(`/platform/workspaces/${id}/members`, {
        method: 'POST',
        workspace: false,
        body: {
          role,
          supervisorMembershipId: role === 'ASSISTANT' ? supervisor : undefined,
          ...(mode === 'existing' ? { userId: existing?.id } : { newUser: { name: nu.name.trim(), phone: nu.phone || undefined, username: nu.username || undefined } }),
        },
      });
      onDone({ name: mode === 'existing' ? (existing?.name ?? '') : nu.name, credentials: r.credentials });
    });
  };

  return (
    <form className="stack" onSubmit={submit}>
      <div className="checks">
        <label><input type="radio" checked={mode === 'new'} onChange={() => setMode('new')} />حساب جديد</label>
        <label><input type="radio" checked={mode === 'existing'} onChange={() => setMode('existing')} />مستخدم موجود</label>
      </div>
      {mode === 'new' ? <NewUserFields value={nu} onChange={setNu} /> : <UserPicker value={existing} onChange={setExisting} />}
      <div className="form-grid">
        <Field label="الدور">
          <select className="select" value={role} onChange={(e) => setRole(e.target.value)}>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
        </Field>
        {role === 'ASSISTANT' ? (
          <Field label="يساعد المدرس">
            <select className="select" value={supervisor} onChange={(e) => setSupervisor(e.target.value)} required>
              <option value="">اختر</option>
              {teachers.map((t) => <option key={t.membershipId} value={t.membershipId}>{t.user.name}</option>)}
            </select>
          </Field>
        ) : null}
      </div>
      {error ? <div className="note error">{error}</div> : null}
      <button className="btn" disabled={busy || (mode === 'existing' ? !existing : nu.name.trim().length < 2 || (!nu.phone && !nu.username))}>أضف العضو</button>
    </form>
  );
}

function Billing({ id, data, plans, onChanged }: { id: string; data: WorkspaceDetail; plans: Plan[]; onChanged: () => void }) {
  const { can } = usePlatform();
  const w = data.workspace;
  const [pay, setPay] = useState({ amount: '', months: '1', method: 'CASH', paidAt: '', planCode: '', note: '' });
  const [sub, setSub] = useState({ plan: w.plan, paidUntil: dateInput(w.paidUntil), trialEndsAt: dateInput(w.trialEndsAt), maxStudents: w.maxStudents ? String(w.maxStudents) : '', maxStaff: w.maxStaff ? String(w.maxStaff) : '' });
  const [extendDays, setExtendDays] = useState('14');
  const [notice, setNotice] = useState<string | null>(null);
  const action = useAction();

  // اقتراح المبلغ من سعر الخطة عند تغيير الخطة أو المدة (لا يكتب فوق مبلغ مكتوب)
  useEffect(() => {
    const p = plans.find((x) => x.code === (pay.planCode || w.plan));
    if (p && Number(p.monthlyPrice) > 0) {
      setPay((x) => (x.amount ? x : { ...x, amount: (Number(p.monthlyPrice) * Number(x.months || 1)).toFixed(2) }));
    }
  }, [plans, pay.planCode, pay.months, w.plan]);

  const record = (e: FormEvent) => {
    e.preventDefault();
    void action.run(async () => {
      const r = await api<{ periodEnd: string }>(`/platform/workspaces/${id}/payments`, {
        method: 'POST',
        workspace: false,
        body: {
          amount: pay.amount, months: Number(pay.months), method: pay.method,
          paidAt: pay.paidAt ? new Date(`${pay.paidAt}T12:00:00Z`).toISOString() : undefined,
          planCode: pay.planCode || undefined, note: pay.note || undefined,
        },
      });
      setNotice(`سُجلت الدفعة، والاشتراك ساري حتى ${fmtDate(r.periodEnd)}.`);
      setPay({ amount: '', months: '1', method: 'CASH', paidAt: '', planCode: '', note: '' });
      onChanged();
    });
  };

  const saveSub = (e: FormEvent) => {
    e.preventDefault();
    void action.run(async () => {
      const body: Record<string, unknown> = {};
      if (can('platform.billing.manage')) {
        body.plan = sub.plan;
        body.paidUntil = sub.paidUntil ? endOfDayIso(sub.paidUntil) : null;
        body.maxStudents = sub.maxStudents ? Number(sub.maxStudents) : null;
        body.maxStaff = sub.maxStaff ? Number(sub.maxStaff) : null;
      }
      if (can('platform.workspaces.manage')) body.trialEndsAt = sub.trialEndsAt ? endOfDayIso(sub.trialEndsAt) : null;
      await api(`/platform/workspaces/${id}`, { method: 'PATCH', workspace: false, body });
      setNotice('حُفظت بيانات الاشتراك.');
      onChanged();
    });
  };

  const extend = () =>
    void action.run(async () => {
      const r = await api<{ trialEndsAt: string }>(`/platform/workspaces/${id}/extend-trial`, { method: 'POST', workspace: false, body: { days: Number(extendDays) } });
      setNotice(`مُدت التجربة حتى ${fmtDate(r.trialEndsAt)}.`);
      onChanged();
    });

  const total = data.payments.reduce((s, p) => s + Number(p.amount), 0);

  return (
    <div className="stack">
      {notice ? <div className="note info" role="status">{notice}</div> : null}
      <ErrorNote error={action.error} />
      <div className="split-even">
        <IfCan perm="platform.billing.manage">
          <form className="panel stack" onSubmit={record}>
            <h2>تسجيل دفعة</h2>
            <p className="muted">يُمد الاشتراك من تاريخ نهايته الحالي (أو من اليوم إن كان منتهيًا)، وتتحول المساحة لمفعّلة.</p>
            <div className="form-grid">
              <Field label="المبلغ (ج.م)"><input className="input" dir="ltr" inputMode="decimal" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} required /></Field>
              <Field label="عدد الأشهر"><input className="input" type="number" min={1} max={36} value={pay.months} onChange={(e) => setPay({ ...pay, months: e.target.value, amount: '' })} required /></Field>
              <Field label="طريقة الدفع">
                <select className="select" value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>
                  {Object.entries(METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Field>
              <Field label="الخطة">
                <select className="select" value={pay.planCode} onChange={(e) => setPay({ ...pay, planCode: e.target.value, amount: '' })}>
                  <option value="">الحالية ({plans.find((p) => p.code === w.plan)?.name ?? w.plan})</option>
                  {plans.filter((p) => p.active && p.code !== 'trial').map((p) => <option key={p.code} value={p.code}>{p.name} — {egp(p.monthlyPrice)}/شهر</option>)}
                </select>
              </Field>
              <Field label="تاريخ الدفع"><input className="input" type="date" value={pay.paidAt} onChange={(e) => setPay({ ...pay, paidAt: e.target.value })} /></Field>
              <Field label="ملاحظة"><input className="input" value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} placeholder="رقم التحويل مثلًا" /></Field>
            </div>
            <div className="row"><button className="btn" disabled={action.busy || !/^\d+(\.\d{1,2})?$/.test(pay.amount)}>سجّل الدفعة</button></div>
          </form>
        </IfCan>

        <form className="panel stack" onSubmit={saveSub}>
          <h2>ضبط الاشتراك يدويًا</h2>
          <div className="form-grid">
            <Field label="الخطة">
              <select className="select" value={sub.plan} onChange={(e) => setSub({ ...sub, plan: e.target.value })} disabled={!can('platform.billing.manage')}>
                {plans.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="مدفوع حتى"><input className="input" type="date" value={sub.paidUntil} onChange={(e) => setSub({ ...sub, paidUntil: e.target.value })} disabled={!can('platform.billing.manage')} /></Field>
            <Field label="نهاية التجربة"><input className="input" type="date" value={sub.trialEndsAt} onChange={(e) => setSub({ ...sub, trialEndsAt: e.target.value })} disabled={!can('platform.workspaces.manage')} /></Field>
            <Field label="حد الطلاب المخصص" hint="فارغ = حد الخطة"><input className="input" type="number" min={1} value={sub.maxStudents} onChange={(e) => setSub({ ...sub, maxStudents: e.target.value })} disabled={!can('platform.billing.manage')} /></Field>
            <Field label="حد الفريق المخصص" hint="فارغ = حد الخطة"><input className="input" type="number" min={1} value={sub.maxStaff} onChange={(e) => setSub({ ...sub, maxStaff: e.target.value })} disabled={!can('platform.billing.manage')} /></Field>
          </div>
          <div className="row"><button className="btn quiet" disabled={action.busy}>احفظ</button></div>
          {w.status === 'TRIAL' || w.status === 'PAUSED' ? (
            <IfCan perm="platform.workspaces.manage">
              <div className="row" style={{ alignItems: 'end' }}>
                <Field label="تمديد التجربة (يوم)"><input className="input" type="number" min={1} max={365} value={extendDays} onChange={(e) => setExtendDays(e.target.value)} /></Field>
                <button type="button" className="btn quiet" onClick={extend} disabled={action.busy || !Number(extendDays)}>مد التجربة</button>
              </div>
            </IfCan>
          ) : null}
        </form>
      </div>

      <section className="panel stack-sm">
        <div className="row-between"><h2>سجل المدفوعات</h2><span className="faint">الإجمالي {egp(total)}</span></div>
        {data.payments.length ? (
          <Ledger head={<tr><th>التاريخ</th><th>المبلغ</th><th>المدة</th><th>الفترة</th><th>الطريقة</th><th>سجّلها</th><th>ملاحظة</th></tr>}>
            {data.payments.map((p) => (
              <tr key={p.id}>
                <td>{fmtDate(p.paidAt)}</td>
                <td className="num">{egp(p.amount)}</td>
                <td className="num">{num(p.months)} شهر</td>
                <td className="faint">{fmtDate(p.periodStart)} ← {fmtDate(p.periodEnd)}</td>
                <td>{METHOD_LABEL[p.method] ?? p.method}</td>
                <td>{p.recordedBy}</td>
                <td className="faint">{p.note ?? ''}</td>
              </tr>
            ))}
          </Ledger>
        ) : <Empty>لا توجد مدفوعات مسجلة.</Empty>}
      </section>
    </div>
  );
}

function Notes({ id, data, onChanged }: { id: string; data: WorkspaceDetail; onChanged: () => void }) {
  const [body, setBody] = useState('');
  const action = useAction();
  const add = (e: FormEvent) => {
    e.preventDefault();
    void action.run(async () => {
      await api(`/platform/workspaces/${id}/notes`, { method: 'POST', workspace: false, body: { body: body.trim() } });
      setBody('');
      onChanged();
    });
  };
  const remove = (noteId: string) =>
    window.confirm('حذف الملاحظة؟') &&
    void action.run(async () => {
      await api(`/platform/workspaces/${id}/notes/${noteId}`, { method: 'DELETE', workspace: false });
      onChanged();
    });
  return (
    <div className="stack">
      <IfCan perm="platform.workspaces.manage">
        <form className="panel stack-sm" onSubmit={add}>
          <Field label="ملاحظة داخلية (لا تظهر للسنتر)">
            <textarea className="textarea" value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} placeholder="مكالمة متابعة، طلب ميزة، موعد تجديد…" />
          </Field>
          <div className="row"><button className="btn" disabled={action.busy || !body.trim()}>أضف الملاحظة</button></div>
        </form>
      </IfCan>
      <ErrorNote error={action.error} />
      {data.notes.length ? (
        data.notes.map((n) => (
          <div key={n.id} className="panel stack-sm">
            <div className="row-between"><strong>{n.author}</strong><span className="faint">{fmtDateTime(n.createdAt)}</span></div>
            <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{n.body}</p>
            <IfCan perm="platform.workspaces.manage"><div className="row"><button className="btn ghost" onClick={() => remove(n.id)}>حذف</button></div></IfCan>
          </div>
        ))
      ) : <Empty>لا توجد ملاحظات.</Empty>}
    </div>
  );
}

function Audit({ id }: { id: string }) {
  const [page, setPage] = useState(1);
  const log = useLoad(() => api<{ page: number; hasMore: boolean; items: AuditItem[] }>(`/platform/workspaces/${id}/audit`, { workspace: false, query: { page } }), [id, page]);
  return (
    <div className="stack-sm">
      <ErrorNote error={log.error} onRetry={log.reload} />
      {log.loading && !log.data ? <Loading what="السجل" /> : null}
      {log.data ? (
        log.data.items.length ? (
          <Ledger head={<tr><th>الوقت</th><th>بواسطة</th><th>العملية</th><th>تفاصيل</th></tr>}>
            {log.data.items.map((a) => (
              <tr key={a.id}>
                <td className="faint nowrap">{fmtDateTime(a.createdAt)}</td>
                <td>{a.actor ? <Link href={`/platform/users/${a.actor.id}`}>{a.actor.name}</Link> : 'النظام'}</td>
                <td>{actionLabel(a.action)}</td>
                <td className="faint" style={{ maxWidth: 380, overflowWrap: 'anywhere' }}>{metaText(a.meta)}</td>
              </tr>
            ))}
          </Ledger>
        ) : <Empty>لا توجد عمليات.</Empty>
      ) : null}
      <div className="row">
        <button className="btn quiet" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>الأحدث</button>
        <button className="btn quiet" disabled={!log.data?.hasMore} onClick={() => setPage((p) => p + 1)}>الأقدم</button>
      </div>
    </div>
  );
}

function Danger({ id, data, onChanged }: { id: string; data: WorkspaceDetail; onChanged: () => void }) {
  const w = data.workspace;
  const [reason, setReason] = useState(w.suspendReason ?? '');
  const action = useAction();
  const setStatus = (status: string, confirmText: string) =>
    window.confirm(confirmText) &&
    void action.run(async () => {
      await api(`/platform/workspaces/${id}`, { method: 'PATCH', workspace: false, body: { status, suspendReason: status === 'SUSPENDED' ? reason.trim() : undefined } });
      onChanged();
    });

  return (
    <div className="stack">
      <ErrorNote error={action.error} />
      <section className="panel stack-sm">
        <h2>الحالة الحالية: {WS_STATUS_LABEL[w.status]}</h2>
        <p className="muted">
          «متوقف مؤقتًا» يجعل المساحة للعرض والطباعة فقط (مثل انتهاء الاشتراك). «موقوف» يمنع الدخول تمامًا لكل الفريق.
          لا يُحذف أي شيء من بيانات السنتر في الحالتين، وكل تغيير يُبلَّغ للمالك والمدير ويُسجل.
        </p>
        <div className="row">
          {w.status !== 'ACTIVE' ? <button className="btn" disabled={action.busy} onClick={() => setStatus('ACTIVE', 'تفعيل المساحة؟ إن لم يكن هناك تاريخ «مدفوع حتى» يصبح الاشتراك مفتوحًا.')}>تفعيل</button> : null}
          {w.status !== 'TRIAL' ? <button className="btn quiet" disabled={action.busy} onClick={() => setStatus('TRIAL', 'إرجاع المساحة للفترة التجريبية؟ تأكد من تاريخ نهاية التجربة في تبويب الاشتراك.')}>فترة تجريبية</button> : null}
          {w.status !== 'PAUSED' ? <button className="btn quiet" disabled={action.busy} onClick={() => setStatus('PAUSED', 'إيقاف مؤقت (عرض فقط)؟')}>إيقاف مؤقت</button> : null}
        </div>
      </section>
      {w.status !== 'SUSPENDED' ? (
        <section className="panel stack-sm danger-zone">
          <h2>إيقاف كامل</h2>
          <Field label="سبب الإيقاف (يُسجل)">
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثال: عدم السداد بعد 3 تذكيرات" />
          </Field>
          <div className="row">
            <button className="btn danger" disabled={action.busy || reason.trim().length < 3} onClick={() => setStatus('SUSPENDED', `إيقاف «${w.name}» ومنع كل الفريق من الدخول؟`)}>أوقف المساحة</button>
          </div>
        </section>
      ) : <div className="note error">المساحة موقوفة: {w.suspendReason ?? 'بدون سبب مسجل'}</div>}
    </div>
  );
}
