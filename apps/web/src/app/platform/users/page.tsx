'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { downloadCsv, fetchAllPages } from '@/lib/csv';
import { fmtDate, fmtDateTime, num, PLATFORM_ROLE_LABEL } from '@/lib/format';
import { USER_KIND_LABEL, type Paged, type UserRow } from '@/lib/platform';
import { useAction, useLoad } from '@/lib/use-load';
import { CredentialsCard, type Credentials } from '@/components/credentials';
import { userStateChip } from '@/components/platform-forms';
import { IfCan, Pager, usePlatform } from '@/components/platform-shell';
import { Chip, Empty, ErrorNote, Field, Ledger, Loading, Modal, PageHead } from '@/components/ui';

export default function UsersPage() {
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ id: string; name: string; credentials: Credentials } | null>(null);
  const exporter = useAction();

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    setKind(sp.get('kind') ?? '');
    if (sp.get('new') === '1') setCreating(true);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      setTerm(q.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const list = useLoad(() => api<Paged<UserRow>>('/platform/users', { workspace: false, query: { q: term, kind, status, page } }), [term, kind, status, page]);

  const exportCsv = () =>
    void exporter.run(async () => {
      const items = await fetchAllPages((p) => api<Paged<UserRow>>('/platform/users', { workspace: false, query: { q: term, kind, status, page: p, pageSize: 200 } }));
      downloadCsv(
        `المستخدمون-${new Date().toISOString().slice(0, 10)}`,
        ['الاسم', 'اسم المستخدم', 'الموبايل', 'الحالة', 'دور المنصة', 'له كلمة مرور', 'آخر دخول', 'عضويات', 'أبناء', 'تاريخ الإنشاء'],
        items.map((u) => [u.name, u.username, u.phone, u.status === 'ACTIVE' ? 'نشط' : 'موقوف', u.platformRole ? PLATFORM_ROLE_LABEL[u.platformRole] : '', u.hasPassword ? 'نعم' : 'لا', u.lastLoginAt?.slice(0, 16).replace('T', ' '), u.memberships, u.children, u.createdAt.slice(0, 10)]),
      );
    });

  return (
    <>
      <PageHead title="المستخدمون" sub={list.data ? `${num(list.data.total)} حساب` : 'كل الحسابات على المنصة: فرق السناتر وأولياء الأمور والطلاب وفريق الإدارة.'}>
        <button className="btn quiet" onClick={exportCsv} disabled={exporter.busy}>{exporter.busy ? 'جارٍ التصدير…' : 'تصدير Excel'}</button>
        <IfCan perm="platform.users.manage"><button className="btn" onClick={() => { setCreated(null); setCreating(true); }}>حساب جديد</button></IfCan>
      </PageHead>
      <ErrorNote error={exporter.error} />
      {created ? (
        <div className="stack-sm" style={{ marginBottom: '1rem' }}>
          <CredentialsCard credentials={created.credentials} name={created.name} />
          <div className="row"><Link className="btn quiet" href={`/platform/users/${created.id}`}>فتح الحساب</Link></div>
        </div>
      ) : null}

      <div className="form-grid" style={{ marginBottom: '1rem' }}>
        <Field label="بحث"><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="الاسم أو اسم المستخدم أو الموبايل" /></Field>
        <Field label="النوع">
          <select className="select" value={kind} onChange={(e) => { setKind(e.target.value); setPage(1); }}>
            {Object.entries(USER_KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="الحالة">
          <select className="select" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">الكل</option>
            <option value="ACTIVE">نشط</option>
            <option value="DISABLED">موقوف</option>
          </select>
        </Field>
      </div>

      <ErrorNote error={list.error} onRetry={list.reload} />
      {list.loading && !list.data ? <Loading what="المستخدمين" /> : null}
      {list.data && !list.data.items.length ? <Empty>لا توجد نتائج.</Empty> : null}
      {list.data?.items.length ? (
        <Ledger head={<tr><th>الاسم</th><th>الدخول</th><th>الحالة</th><th>الارتباط</th><th>آخر دخول</th><th>أُنشئ</th></tr>}>
          {list.data.items.map((u) => (
            <tr key={u.id} className={u.status === 'DISABLED' ? 'is-void' : undefined}>
              <td>
                <Link href={`/platform/users/${u.id}`}>{u.name}</Link>
                {u.platformRole ? <> <Chip tone="info">{PLATFORM_ROLE_LABEL[u.platformRole]}</Chip></> : null}
              </td>
              <td className="num" dir="ltr" style={{ textAlign: 'right' }}>{u.login || '—'}{u.username && u.phone ? <div className="faint">{u.phone}</div> : null}</td>
              <td>{userStateChip(u)}</td>
              <td className="faint">{[u.memberships ? `${num(u.memberships)} مساحة` : '', u.children ? `${num(u.children)} ابن` : ''].filter(Boolean).join('، ') || '—'}</td>
              <td className="faint">{u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : '—'}</td>
              <td className="faint">{fmtDate(u.createdAt)}</td>
            </tr>
          ))}
        </Ledger>
      ) : null}
      {list.data ? <Pager page={page} total={list.data.total} pageSize={list.data.pageSize} onPage={setPage} /> : null}

      <Modal open={creating} title="حساب جديد" onClose={() => setCreating(false)}>
        {creating ? <CreateUser onDone={(r) => { setCreating(false); setCreated(r); void list.reload(); }} /> : null}
      </Modal>
    </>
  );
}

function CreateUser({ onDone }: { onDone: (r: { id: string; name: string; credentials: Credentials }) => void }) {
  const { can } = usePlatform();
  const [f, setF] = useState({ name: '', phone: '', username: '', password: '', mustChangePassword: true, platformRole: '' });
  const { busy, error, run } = useAction();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const r = await api<{ id: string; credentials: Credentials }>('/platform/users', {
        method: 'POST',
        workspace: false,
        body: {
          name: f.name.trim(),
          phone: f.phone || undefined,
          username: f.username || undefined,
          password: f.password || undefined,
          mustChangePassword: f.mustChangePassword,
          platformRole: f.platformRole || undefined,
        },
      });
      onDone({ id: r.id, name: f.name.trim(), credentials: r.credentials });
    });
  };
  return (
    <form className="stack" onSubmit={submit}>
      <div className="form-grid">
        <Field label="الاسم"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required minLength={2} /></Field>
        <Field label="رقم الموبايل"><input className="input" dir="ltr" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="01xxxxxxxxx" /></Field>
        <Field label="اسم المستخدم" hint="حروف إنجليزية صغيرة وأرقام . _ -"><input className="input" dir="ltr" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value.toLowerCase() })} /></Field>
        <Field label="كلمة المرور" hint="فارغة = كلمة مؤقتة تلقائية"><input className="input" dir="ltr" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} minLength={8} /></Field>
        {can('platform.admins.manage') ? (
          <Field label="دور في فريق المنصة">
            <select className="select" value={f.platformRole} onChange={(e) => setF({ ...f, platformRole: e.target.value })}>
              <option value="">بدون (مستخدم عادي)</option>
              {Object.entries(PLATFORM_ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
        ) : null}
      </div>
      <label className="row" style={{ gap: '0.4rem' }}>
        <input type="checkbox" checked={f.mustChangePassword} onChange={(e) => setF({ ...f, mustChangePassword: e.target.checked })} />
        يُلزم بتغيير كلمة المرور عند أول دخول
      </label>
      {f.platformRole ? <div className="note warn">هذا الحساب سيصل للوحة إدارة المنصة بصلاحيات «{PLATFORM_ROLE_LABEL[f.platformRole]}».</div> : null}
      {error ? <div className="note error">{error}</div> : null}
      <button className="btn" disabled={busy || f.name.trim().length < 2 || (!f.phone && !f.username)}>أنشئ الحساب</button>
    </form>
  );
}
