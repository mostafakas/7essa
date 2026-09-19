'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { Paged, UserRow } from '@/lib/platform';
import { Chip, Field } from './ui';

/** بحث سريع عن مستخدم موجود (مالك أو عضو) */
export function UserPicker({ value, onChange }: { value: UserRow | null; onChange: (u: UserRow | null) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<UserRow[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      api<Paged<UserRow>>('/platform/users', { workspace: false, query: { q: q.trim(), pageSize: 8 } })
        .then((r) => setResults(r.items))
        .catch(() => setResults([]));
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  if (value) {
    return (
      <div className="note info row-between">
        <span>{value.name} — <span className="num" dir="ltr">{value.login}</span></span>
        <button type="button" className="btn ghost" onClick={() => onChange(null)}>تغيير</button>
      </div>
    );
  }
  return (
    <div className="stack-sm">
      <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث بالاسم أو اسم المستخدم أو الموبايل" />
      {results.length ? (
        <div className="stack-sm">
          {results.map((u) => (
            <button type="button" key={u.id} className="btn quiet" style={{ justifyContent: 'space-between' }} onClick={() => onChange(u)} disabled={u.status !== 'ACTIVE'}>
              <span>{u.name}</span><span className="num" dir="ltr">{u.login}</span>
            </button>
          ))}
        </div>
      ) : q.trim().length >= 2 ? <p className="faint">لا توجد نتائج.</p> : null}
    </div>
  );
}

/** بيانات حساب جديد: رقم موبايل أو اسم مستخدم (أو الاثنين) */
export function NewUserFields({ value, onChange }: { value: { name: string; phone: string; username: string }; onChange: (v: { name: string; phone: string; username: string }) => void }) {
  return (
    <div className="form-grid">
      <Field label="الاسم"><input className="input" value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} required minLength={2} /></Field>
      <Field label="رقم الموبايل"><input className="input" dir="ltr" inputMode="tel" value={value.phone} onChange={(e) => onChange({ ...value, phone: e.target.value })} placeholder="01xxxxxxxxx" /></Field>
      <Field label="اسم المستخدم (اختياري)" hint="حروف إنجليزية صغيرة وأرقام"><input className="input" dir="ltr" value={value.username} onChange={(e) => onChange({ ...value, username: e.target.value.toLowerCase() })} /></Field>
    </div>
  );
}


/** شارة حالة الحساب */
export function userStateChip(u: Pick<UserRow, 'status' | 'hasPassword' | 'lastLoginAt' | 'lockedUntil' | 'mustChangePassword'>) {
  if (u.status === 'DISABLED') return <Chip tone="bad">موقوف</Chip>;
  if (u.lockedUntil && new Date(u.lockedUntil) > new Date()) return <Chip tone="bad">مقفول مؤقتًا</Chip>;
  if (!u.hasPassword) return <Chip tone="warn">بلا كلمة مرور</Chip>;
  if (!u.lastLoginAt) return <Chip tone="info">لم يدخل بعد</Chip>;
  if (u.mustChangePassword) return <Chip tone="warn">كلمة مؤقتة</Chip>;
  return <Chip tone="ok">نشط</Chip>;
}
