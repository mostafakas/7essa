'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { localPhone, num, PLATFORM_ROLE_LABEL } from '@/lib/format';
import { homeFor, logout, type Me } from '@/lib/session';
import { useAction } from '@/lib/use-load';
import { Chip, Field, Loading } from '@/components/ui';

/** حسابي: تغيير كلمة المرور (إجباري بعد كلمة مؤقتة) والاسم والخروج من الأجهزة */
export default function AccountPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [required, setRequired] = useState(false);
  const [f, setF] = useState({ current: '', next: '', confirm: '' });
  const [name, setName] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const pwd = useAction();
  const profile = useAction();

  useEffect(() => {
    setRequired(new URLSearchParams(window.location.search).get('required') === '1');
    api<Me>('/auth/me', { workspace: false })
      .then((m) => {
        setMe(m);
        setName(m.user.name);
        if (m.user.mustChangePassword) setRequired(true);
      })
      .catch(() => window.location.assign('/login?next=/account'));
  }, []);

  if (!me) return <main className="narrow"><Loading what="حسابك" /></main>;

  const problem =
    f.next.length > 0 && f.next.length < 8
      ? 'كلمة المرور 8 أحرف على الأقل'
      : f.next && !(/[A-Za-z\u0600-\u06FF]/.test(f.next) && /\d/.test(f.next))
        ? 'استخدم حروفًا وأرقامًا معًا'
        : f.confirm && f.confirm !== f.next
          ? 'التأكيد لا يطابق كلمة المرور الجديدة'
          : null;

  const changePassword = (e: FormEvent) => {
    e.preventDefault();
    void pwd.run(async () => {
      const m = await api<Me>('/auth/change-password', {
        method: 'POST',
        body: { currentPassword: f.current, newPassword: f.next },
        workspace: false,
      });
      setF({ current: '', next: '', confirm: '' });
      if (required) {
        window.location.assign(homeFor(m));
        return;
      }
      setMe(m);
      setDone('تم تغيير كلمة المرور، وأُنهيت الجلسات على الأجهزة الأخرى.');
    });
  };

  const saveName = (e: FormEvent) => {
    e.preventDefault();
    void profile.run(async () => {
      setMe(await api<Me>('/auth/me', { method: 'PATCH', body: { name: name.trim() }, workspace: false }));
      setDone('حُفظ اسمك.');
    });
  };

  const logoutAll = () =>
    window.confirm('سيتم تسجيل خروجك من كل الأجهزة، بما فيها هذا الجهاز. متابعة؟') &&
    void profile.run(async () => {
      await api('/auth/logout-all', { method: 'POST', workspace: false });
      await logout();
    });

  return (
    <>
      <header className="top-bar">
        <span className="brand" style={{ padding: 0 }}>حصّة</span>
        <nav>
          {!required ? <Link href={homeFor(me)}>رجوع</Link> : null}
          <button className="btn ghost" onClick={() => void logout()}>تسجيل الخروج</button>
        </nav>
      </header>
      <main className="narrow stack">
        <h1>{required ? 'اختر كلمة مرور جديدة' : 'حسابي'}</h1>
        {required ? (
          <div className="note warn">
            تدخل الآن بكلمة مرور مؤقتة. اختر كلمة مرور خاصة بك لا يعرفها غيرك لتكمل استخدام حصّة.
          </div>
        ) : null}
        {done ? <div className="note info" role="status">{done}</div> : null}

        <form className="panel stack" onSubmit={changePassword}>
          <h2>{required ? 'كلمة المرور' : 'تغيير كلمة المرور'}</h2>
          <Field label={required ? 'كلمة المرور المؤقتة التي استلمتها' : 'كلمة المرور الحالية'}>
            <input className="input" dir="ltr" type="password" autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} required />
          </Field>
          <div className="form-grid">
            <Field label="كلمة المرور الجديدة" hint="8 أحرف على الأقل، حروف وأرقام">
              <input className="input" dir="ltr" type="password" autoComplete="new-password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} required minLength={8} />
            </Field>
            <Field label="تأكيد كلمة المرور الجديدة">
              <input className="input" dir="ltr" type="password" autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} required />
            </Field>
          </div>
          {problem ? <div className="note warn">{problem}</div> : null}
          {pwd.error ? <div className="note error" role="alert">{pwd.error}</div> : null}
          <div className="row">
            <button className="btn" disabled={pwd.busy || !f.current || !f.next || f.next !== f.confirm || Boolean(problem)}>
              {pwd.busy ? 'جارٍ الحفظ…' : 'احفظ كلمة المرور'}
            </button>
          </div>
        </form>

        {!required ? (
          <section className="panel stack">
            <h2>بيانات الحساب</h2>
            <div className="row">
              {me.user.username ? <span>اسم المستخدم: <span className="num" dir="ltr">{me.user.username}</span></span> : null}
              {me.user.phone ? <span>الموبايل: <span className="num">{localPhone(me.user.phone)}</span></span> : null}
              {me.user.platformRole ? <Chip tone="info">{PLATFORM_ROLE_LABEL[me.user.platformRole]}</Chip> : null}
            </div>
            <p className="muted">
              عضو في {num(me.memberships.length)} مساحة عمل{me.children ? `، ومرتبط بـ ${num(me.children)} طالب` : ''}. لتغيير اسم المستخدم أو الرقم تواصل مع إدارة المنصة.
            </p>
            <form className="stack-sm" onSubmit={saveName}>
              <Field label="اسمك">
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={80} />
              </Field>
              <div className="row"><button className="btn quiet" disabled={profile.busy || name.trim() === me.user.name || name.trim().length < 2}>احفظ الاسم</button></div>
            </form>
            {profile.error ? <div className="note error">{profile.error}</div> : null}
            <div className="row">
              <button className="btn danger" onClick={logoutAll} disabled={profile.busy}>الخروج من كل الأجهزة</button>
            </div>
          </section>
        ) : null}
      </main>
    </>
  );
}
