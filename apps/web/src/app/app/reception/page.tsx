'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { api, errorText, isNetworkError, workspaceStore } from '@/lib/api';
import { egpP, fmtTime, num } from '@/lib/format';
import type { ScanResult, TodaySession } from '@/lib/types';
import { useLoad } from '@/lib/use-load';
import { Guard } from '@/components/app-shell';
import { CameraScanner, cameraScanSupported } from '@/components/camera-scanner';
import { Chip, Empty, ErrorNote, Loading, PageHead, Stamp, type StampTone } from '@/components/ui';

interface OfflineOp {
  clientOpId: string;
  sessionId: string;
  scannedAt: string;
  token?: string;
  code?: string;
}

interface SyncResponse {
  synced: number;
  failed: number;
  results: ({ clientOpId: string } & ({ ok: true; result: ScanResult } | { ok: false; error: string }))[];
}

interface StampState {
  tone: StampTone;
  word: string;
  who?: string;
  sub?: string;
  key: number;
}

interface LogLine {
  key: number;
  at: Date;
  text: string;
  tone: 'ok' | 'warn' | 'bad' | 'info';
}

const queueKey = () => `hessa.offline.${workspaceStore.get() ?? 'none'}`;
const sessionsKey = () => `hessa.today.${workspaceStore.get() ?? 'none'}`;

function readQueue(): OfflineOp[] {
  try {
    return JSON.parse(window.localStorage.getItem(queueKey()) ?? '[]') as OfflineOp[];
  } catch {
    return [];
  }
}
const writeQueue = (ops: OfflineOp[]) => window.localStorage.setItem(queueKey(), JSON.stringify(ops));

const newOpId = () => crypto.randomUUID().replace(/-/g, '');

function stampFor(r: ScanResult): Omit<StampState, 'key'> {
  const remaining = r.due?.remaining;
  if (r.duplicate) return { tone: 'neutral', word: 'مسجّل', who: r.studentName, sub: 'تم تسجيل حضوره من قبل في هذه الحصة' };
  if (r.due?.state === 'SUSPENDED') return { tone: 'bad', word: 'موقوف', who: r.studentName, sub: 'الاشتراك موقوف. راجع الإدارة قبل الدخول' };
  if (r.due?.state === 'DUES') {
    return {
      tone: 'dues',
      word: r.status === 'LATE' ? 'متأخر' : 'حاضر',
      who: r.studentName,
      sub: remaining !== undefined ? `عليه ${egpP(remaining)} لهذا الشهر` : 'عليه مبلغ متبقٍ لهذا الشهر',
    };
  }
  if (r.status === 'LATE') return { tone: 'late', word: 'متأخر', who: r.studentName, sub: r.group };
  return { tone: 'ok', word: 'حاضر', who: r.studentName, sub: r.group };
}

export default function ReceptionPage() {
  return (
    <Guard perm="attendance.record">
      <Station />
    </Guard>
  );
}

