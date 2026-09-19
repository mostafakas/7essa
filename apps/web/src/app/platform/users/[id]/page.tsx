'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { fmtDate, fmtDateTime, num, PLATFORM_ROLE_LABEL, ROLE_LABEL, WS_STATUS_LABEL } from '@/lib/format';
import { actionLabel, metaText, TYPE_LABEL, type UserDetail } from '@/lib/platform';
import { useAction, useLoad } from '@/lib/use-load';
import { CredentialsCard, type Credentials } from '@/components/credentials';
import { userStateChip } from '@/components/platform-forms';
import { IfCan, usePlatform } from '@/components/platform-shell';
import { Chip, Empty, ErrorNote, Field, Ledger, Loading, PageHead, Tabs } from '@/components/ui';

type Tab = 'profile' | 'security' | 'links' | 'audit';

export default function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState<Tab>('profile');
  const d = useLoad(() => api<UserDetail>(`/platform/users/${id}`, { workspace: false }), [id]);
  const u = d.data?.user;
  return (
    <>
      <PageHead title={u?.name ?? 'الحساب'} sub={u ? `أُنشئ ${fmtDate(u.createdAt)}${u.lastLoginAt ? ` — آخر دخول ${fmtDateTime(u.lastLoginAt)}` : ''}` : undefined}>
        {u ? userStateChip(u) : null}
        {u?.platformRole ? <Chip tone="info">{PLATFORM_ROLE_LABEL[u.platformRole]}</Chip> : null}
        <Link className="btn quiet" href="/platform/users">كل المستخدمين</Link>
      </PageHead>
      <ErrorNote error={d.error} onRetry={d.reload} />
      {d.loading && !d.data ? <Loading what="الحساب" /> : null}
      {d.data ? (
        <>
          <Tabs<Tab>
            value={tab}
            onChange={setTab}
            items={[
              { id: 'profile', label: 'البيانات' },
              { id: 'security', label: 'الدخول والأمان' },
              { id: 'links', label: `الارتباطات (${num(d.data.memberships.length + d.data.children.length)})` },
              { id: 'audit', label: 'السجل' },
            ]}
          />
          {tab === 'profile' ? <Profile data={d.data} onSaved={d.reload} /> : null}
          {tab === 'security' ? <Security data={d.data} onChanged={d.reload} /> : null}
          {tab === 'links' ? <Links data={d.data} /> : null}
          {tab === 'audit' ? <UserAudit data={d.data} /> : null}
        </>
      ) : null}
    </>
  );
}

function Profile({ data, onSaved }: { data: UserDetail; onSaved: () => void }) {
  const { can } = usePlatform();
  const u = data.user;
  const [f, setF] = useState({ name: u.name, phone: u.phone === '' ? '' : u.phone, username: u.username ?? '', notes: u.notes ?? '', platformRole: u.platformRole ?? '' });
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();
  useEffect(() => setSaved(false), [f]);
  const editable = can('platform.users.manage') && (!u.platformRole || can('platform.admins.manage'));

  const save = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const body: Record<string, unknown> = {
        name: f.name.trim(),
        phone: f.phone.trim() || null,
        username: f.username.trim() || null,
        notes: f.notes.trim() || null,
      };
      if (can('platform.admins.manage') && (f.platformRole || null) !== u.platformRole) body.platformRole = f.platformRole || null;
      await api(`/platform/users/${u.id}`, { method: 'PATCH', workspace: false, body });
      setSaved(true);
      onSaved();
    });
  };

  return (
    <form className="panel stack" onSubmit={save}>
      <div className="form-grid">
        <Field label="الاسم"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required minLength={2} disabled={!editable} /></Field>
        <Field label="رقم الموبايل"><input className="input" dir="ltr" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} disabled={!editable} /></Field>
        <Field label="اسم المستخدم"><input className="input" dir="ltr" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value.toLowerCase() })} disabled={!editable} /></Field>
        {can('platform.admins.manage') ? (
          <Field label="دور في فريق المنصة">
            <select className="select" value={f.platformRole} onChange={(e) => setF({ ...f, platformRole: e.target.value })}>
              <option value="">بدون</option>
              {Object.entries(PLATFORM_ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
        ) : null}
      </div>
      <Field label="ملاحظات داخلية"><textarea className="textarea" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} maxLength={2000} disabled={!editable} /></Field>
      {!editable ? <div className="note info">{u.platformRole ? 'حسابات فريق المنصة يعدلها مالك المنصة فقط.' : 'دورك لا يسمح بتعديل الحسابات.'}</div> : null}
      {error ? <div className="note error">{error}</div> : null}
      {saved ? <div className="note info">تم الحفظ.</div> : null}
      {editable ? <div className="row"><button className="btn" disabled={busy}>احفظ</button></div> : null}
    </form>
  );
}

