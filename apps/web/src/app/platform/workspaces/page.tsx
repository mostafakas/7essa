'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { downloadCsv, fetchAllPages } from '@/lib/csv';
import { ACCESS_LABEL, ACCESS_TONE, fmtDate, num, WS_STATUS_LABEL } from '@/lib/format';
import { TYPE_LABEL, type Paged, type Plan, type UserRow, type WorkspaceRow } from '@/lib/platform';
import { useAction, useLoad } from '@/lib/use-load';
import { CredentialsCard, type Credentials } from '@/components/credentials';
import { NewUserFields, UserPicker } from '@/components/platform-forms';
import { IfCan, Pager, usePlatform } from '@/components/platform-shell';
import { Chip, Empty, ErrorNote, Field, Ledger, Loading, Modal, PageHead } from '@/components/ui';

const DUE_LABEL: Record<string, string> = {
  '': 'الكل',
  trial_ending: 'تجربة تنتهي خلال أسبوع',
  trial_ended: 'تجربة منتهية',
  expiring: 'اشتراك ينتهي خلال أسبوعين',
  expired: 'اشتراك منتهٍ',
};

export default function WorkspacesPage() {
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [filters, setFilters] = useState({ status: '', type: '', plan: '', due: '' });
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ id: string; name: string; credentials: Credentials | null; login: string } | null>(null);
  const exporter = useAction();

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    setFilters((f) => ({ ...f, status: sp.get('status') ?? '', due: sp.get('due') ?? '' }));
    if (sp.get('new') === '1') setCreating(true);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      setTerm(q.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const plans = useLoad(() => api<Plan[]>('/platform/plans', { workspace: false }), []);
  const list = useLoad(
    () => api<Paged<WorkspaceRow>>('/platform/workspaces', { workspace: false, query: { q: term, ...filters, page } }),
    [term, filters, page],
  );
  const setF = (k: keyof typeof filters) => (e: { target: { value: string } }) => {
    setFilters((f) => ({ ...f, [k]: e.target.value }));
    setPage(1);
  };

  const exportCsv = () =>
    void exporter.run(async () => {
      const items = await fetchAllPages((p) =>
        api<Paged<WorkspaceRow>>('/platform/workspaces', { workspace: false, query: { q: term, ...filters, page: p, pageSize: 200 } }),
      );
      downloadCsv(
        `مساحات-العمل-${new Date().toISOString().slice(0, 10)}`,
        ['الاسم', 'النوع', 'الحالة', 'الوصول', 'الخطة', 'نهاية التجربة', 'مدفوع حتى', 'المالك', 'دخول المالك', 'المحافظة', 'تليفون التواصل', 'الطلاب النشطون', 'الفريق', 'إيصالات 30 يوم', 'حضور 30 يوم', 'آخر نشاط', 'تاريخ الإنشاء'],
        items.map((w) => [
          w.name, TYPE_LABEL[w.type], WS_STATUS_LABEL[w.status], ACCESS_LABEL[w.access.reason], w.plan,
          w.trialEndsAt?.slice(0, 10), w.paidUntil?.slice(0, 10), w.owner?.name, w.owner?.login, w.governorate, w.contactPhone,
          w.usage.activeStudents, w.usage.members, w.usage.receipts30d, w.usage.attendance30d, w.usage.lastActivity?.slice(0, 10), w.createdAt.slice(0, 10),
        ]),
      );
    });

  return (
    <>
      <PageHead title="السناتر والمدرسون" sub={list.data ? `${num(list.data.total)} مساحة عمل` : undefined}>
        <button className="btn quiet" onClick={exportCsv} disabled={exporter.busy}>{exporter.busy ? 'جارٍ التصدير…' : 'تصدير Excel'}</button>
        <IfCan perm="platform.workspaces.manage"><button className="btn" onClick={() => { setCreated(null); setCreating(true); }}>مساحة عمل جديدة</button></IfCan>
      </PageHead>
      <ErrorNote error={exporter.error} />
      {created ? (
        <div className="stack-sm" style={{ marginBottom: '1rem' }}>
          <div className="note info row-between">
            <span>تم إنشاء «{created.name}». المالك يدخل باسم المستخدم <span className="num" dir="ltr">{created.login}</span>.</span>
            <Link className="btn quiet" href={`/platform/workspaces/${created.id}`}>فتح المساحة</Link>
          </div>
          {created.credentials ? <CredentialsCard credentials={created.credentials} title="بيانات دخول المالك" /> : null}
        </div>
      ) : null}

      <div className="form-grid" style={{ marginBottom: '1rem' }}>
        <Field label="بحث">
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="اسم المساحة أو المالك أو رقمه أو المحافظة" />
        </Field>
        <Field label="الحالة">
          <select className="select" value={filters.status} onChange={setF('status')}>
            <option value="">الكل</option>
            {Object.entries(WS_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="النوع">
          <select className="select" value={filters.type} onChange={setF('type')}>
            <option value="">الكل</option>
            {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="الخطة">
          <select className="select" value={filters.plan} onChange={setF('plan')}>
            <option value="">الكل</option>
            {plans.data?.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="متابعة">
          <select className="select" value={filters.due} onChange={setF('due')}>
            {Object.entries(DUE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
      </div>

      <ErrorNote error={list.error} onRetry={list.reload} />
      {list.loading && !list.data ? <Loading what="مساحات العمل" /> : null}
      {list.data && !list.data.items.length ? <Empty>لا توجد نتائج.</Empty> : null}
      {list.data?.items.length ? (
        <Ledger head={<tr><th>المساحة</th><th>المالك</th><th>الاشتراك</th><th>الخطة</th><th>الطلاب</th><th>النشاط (30 يوم)</th><th>آخر نشاط</th></tr>}>
          {list.data.items.map((w) => (
            <tr key={w.id} className={w.status === 'SUSPENDED' ? 'is-void' : undefined}>
              <td>
                <Link href={`/platform/workspaces/${w.id}`}>{w.name}</Link>
                <div className="faint">{TYPE_LABEL[w.type]}{w.governorate ? ` — ${w.governorate}` : ''}</div>
              </td>
              <td>{w.owner ? <><Link href={`/platform/users/${w.owner.id}`}>{w.owner.name}</Link><div className="faint num" dir="ltr" style={{ textAlign: 'right' }}>{w.owner.login}</div></> : <Chip tone="bad">بلا مالك</Chip>}</td>
              <td>
                <Chip tone={ACCESS_TONE[w.access.reason]}>{ACCESS_LABEL[w.access.reason]}</Chip>
                {w.access.until ? <div className="faint">حتى {fmtDate(w.access.until)}</div> : null}
              </td>
              <td>{plans.data?.find((p) => p.code === w.plan)?.name ?? w.plan}</td>
              <td className="num">{num(w.usage.activeStudents)}{w.maxStudents ? <span className="faint"> / {num(w.maxStudents)}</span> : null}</td>
              <td className="faint">{num(w.usage.attendance30d)} حضور، {num(w.usage.receipts30d)} إيصال</td>
              <td className="faint">{w.usage.lastActivity ? fmtDate(w.usage.lastActivity) : 'لا نشاط'}</td>
            </tr>
          ))}
        </Ledger>
      ) : null}
      {list.data ? <Pager page={page} total={list.data.total} pageSize={list.data.pageSize} onPage={setPage} /> : null}

      <Modal open={creating} title="مساحة عمل جديدة" onClose={() => setCreating(false)}>
        {creating ? (
          <CreateWorkspace
            plans={plans.data ?? []}
            onDone={(r) => {
              setCreating(false);
              setCreated(r);
              void list.reload();
            }}
          />
        ) : null}
      </Modal>
    </>
  );
}

function CreateWorkspace({ plans, onDone }: { plans: Plan[]; onDone: (r: { id: string; name: string; credentials: Credentials | null; login: string }) => void }) {
  const { can } = usePlatform();
  const [f, setF] = useState({ type: 'CENTER' as 'CENTER' | 'TEACHER', name: '', status: 'TRIAL' as 'TRIAL' | 'ACTIVE', plan: '', trialDays: '', paidMonths: '1', governorate: '', contactPhone: '' });
  const [ownerMode, setOwnerMode] = useState<'new' | 'existing'>('new');
  const [owner, setOwner] = useState({ name: '', phone: '', username: '' });
  const [existing, setExisting] = useState<UserRow | null>(null);
  const { busy, error, run } = useAction();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const r = await api<{ id: string; owner: { userId: string; login: string; credentials: Credentials | null } }>('/platform/workspaces', {
        method: 'POST',
        workspace: false,
        body: {
          type: f.type,
          name: f.name.trim(),
          status: f.status,
          plan: f.plan || undefined,
          trialDays: f.status === 'TRIAL' && f.trialDays ? Number(f.trialDays) : undefined,
          paidMonths: f.status === 'ACTIVE' && f.paidMonths ? Number(f.paidMonths) : undefined,
          governorate: f.governorate || undefined,
          contactPhone: f.contactPhone || undefined,
          ...(ownerMode === 'existing'
            ? { ownerUserId: existing?.id }
            : { owner: { name: owner.name.trim(), phone: owner.phone || undefined, username: owner.username || undefined } }),
        },
      });
      onDone({ id: r.id, name: f.name.trim(), credentials: r.owner.credentials, login: r.owner.login });
    });
  };

  return (
    <form className="stack" onSubmit={submit}>
      <div className="form-grid">
        <Field label="النوع">
          <select className="select" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as 'CENTER' | 'TEACHER' })}>
            <option value="CENTER">سنتر</option>
            <option value="TEACHER">مدرس خاص</option>
          </select>
        </Field>
        <Field label={f.type === 'CENTER' ? 'اسم السنتر' : 'الاسم الظاهر'}><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required minLength={2} /></Field>
        <Field label="البداية">
          <select className="select" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as 'TRIAL' | 'ACTIVE' })}>
            <option value="TRIAL">فترة تجريبية</option>
            {can('platform.billing.manage') ? <option value="ACTIVE">اشتراك مدفوع</option> : null}
          </select>
        </Field>
        {f.status === 'TRIAL' ? (
          <Field label="أيام التجربة" hint="فارغ = الافتراضي من الإعدادات"><input className="input" type="number" min={1} max={365} value={f.trialDays} onChange={(e) => setF({ ...f, trialDays: e.target.value })} /></Field>
        ) : (
          <Field label="مدة الاشتراك (شهر)"><input className="input" type="number" min={1} max={36} value={f.paidMonths} onChange={(e) => setF({ ...f, paidMonths: e.target.value })} /></Field>
        )}
        <Field label="الخطة">
          <select className="select" value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value })}>
            <option value="">تلقائي</option>
            {plans.filter((p) => p.active).map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="المحافظة"><input className="input" value={f.governorate} onChange={(e) => setF({ ...f, governorate: e.target.value })} /></Field>
        <Field label="تليفون التواصل"><input className="input" dir="ltr" value={f.contactPhone} onChange={(e) => setF({ ...f, contactPhone: e.target.value })} /></Field>
      </div>

      <fieldset className="stack-sm" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="field" style={{ marginBottom: '0.4rem' }}><span>المالك</span></legend>
        <div className="checks">
          <label><input type="radio" name="owner" checked={ownerMode === 'new'} onChange={() => setOwnerMode('new')} />حساب جديد</label>
          <label><input type="radio" name="owner" checked={ownerMode === 'existing'} onChange={() => setOwnerMode('existing')} />مستخدم موجود</label>
        </div>
        {ownerMode === 'new' ? <NewUserFields value={owner} onChange={setOwner} /> : <UserPicker value={existing} onChange={setExisting} />}
        <p className="faint">إن كان الرقم مسجلًا من قبل يُستخدم نفس الحساب. الحساب الجديد يحصل على كلمة مرور مؤقتة تظهر لك بعد الإنشاء.</p>
      </fieldset>

      {error ? <div className="note error">{error}</div> : null}
      <div className="row">
        <button className="btn" disabled={busy || f.name.trim().length < 2 || (ownerMode === 'existing' ? !existing : owner.name.trim().length < 2 || (!owner.phone && !owner.username))}>
          {busy ? 'جارٍ الإنشاء…' : 'أنشئ مساحة العمل'}
        </button>
      </div>
    </form>
  );
}