function Station() {
  const sessions = useLoad(async () => {
    try {
      const rows = await api<TodaySession[]>('/attendance/today');
      window.localStorage.setItem(sessionsKey(), JSON.stringify(rows));
      return rows;
    } catch (e) {
      // دون اتصال: استخدم آخر نسخة محفوظة من حصص اليوم
      const cached = window.localStorage.getItem(sessionsKey());
      if (isNetworkError(e) && cached) return JSON.parse(cached) as TodaySession[];
      throw e;
    }
  }, []);

  // دوال ثابتة المرجع حتى لا تُعاد المزامنة مع كل إعادة رسم
  const { reload: reloadSessions, setData: setSessionsData } = sessions;
  const [sessionId, setSessionId] = useState<string>('');
  const [value, setValue] = useState('');
  const [stamp, setStamp] = useState<StampState | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const [queue, setQueue] = useState<OfflineOp[]>([]);
  const [online, setOnline] = useState(true);
  const [camera, setCamera] = useState(false);
  const [syncErrors, setSyncErrors] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const counter = useRef(0);
  const busy = useRef(false);

  const selectable = useMemo(
    () => (sessions.data ?? []).filter((s) => s.status !== 'CANCELLED' && s.status !== 'CLOSED'),
    [sessions.data],
  );
  const selected = sessions.data?.find((s) => s.id === sessionId);

  // اختيار الحصة الجارية تلقائيًا
  useEffect(() => {
    if (sessionId || !selectable.length) return;
    const now = Date.now();
    const live = selectable.find((s) => new Date(s.startsAt).getTime() - 15 * 60_000 <= now && new Date(s.endsAt).getTime() + 3_600_000 >= now);
    setSessionId((live ?? selectable[0]).id);
  }, [selectable, sessionId]);

  useEffect(() => {
    setQueue(readQueue());
    setOnline(navigator.onLine);
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  const pushLog = useCallback((text: string, tone: LogLine['tone']) => {
    setLog((l) => [{ key: ++counter.current, at: new Date(), text, tone }, ...l].slice(0, 14));
  }, []);

  const show = useCallback((s: Omit<StampState, 'key'>) => setStamp({ ...s, key: ++counter.current }), []);

  const enqueue = useCallback(
    (op: OfflineOp) => {
      const next = [...readQueue(), op];
      writeQueue(next);
      setQueue(next);
      show({ tone: 'neutral', word: 'محفوظ', sub: 'لا يوجد اتصال. سيُرسل الحضور تلقائيًا عند عودة الشبكة' });
      pushLog('حضور محفوظ على الجهاز بانتظار الاتصال', 'info');
    },
    [pushLog, show],
  );

  const sync = useCallback(async () => {
    const ops = readQueue();
    if (!ops.length) return;
    try {
      const res = await api<SyncResponse>('/attendance/sync', { method: 'POST', body: { ops: ops.slice(0, 500) } });
      const done = new Set(res.results.map((r) => r.clientOpId));
      const remaining = readQueue().filter((o) => !done.has(o.clientOpId));
      writeQueue(remaining);
      setQueue(remaining);
      const errors = res.results.filter((r): r is { clientOpId: string; ok: false; error: string } => !r.ok).map((r) => r.error);
      setSyncErrors(errors);
      pushLog(`تمت مزامنة ${num(res.synced)} حضور${res.failed ? `، وتعذر ${num(res.failed)}` : ''}`, res.failed ? 'warn' : 'ok');
      void reloadSessions();
    } catch (e) {
      if (!isNetworkError(e)) pushLog(errorText(e), 'bad');
    }
  }, [pushLog, reloadSessions]);

  useEffect(() => {
    if (!online) return;
    void sync();
    const t = setInterval(() => void sync(), 20_000);
    return () => clearInterval(t);
  }, [online, sync]);

  const submit = useCallback(
    async (raw: string) => {
      const v = raw.trim();
      if (!v || !sessionId || busy.current) return;
      busy.current = true;
      setValue('');
      const payload = /^\d{6}$/.test(v) ? { code: v } : { token: v };
      const op: OfflineOp = { clientOpId: newOpId(), sessionId, scannedAt: new Date().toISOString(), ...payload };
      try {
        if (!navigator.onLine) {
          enqueue(op);
          return;
        }
        const r = await api<ScanResult>('/attendance/scan', { method: 'POST', body: { sessionId, ...payload } });
        const s = stampFor(r);
        show(s);
        pushLog(`${r.studentName}: ${s.word}${s.tone === 'dues' ? ' (عليه متأخرات)' : ''}`, s.tone === 'ok' ? 'ok' : s.tone === 'bad' ? 'bad' : s.tone === 'neutral' ? 'info' : 'warn');
        if (!r.duplicate) {
          setSessionsData((rows) => rows?.map((x) => (x.id === sessionId ? { ...x, present: x.present + 1, status: 'OPEN' as const } : x)) ?? rows);
        }
      } catch (e) {
        if (isNetworkError(e)) {
          enqueue(op);
        } else {
          const msg = errorText(e);
          show({ tone: 'bad', word: 'مرفوض', sub: msg });
          pushLog(msg, 'bad');
        }
      } finally {
        busy.current = false;
        input.current?.focus();
      }
    },
    [enqueue, pushLog, sessionId, setSessionsData, show],
  );

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit(value);
  };

  const onCamera = useCallback((code: string) => void submit(code), [submit]);

  return (
    <>
      <PageHead title="الحضور عند الباب" sub="امسح كارنيه الطالب أو شاشة تطبيقه، أو اكتب كوده المكون من 6 أرقام.">
        {!online ? <Chip tone="bad">دون اتصال</Chip> : <Chip tone="ok">متصل</Chip>}
        {queue.length ? <Chip tone="warn">{num(queue.length)} بانتظار الإرسال</Chip> : null}
      </PageHead>

      <ErrorNote error={sessions.error} onRetry={sessions.reload} />
      {sessions.loading && !sessions.data ? <Loading what="حصص اليوم" /> : null}
      {sessions.data && !selectable.length ? (
        <Empty action={<Link className="btn quiet" href="/app/schedule">الجدول</Link>}>لا توجد حصص مفتوحة اليوم لتسجيل الحضور.</Empty>
      ) : null}

      {selectable.length ? (
        <div className="split">
          <section className="panel stack">
            <label className="field">
              <span>الحصة</span>
              <select className="select" value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
                {selectable.map((s) => (
                  <option key={s.id} value={s.id}>
                    {fmtTime(s.startsAt)} — {s.group} ({s.teacherName})
                  </option>
                ))}
              </select>
            </label>

            <form onSubmit={onSubmit} className="row">
              <label className="grow">
                <span className="sr-only">رمز الـQR أو كود الطالب</span>
                <input
                  ref={input}
                  className="input"
                  style={{ fontSize: '1.25rem', minHeight: 56 }}
                  dir="ltr"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="امسح الآن أو اكتب الكود"
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <button className="btn big" disabled={!value.trim()}>سجّل الحضور</button>
              {cameraScanSupported() ? (
                <button type="button" className="btn big quiet" onClick={() => setCamera((c) => !c)}>
                  {camera ? 'إخفاء الكاميرا' : 'الكاميرا'}
                </button>
              ) : null}
            </form>

            {camera ? <CameraScanner onCode={onCamera} onClose={() => setCamera(false)} /> : null}

            <div className="stamp-zone">
              {stamp ? (
                <Stamp tone={stamp.tone} word={stamp.word} who={stamp.who} sub={stamp.sub} pressKey={stamp.key} />
              ) : (
                <p className="muted">نتيجة كل مسح تظهر هنا بخط كبير يراه الطالب.</p>
              )}
            </div>

            {syncErrors.length ? (
              <div className="note warn">
                تعذر تسجيل بعض عمليات الحضور المحفوظة: {syncErrors.slice(0, 3).join('، ')}
              </div>
            ) : null}
          </section>

          <aside className="stack">
            {selected ? (
              <section className="panel stack-sm">
                <h3>{selected.group}</h3>
                <p className="muted">{selected.teacherName}{selected.hall ? `، ${selected.hall}` : ''}</p>
                <div className="big-figure num">{num(selected.present)} / {num(selected.enrolled)}</div>
                <div className="fill"><i style={{ width: `${selected.enrolled ? (selected.present / selected.enrolled) * 100 : 0}%` }} /></div>
                <Link href={`/app/sessions/${selected.id}`}>كشف الحصة وإغلاقه</Link>
              </section>
            ) : null}

            <section className="panel">
              <h3>آخر العمليات</h3>
              {!log.length ? <p className="faint">لا شيء بعد.</p> : null}
              <ul className="stack-sm" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {log.map((l) => (
                  <li key={l.key} className="row-between">
                    <span className={l.tone === 'bad' ? '' : undefined} style={l.tone === 'bad' ? { color: 'var(--redpen)' } : undefined}>
                      {l.tone === 'warn' ? <span className="mark">{l.text}</span> : l.text}
                    </span>
                    <span className="faint num">{fmtTime(l.at)}</span>
                  </li>
                ))}
              </ul>
            </section>
          </aside>
        </div>
      ) : null}
    </>
  );
}
