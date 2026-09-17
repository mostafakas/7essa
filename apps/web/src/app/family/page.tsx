'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, errorText } from '@/lib/api';
import { egpP, fmtMonth, num } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useAction, useLoad } from '@/lib/use-load';
import { QrImage } from '@/components/qr-image';
import { Chip, Empty, ErrorNote, Loading, Modal } from '@/components/ui';

interface Child {
  id: string;
  fullName: string;
  grade: string;
  school: string | null;
  isGuardian: boolean;
  attendance30d: { PRESENT: number; LATE: number; ABSENT: number };
  enrollments: {
    id: string;
    code: string;
    status: string;
    consentPending: boolean;
    workspace: string;
    workspaceType: 'CENTER' | 'TEACHER' | null;
    group: string;
    subject: string;
    teacher: string | null;
    month: string;
    remaining: number;
  }[];
}

export default function FamilyHome() {
  const { me } = useSession();
  const children = useLoad(() => api<Child[]>('/family/children', { workspace: false }), []);
  const action = useAction();
  const [qrFor, setQrFor] = useState<Child | null>(null);

  const consent = (enrollmentId: string) =>
    void action.run(async () => {
      await api(`/family/consents/${enrollmentId}`, { method: 'POST', workspace: false });
      await children.reload();
    });

  return (
    <div className="stack">
      <h1>{me ? `أهلًا ${me.user.name}` : 'أبنائي'}</h1>
      <ErrorNote error={children.error ?? action.error} onRetry={children.reload} />
      {children.loading && !children.data ? <Loading what="بيانات الأبناء" /> : null}
      {children.data && !children.data.length ? (
        <Empty>
          لا يوجد أبناء مرتبطون برقمك بعد. عند تسجيل ابنك في سنتر أو عند مدرس يستخدم حصّة برقمك، سيظهر هنا تلقائيًا.
        </Empty>
      ) : null}

      {children.data?.map((c) => {
        const pending = c.enrollments.filter((e) => e.consentPending && c.isGuardian);
        const owed = c.enrollments.reduce((t, e) => t + e.remaining, 0);
        return (
          <section key={c.id} className="panel child-card" aria-labelledby={`child-${c.id}`}>
            <div className="row-between">
              <div>
                <h2 id={`child-${c.id}`}>{c.fullName}</h2>
                <p className="muted">{c.grade}{c.school ? `، ${c.school}` : ''}</p>
              </div>
              <div className="row">
                <button className="btn" onClick={() => setQrFor(c)}>كود الحضور</button>
                <Link className="btn quiet" href={`/family/child/${c.id}`}>التفاصيل</Link>
              </div>
            </div>

            {pending.length ? (
              <div className="note warn stack-sm">
                {pending.map((e) => (
                  <div key={e.id} className="row-between">
                    <span>سُجل {c.fullName} في «{e.group}» لدى {e.workspace}. هل توافق على التسجيل ومشاركة الحضور والدرجات معك؟</span>
                    <button className="btn" disabled={action.busy} onClick={() => consent(e.id)}>أوافق</button>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="row">
              <Chip tone="ok">حضر {num(c.attendance30d.PRESENT)}</Chip>
              <Chip tone="warn">تأخر {num(c.attendance30d.LATE)}</Chip>
              <Chip tone="bad">غاب {num(c.attendance30d.ABSENT)}</Chip>
              <span className="faint">آخر 30 يومًا</span>
            </div>

            {c.enrollments.map((e) => (
              <div key={e.id} className="enr">
                <div className="row-between">
                  <strong>{e.subject}: {e.group}</strong>
                  {e.remaining > 0 ? (
                    <span className="mark">متبقي {egpP(e.remaining)} عن {fmtMonth(e.month)}</span>
                  ) : (
                    <Chip tone="ok">مسدد عن {fmtMonth(e.month)}</Chip>
                  )}
                </div>
                <span className="faint">
                  {e.teacher ? `${e.teacher}، ` : ''}{e.workspace}، كود الطالب <span className="num">{e.code}</span>
                  {e.status === 'SUSPENDED' ? '، الاشتراك موقوف' : e.status === 'WAITLIST' ? '، في قائمة الانتظار' : ''}
                </span>
              </div>
            ))}
            {owed > 0 ? <p className="faint">السداد يتم في مكان الدرس، ويصلك إشعار بكل إيصال.</p> : null}
          </section>
        );
      })}

      <Modal open={Boolean(qrFor)} title={qrFor ? `كود حضور ${qrFor.fullName}` : ''} onClose={() => setQrFor(null)}>
        {qrFor ? <LiveQr studentId={qrFor.id} /> : null}
      </Modal>
    </div>
  );
}

/** رمز يتجدد كل دقيقة؛ صورة الشاشة القديمة لا تُقبل عند الباب */
function LiveQr({ studentId }: { studentId: string }) {
  const [token, setToken] = useState<string | null>(null);
  const [left, setLeft] = useState(0);
  const [total, setTotal] = useState(60);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ token: string; refreshInSeconds: number }>(`/family/children/${studentId}/qr`, { workspace: false });
      setToken(r.token);
      setLeft(r.refreshInSeconds);
      setTotal(r.refreshInSeconds);
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, [studentId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const t = setInterval(() => setLeft((l) => Math.max(0, l - 1)), 1000);
    return () => clearInterval(t);
  }, []);

  // عند انتهاء الدقيقة يُطلب رمز جديد
  useEffect(() => {
    if (token && left === 0) void load();
  }, [left, token, load]);

  return (
    <div className="qr-box">
      {error ? (
        <div className="note error row-between">
          <span>{error}</span>
          <button className="btn ghost" onClick={() => void load()}>أعد المحاولة</button>
        </div>
      ) : null}
      {token ? <QrImage value={token} alt="رمز الحضور" /> : <Loading what="الرمز" />}
      <div className="countdown" aria-hidden><i style={{ width: `${total ? (left / total) * 100 : 0}%` }} /></div>
      <p className="muted">يتجدد خلال <span className="num">{num(left)}</span> ثانية. ارفع إضاءة الشاشة وقرّبها من القارئ.</p>
    </div>
  );
}
