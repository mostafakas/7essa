'use client';

import { useEffect } from 'react';
import { api } from '@/lib/api';
import { homeFor, type Me } from '@/lib/session';

/** نقطة الدخول: توجيه كل مستخدم للبوابة المناسبة له */
export default function Entry() {
  useEffect(() => {
    api<Me>('/auth/me', { workspace: false })
      .then((me) => window.location.replace(homeFor(me)))
      .catch(() => window.location.replace('/login'));
  }, []);
  return <p className="skeleton" style={{ padding: '2rem' }}>جارٍ فتح حصّة…</p>;
}
