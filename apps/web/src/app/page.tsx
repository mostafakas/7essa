'use client';

import { useEffect } from 'react';
import { api } from '@/lib/api';
import type { Me } from '@/lib/session';

/** نقطة الدخول: توجيه كل مستخدم للبوابة المناسبة له */
export default function Entry() {
  useEffect(() => {
    api<Me>('/auth/me', { workspace: false })
      .then((me) => window.location.replace(destinationFor(me)))
      .catch(() => window.location.replace('/login'));
  }, []);
  return <p className="skeleton" style={{ padding: '2rem' }}>جارٍ فتح حصّة…</p>;
}

function destinationFor(me: Me) {
  if (me.memberships.length) return '/app';
  if (me.children) return '/family';
  if (me.user.isPlatformAdmin) return '/platform';
  return '/start';
}
