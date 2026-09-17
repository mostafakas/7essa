'use client';

import Link from 'next/link';
import { api } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useAction, useLoad } from '@/lib/use-load';
import { Empty, ErrorNote, Loading } from '@/components/ui';

interface Notice {
  id: string;
  kind: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

export default function NotificationsPage() {
  const { data, error, loading, reload } = useLoad(() => api<{ unread: number; items: Notice[] }>('/notifications', { workspace: false }), []);
  const action = useAction();

  const markAll = () =>
    void action.run(async () => {
      await api('/notifications/read', { method: 'POST', body: {}, workspace: false });
      await reload();
    });

  return (
    <>
      <header className="top-bar">
        <Link href="/" className="brand" style={{ padding: 0 }}>حصّة</Link>
        <nav>
          <Link href="/">رجوع</Link>
        </nav>
      </header>
      <main className="narrow stack">
        <div className="row-between">
          <h1>الإشعارات</h1>
          {data?.unread ? (
            <button className="btn quiet" onClick={markAll} disabled={action.busy}>تعليم الكل كمقروء</button>
          ) : null}
        </div>
        <ErrorNote error={error ?? action.error} onRetry={reload} />
        {loading && !data ? <Loading what="الإشعارات" /> : null}
        {data && !data.items.length ? <Empty>لا توجد إشعارات بعد.</Empty> : null}
        <div className="panel" hidden={!data?.items.length}>
          <div className="timeline">
            {data?.items.map((n) => (
              <article key={n.id} className="slot" style={{ gridTemplateColumns: '1fr auto' }}>
                <div>
                  <div className="title">
                    {!n.readAt ? <span className="mark">{n.title}</span> : n.title}
                  </div>
                  <p className="muted">{n.body}</p>
                </div>
                <span className="faint nowrap">{fmtDateTime(n.createdAt)}</span>
              </article>
            ))}
          </div>
        </div>
      </main>
    </>
  );
}
