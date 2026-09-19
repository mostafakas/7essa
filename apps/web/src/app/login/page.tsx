'use client';

import { useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { homeFor, type Me } from '@/lib/session';
import { useAction } from '@/lib/use-load';
import { Field } from '@/components/ui';

function safeNext(): string | null {
  const next = new URLSearchParams(window.location.search).get('next');
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/login') ? next : null;
}

export default function LoginPage() {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const { busy, error, run } = useAction();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const me = await api<Me>('/auth/login', { method: 'POST', body: { identifier: identifier.trim(), password }, workspace: false });
      window.location.assign(me.user.mustChangePassword ? '/account?required=1' : (safeNext() ?? homeFor(me)));
    });
  };

  return (
    <div className="auth">
      <section className="auth-board">
        <div className="stack">
          <span className="brand" style={{ padding: 0 }}>حصّة</span>
          <h1>السنتر كله في دفتر واحد</h1>
          <p className="chalk">الحضور عند الباب، الخزنة، حساب المدرسين، والامتحانات. وولي الأمر يعرف كل شيء أولًا بأول.</p>
        </div>
        <div className="chalk-lines" aria-hidden>
          <div>الطالب يمسح الكارنيه، وولي الأمر يصله إشعار الوصول</div>
          <div>كل جنيه بإيصال مرقم، والإلغاء يحتاج موافقة شخص ثانٍ</div>
          <div>كشف حساب المدرس جاهز آخر الشهر، يراجعه ويؤكده</div>
        </div>
      </section>

      <section className="auth-form">
        <form onSubmit={submit} noValidate>
          <h2>تسجيل الدخول</h2>
          <p className="muted">ادخل باسم المستخدم أو رقم الموبايل المسجل.</p>
          <Field label="اسم المستخدم أو رقم الموبايل">
            <input
              className="input"
              dir="ltr"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="hesham أو 01xxxxxxxxx"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              required
              autoFocus
            />
          </Field>
          <Field label="كلمة المرور">
            <div className="row" style={{ gap: '0.4rem', flexWrap: 'nowrap' }}>
              <input
                className="input"
                dir="ltr"
                type={show ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button type="button" className="btn ghost" onClick={() => setShow((v) => !v)} aria-pressed={show}>
                {show ? 'إخفاء' : 'إظهار'}
              </button>
            </div>
          </Field>
          {error ? <div className="note error" role="alert">{error}</div> : null}
          <button className="btn big" disabled={busy || identifier.trim().length < 3 || !password}>
            {busy ? 'جارٍ الدخول…' : 'دخول'}
          </button>
          <p className="faint">
            الحسابات تُنشأ عن طريق السنتر أو إدارة المنصة. نسيت كلمة المرور؟ اطلب من السنتر أو إدارة المنصة إعادة تعيينها.
          </p>
        </form>
      </section>
    </div>
  );
}
