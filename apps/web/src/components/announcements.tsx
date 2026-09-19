'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface Announcement {
  id: string;
  title: string;
  body: string;
  level: 'INFO' | 'WARNING' | 'CRITICAL';
}

const KEY = 'hessa.dismissed';
const TONE = { INFO: 'info', WARNING: 'warn', CRITICAL: 'error' } as const;

function dismissed(): string[] {
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

/** شريط إعلانات إدارة المنصة ورسالة الصيانة (الإعلان الحرج لا يُخفى) */
export function AnnouncementsBar() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [maintenance, setMaintenance] = useState<string | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);

  useEffect(() => {
    setHidden(dismissed());
    api<{ maintenance: string | null; items: Announcement[] }>('/announcements/active', { workspace: false })
      .then((r) => {
        setItems(r.items);
        setMaintenance(r.maintenance);
      })
      .catch(() => undefined);
  }, []);

  const hide = (id: string) => {
    const next = [...new Set([...hidden, id])].slice(-50);
    setHidden(next);
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* التخزين غير متاح */
    }
  };

  const visible = items.filter((a) => a.level === 'CRITICAL' || !hidden.includes(a.id));
  if (!maintenance && !visible.length) return null;
  return (
    <div className="stack-sm no-print" style={{ marginBottom: '1rem' }}>
      {maintenance ? <div className="note warn" role="alert"><strong>صيانة: </strong>{maintenance}</div> : null}
      {visible.map((a) => (
        <div key={a.id} className={`note ${TONE[a.level]} row-between`} role="status">
          <span><strong>{a.title}</strong> — {a.body}</span>
          {a.level !== 'CRITICAL' ? <button className="btn ghost" onClick={() => hide(a.id)} aria-label="إخفاء">إخفاء</button> : null}
        </div>
      ))}
    </div>
  );
}