function Security({ data, onChanged }: { data: UserDetail; onChanged: () => void }) {
  const { can } = usePlatform();
  const u = data.user;
  const [issued, setIssued] = useState<Credentials | null>(null);
  const [custom, setCustom] = useState('');
  const [mustChange, setMustChange] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const action = useAction();
  const manage = can('platform.users.manage') && (!u.platformRole || can('platform.admins.manage'));
  const locked = Boolean(u.lockedUntil && new Date(u.lockedUntil) > new Date());

  const reset = () =>
    window.confirm(`إعادة تعيين كلمة مرور ${u.name}؟ ستنتهي كل جلساته فورًا.`) &&
    void action.run(async () => {
      const c = await api<Credentials>(`/platform/users/${u.id}/reset-password`, {
        method: 'POST',
        workspace: false,
        body: { password: custom || undefined, mustChangePassword: mustChange },
      });
      setIssued(c);
      setCustom('');
      onChanged();
    });

  const simple = (path: string, confirmText: string, done: string) =>
    window.confirm(confirmText) &&
    void action.run(async () => {
      await api(`/platform/users/${u.id}/${path}`, { method: 'POST', workspace: false });
      setNotice(done);
      onChanged();
    });

  const toggleStatus = () =>
    window.confirm(u.status === 'ACTIVE' ? `إيقاف حساب ${u.name}؟ لن يستطيع الدخول لأي مكان وستنتهي جلساته.` : `إعادة تفعيل حساب ${u.name}؟`) &&
    void action.run(async () => {
      await api(`/platform/users/${u.id}`, { method: 'PATCH', workspace: false, body: { status: u.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' } });
      onChanged();
    });

  return (
    <div className="stack">
      <ErrorNote error={action.error} />
      {notice ? <div className="note info">{notice}</div> : null}
      {issued ? <CredentialsCard credentials={issued} name={u.name} title="كلمة المرور الجديدة" /> : null}
      <div className="split-even">
        <section className="panel stack-sm">
          <h2>الدخول</h2>
          <dl className="dl">
            <dt>اسم الدخول</dt><dd className="num" dir="ltr" style={{ textAlign: 'right' }}>{u.login || '—'}</dd>
            <dt>كلمة المرور</dt><dd>{u.hasPassword ? (u.mustChangePassword ? 'مؤقتة (سيغيرها عند الدخول)' : 'مضبوطة') : 'غير مضبوطة'}</dd>
            {u.passwordChangedAt ? <><dt>آخر تغيير</dt><dd>{fmtDateTime(u.passwordChangedAt)}</dd></> : null}
            <dt>آخر دخول</dt><dd>{u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : 'لم يدخل بعد'}</dd>
            <dt>محاولات خاطئة</dt><dd className="num">{num(u.failedLogins)}</dd>
            {locked ? <><dt>مقفول حتى</dt><dd>{fmtDateTime(u.lockedUntil!)}</dd></> : null}
            <dt>جلسات مفتوحة</dt><dd className="num">{num(data.sessions.length)}</dd>
          </dl>
        </section>
        {manage ? (
          <section className="panel stack-sm">
            <h2>إعادة تعيين كلمة المرور</h2>
            <Field label="كلمة مرور محددة" hint="اتركها فارغة لتوليد كلمة مؤقتة سهلة القراءة">
              <input className="input" dir="ltr" value={custom} onChange={(e) => setCustom(e.target.value)} minLength={8} />
            </Field>
            <label className="row" style={{ gap: '0.4rem' }}>
              <input type="checkbox" checked={mustChange} onChange={(e) => setMustChange(e.target.checked)} />
              يُلزم بتغييرها عند الدخول
            </label>
            <div className="row"><button className="btn" disabled={action.busy || (custom.length > 0 && custom.length < 8)} onClick={reset}>أصدر كلمة مرور</button></div>
          </section>
        ) : <div className="note info">{u.platformRole ? 'حسابات فريق المنصة يديرها مالك المنصة فقط.' : 'دورك لا يسمح بإدارة كلمات المرور.'}</div>}
      </div>

      {manage ? (
        <section className="panel stack-sm">
          <h2>إجراءات</h2>
          <div className="row">
            {locked ? <button className="btn quiet" disabled={action.busy} onClick={() => simple('unlock', 'فك القفل المؤقت عن الحساب؟', 'تم فك القفل.')}>فك القفل</button> : null}
            <button className="btn quiet" disabled={action.busy || !data.sessions.length} onClick={() => simple('revoke-sessions', 'تسجيل خروج هذا الحساب من كل الأجهزة؟', 'أُنهيت كل الجلسات.')}>إنهاء كل الجلسات</button>
            <button className={u.status === 'ACTIVE' ? 'btn danger' : 'btn'} disabled={action.busy} onClick={toggleStatus}>
              {u.status === 'ACTIVE' ? 'إيقاف الحساب' : 'إعادة تفعيل الحساب'}
            </button>
          </div>
        </section>
      ) : null}

      <section className="panel stack-sm">
        <h2>الجلسات المفتوحة</h2>
        {data.sessions.length ? (
          <Ledger head={<tr><th>بدأت</th><th>تنتهي</th><th>العنوان</th><th>الجهاز</th></tr>}>
            {data.sessions.map((s) => (
              <tr key={s.id}>
                <td>{fmtDateTime(s.createdAt)}</td>
                <td className="faint">{fmtDate(s.expiresAt)}</td>
                <td className="num">{s.ip ?? '—'}</td>
                <td className="faint" style={{ maxWidth: 320, overflowWrap: 'anywhere' }}>{s.userAgent ?? '—'}</td>
              </tr>
            ))}
          </Ledger>
        ) : <Empty>لا توجد جلسات مفتوحة.</Empty>}
      </section>
    </div>
  );
}

function Links({ data }: { data: UserDetail }) {
  return (
    <div className="split-even">
      <section className="panel stack-sm">
        <h2>عضوية مساحات العمل</h2>
        {data.memberships.length ? (
          <Ledger head={<tr><th>المساحة</th><th>الدور</th><th>العضوية</th></tr>}>
            {data.memberships.map((m) => (
              <tr key={m.membershipId} className={m.status === 'DISABLED' ? 'is-void' : undefined}>
                <td><Link href={`/platform/workspaces/${m.workspace.id}`}>{m.workspace.name}</Link><div className="faint">{TYPE_LABEL[m.workspace.type]} — {WS_STATUS_LABEL[m.workspace.status]}</div></td>
                <td>{ROLE_LABEL[m.role] ?? m.role}</td>
                <td>{m.status === 'ACTIVE' ? <Chip tone="ok">نشطة</Chip> : <Chip tone="bad">موقوفة</Chip>}</td>
              </tr>
            ))}
          </Ledger>
        ) : <Empty>ليس عضوًا في أي مساحة عمل.</Empty>}
        <IfCan perm="platform.workspaces.manage"><p className="faint">لإضافته لمساحة عمل افتح المساحة ثم تبويب «الفريق».</p></IfCan>
      </section>
      <section className="panel stack-sm">
        <h2>الطلاب المرتبطون</h2>
        {data.children.length ? (
          <Ledger head={<tr><th>الطالب</th><th>الصف</th><th>الصلة</th></tr>}>
            {data.children.map((c) => (
              <tr key={c.id}>
                <td>{c.fullName}{c.school ? <div className="faint">{c.school}</div> : null}</td>
                <td>{c.grade}</td>
                <td>{c.relation === 'SELF' ? 'حساب الطالب نفسه' : 'ولي الأمر'}</td>
              </tr>
            ))}
          </Ledger>
        ) : <Empty>لا يوجد طلاب مرتبطون.</Empty>}
      </section>
    </div>
  );
}

function UserAudit({ data }: { data: UserDetail }) {
  if (!data.audit.length) return <Empty>لا توجد عمليات مسجلة.</Empty>;
  return (
    <Ledger head={<tr><th>الوقت</th><th>العملية</th><th>بواسطة</th><th>العنوان</th><th>تفاصيل</th></tr>}>
      {data.audit.map((a) => (
        <tr key={a.id}>
          <td className="faint nowrap">{fmtDateTime(a.createdAt)}</td>
          <td>{actionLabel(a.action)}</td>
          <td>{a.actorUserId === data.user.id ? 'صاحب الحساب' : a.actorUserId ? <Link href={`/platform/users/${a.actorUserId}`}>آخر</Link> : 'النظام'}</td>
          <td className="num faint">{a.ip ?? ''}</td>
          <td className="faint" style={{ maxWidth: 320, overflowWrap: 'anywhere' }}>{metaText(a.meta)}</td>
        </tr>
      ))}
    </Ledger>
  );
}
