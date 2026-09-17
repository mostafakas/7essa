'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { api, workspaceStore } from '@/lib/api';
import { logout, type Me } from '@/lib/session';
import { useAction } from '@/lib/use-load';
import { Field, Loading } from '@/components/ui';

const PLACEHOLDER_NAME = 'مستخدم جديد';

export default function StartPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState<'CENTER' | 'TEACHER'>('CENTER');
  const [wsName, setWsName] = useState('');
  const { busy, error, run } = useAction();

  useEffect(() => {
    api<Me>('/auth/me', { workspace: false }).then((m) => {
      setMe(m);
      if (m.user.name !== PLACEHOLDER_NAME) setName(m.user.name);
    });
  }, []);

  if (!me) return <main className="narrow"><Loading what="حسابك" /></main>;
  const needsName = me.user.name === PLACEHOLDER_NAME;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      if (needsName || name.trim() !== me.user.name) {
        await api('/auth/me', { method: 'PATCH', body: { name: name.trim() }, workspace: false });
      }
      const created = await api<{ id: string }>('/workspaces', { method: 'POST', body: { type, name: wsName.trim() }, workspace: false });
      workspaceStore.set(created.id);
      window.location.assign('/app/settings?welcome=1');
    });
  };

  return (
    <>
      <header className="top-bar">
        <span className="brand" style={{ padding: 0 }}>حصّة</span>
        <nav>
          {me.memberships.length ? <Link href="/app">مساحات العمل</Link> : null}
          {me.children ? <Link href="/family">أبنائي</Link> : null}
          <button className="btn ghost" onClick={() => void logout()}>تسجيل الخروج</button>
        </nav>
      </header>
      <main className="narrow stack">
        <h1>ابدأ مساحة عملك</h1>
        <p className="muted">30 يومًا تجربة كاملة بدون بطاقة دفع. تقدر تضيف فريقك بعد الإنشاء.</p>

        <form className="panel stack" onSubmit={submit}>
          <Field label="اسمك">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={80} autoComplete="name" />
          </Field>

          <fieldset className="stack-sm" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="field" style={{ marginBottom: '0.4rem' }}><span>نوع النشاط</span></legend>
            <div className="checks">
              <label>
                <input type="radio" name="type" checked={type === 'CENTER'} onChange={() => setType('CENTER')} />
                سنتر فيه أكثر من مدرس
              </label>
              <label>
                <input type="radio" name="type" checked={type === 'TEACHER'} onChange={() => setType('TEACHER')} />
                مدرس بمجموعاتي الخاصة
              </label>
            </div>
          </fieldset>

          <Field label={type === 'CENTER' ? 'اسم السنتر' : 'الاسم الذي يظهر لأولياء الأمور'} hint={type === 'TEACHER' ? 'مثال: أ. محمد علي — كيمياء' : undefined}>
            <input className="input" value={wsName} onChange={(e) => setWsName(e.target.value)} required minLength={2} maxLength={80} />
          </Field>

          {error ? <div className="note error" role="alert">{error}</div> : null}
          <div className="row">
            <button className="btn big" disabled={busy || name.trim().length < 2 || wsName.trim().length < 2}>
              {busy ? 'جارٍ الإنشاء…' : 'أنشئ مساحة العمل'}
            </button>
          </div>
        </form>

        <div className="note info">
          ولي أمر؟ لا تحتاج لإنشاء شيء. اطلب من السنتر أو المدرس تسجيل ابنك برقمك، وستظهر بياناته هنا تلقائيًا.
        </div>
      </main>
    </>
  );
}
