'use client';

import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { num } from '@/lib/format';
import { useLoad } from '@/lib/use-load';
import { QrImage } from '@/components/qr-image';
import { ErrorNote, Loading } from '@/components/ui';

interface Card {
  workspaceName: string;
  fullName: string;
  grade: string;
  cardVersion: number;
  token: string;
  codes: { code: string; group: string; subject: string }[];
}

/** كارنيه بمقاس بطاقة البنك (86×54 مم) */
export default function CardPrint() {
  const { id } = useParams<{ id: string }>();
  const card = useLoad(() => api<Card>(`/students/${id}/card`), [id]);
  const c = card.data;

  return (
    <main style={{ padding: '1.5rem', display: 'grid', gap: '1rem', justifyItems: 'center' }}>
      <ErrorNote error={card.error} onRetry={card.reload} />
      {card.loading && !c ? <Loading what="الكارنيه" /> : null}
      {c ? (
        <>
          <article className="card-print">
            <div style={{ display: 'grid', alignContent: 'space-between', gap: 4 }}>
              <div className="ws">{c.workspaceName}</div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{c.fullName}</div>
                <div style={{ fontSize: 12 }}>{c.grade}</div>
              </div>
              <div style={{ fontSize: 11 }}>
                {c.codes.map((x) => (
                  <div key={x.code}>
                    {x.subject}: <span className="num">{x.code}</span>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 9, color: 'var(--ink-3)' }}>إصدار {num(c.cardVersion)}، امسح الكود عند الباب</div>
            </div>
            <QrImage value={c.token} size={220} alt={`كود ${c.fullName}`} />
          </article>
          <div className="row no-print">
            <button className="btn" onClick={() => window.print()}>اطبع الكارنيه</button>
          </div>
          <p className="faint no-print" style={{ maxWidth: '60ch', textAlign: 'center' }}>
            عند فقد الكارنيه استخدم «كارنيه بدل فاقد» من ملف الطالب؛ يتوقف القديم فورًا في كل الأماكن.
          </p>
        </>
      ) : null}
    </main>
  );
}
