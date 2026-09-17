'use client';

import { useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import type { Me } from '@/lib/session';
import { useAction } from '@/lib/use-load';
import { Field } from '@/components/ui';

function safeNext(): string | null {
  const next = new URLSearchParams(window.location.search).get('next');
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/login') ? next : null;
}

export default function LoginPage() {
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const { busy, error, run } = useAction();

  const requestCode = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api('/auth/otp/request', { method: 'POST', body: { phone }, workspace: false });
      setStep('code');
    });
  };

  const verify = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const me = await api<Me>('/auth/otp/verify', { method: 'POST', body: { phone, code }, workspace: false });
      const fallback = me.memberships.length ? '/app' : me.children ? '/family' : me.user.isPlatformAdmin ? '/platform' : '/start';
      window.location.assign(safeNext() ?? fallback);
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
        {step === 'phone' ? (
          <form onSubmit={requestCode} noValidate>
            <h2>تسجيل الدخول</h2>
            <p className="muted">نرسل رمز دخول من 6 أرقام إلى رقمك.</p>
            <Field label="رقم الموبايل">
              <input
                className="input"
                dir="ltr"
                inputMode="tel"
                autoComplete="tel"
                placeholder="01xxxxxxxxx"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                autoFocus
              />
            </Field>
            {error ? <div className="note error" role="alert">{error}</div> : null}
            <button className="btn big" disabled={busy || phone.trim().length < 10}>
              {busy ? 'جارٍ الإرسال…' : 'أرسل الرمز'}
            </button>
            <p className="faint">حسابك يُنشأ تلقائيًا عند أول دخول. أولياء الأمور يدخلون بالرقم المسجل في السنتر.</p>
          </form>
        ) : (
          <form onSubmit={verify} noValidate>
            <h2>أدخل الرمز</h2>
            <p className="muted">
              أرسلنا الرمز إلى <span className="num">{phone}</span>. صالح لمدة 5 دقائق.
            </p>
            <Field label="رمز الدخول">
              <input
                className="input otp-input"
                dir="ltr"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                autoFocus
              />
            </Field>
            {error ? <div className="note error" role="alert">{error}</div> : null}
            <button className="btn big" disabled={busy || code.length !== 6}>
              {busy ? 'جارٍ التحقق…' : 'دخول'}
            </button>
            <button type="button" className="btn ghost" onClick={() => { setStep('phone'); setCode(''); }}>
              تغيير الرقم
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
