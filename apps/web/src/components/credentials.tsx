'use client';

import { useState } from 'react';

export interface Credentials {
  login: string;
  password: string;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

/**
 * بيانات دخول تظهر مرة واحدة فقط: تُنسخ أو تُطبع وتُسلم لصاحبها.
 * صاحب الحساب يُطلب منه تغيير كلمة المرور عند أول دخول.
 */
export function CredentialsCard({ credentials, name, title = 'بيانات الدخول' }: { credentials: Credentials; name?: string; title?: string }) {
  const [copied, setCopied] = useState(false);
  const site = typeof window === 'undefined' ? '' : window.location.origin;
  const text = `${name ? `${name}\n` : ''}رابط الدخول: ${site}/login\nاسم المستخدم: ${credentials.login}\nكلمة المرور المؤقتة: ${credentials.password}\n(سيُطلب منك تغييرها عند أول دخول)`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('انسخ البيانات:', text);
    }
  };

  const print = () => {
    const w = window.open('', '_blank', 'width=480,height=520');
    if (!w) return;
    w.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font-family:Tahoma,sans-serif;padding:24px}.card{border:2px dashed #1e3b33;border-radius:12px;padding:20px;max-width:360px}
h1{font-size:20px;margin:0 0 12px}dt{color:#555;font-size:13px;margin-top:10px}dd{margin:2px 0 0;font-size:20px;font-weight:700;direction:ltr;text-align:right;font-family:monospace}
p{font-size:12px;color:#555;margin-top:16px}</style></head><body><div class="card"><h1>حصّة — ${esc(title)}</h1>
${name ? `<div>${esc(name)}</div>` : ''}<dl><dt>رابط الدخول</dt><dd>${esc(site)}/login</dd><dt>اسم المستخدم</dt><dd>${esc(credentials.login)}</dd>
<dt>كلمة المرور المؤقتة</dt><dd>${esc(credentials.password)}</dd></dl><p>سيُطلب منك اختيار كلمة مرور جديدة عند أول دخول. لا تشارك هذه البيانات مع أحد.</p></div></body></html>`);
    w.document.close();
    w.focus();
    w.print();
  };

  return (
    <div className="note warn stack-sm" role="status">
      <strong>{title}{name ? ` — ${name}` : ''}</strong>
      <div className="form-grid" style={{ alignItems: 'start' }}>
        <div>
          <div className="faint">اسم المستخدم</div>
          <div className="num" dir="ltr" style={{ fontSize: '1.15rem', fontWeight: 700, textAlign: 'right' }}>{credentials.login}</div>
        </div>
        <div>
          <div className="faint">كلمة المرور المؤقتة</div>
          <div className="num" dir="ltr" style={{ fontSize: '1.15rem', fontWeight: 700, textAlign: 'right' }}>{credentials.password}</div>
        </div>
      </div>
      <span>تظهر هذه البيانات مرة واحدة فقط. سلّمها لصاحب الحساب، وسيغير كلمة المرور عند أول دخول.</span>
      <div className="row">
        <button type="button" className="btn quiet" onClick={() => void copy()}>{copied ? 'تم النسخ ✓' : 'نسخ'}</button>
        <button type="button" className="btn quiet" onClick={print}>طباعة</button>
      </div>
    </div>
  );
}
