'use client';

import { useState, type FormEvent } from 'react';
import { api, ApiError } from '@/lib/api';
import { addDays, cairoMonth, cairoToday, egp, fmtDateTime, fmtDay, fmtTime, num, WEEKDAYS } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { GroupRow, Hall, SessionRow, TeacherOption } from '@/lib/types';
import { useAction, useLoad } from '@/lib/use-load';
import { Guard } from '@/components/app-shell';
import { Chip, Empty, ErrorNote, Field, Ledger, Loading, Modal, MonthInput, PageHead, Tabs } from '@/components/ui';

type Tab = 'week' | 'groups' | 'halls';

interface Conflict {
  requested: string;
  group: string;
  reason: string;
}

function conflictsOf(e: unknown): Conflict[] {
  if (e instanceof ApiError && e.status === 409) {
    const c = (e.details as { conflicts?: Conflict[] } | null)?.conflicts;
    return Array.isArray(c) ? c : [];
  }
  return [];
}

/** بداية الأسبوع (السبت) لتاريخ معين */
function weekStart(date: string) {
  let d = date;
  for (let i = 0; i < 7; i++) {
    if (new Date(`${d}T12:00:00Z`).getUTCDay() === 6) return d;
    d = addDays(d, -1);
  }
  return date;
}

export default function SchedulePage() {
  return (
    <Guard perm="academics.read">
      <Schedule />
    </Guard>
  );
}

function Schedule() {
  const { can, current } = useSession();
  const [tab, setTab] = useState<Tab>('week');
  const wsId = current?.workspace.id;
  const halls = useLoad(() => api<Hall[]>('/academics/halls'), [wsId]);
  const groups = useLoad(() => api<GroupRow[]>('/academics/groups'), [wsId]);

  return (
    <>
      <PageHead title="المجموعات والجدول" sub="الجدول يرفض أي موعد يتعارض مع حصة أخرى في نفس القاعة أو لنفس المدرس." />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        items={[
          { id: 'week', label: 'جدول الأسبوع' },
          { id: 'groups', label: 'المجموعات' },
          { id: 'halls', label: 'القاعات', hidden: current?.workspace.type === 'TEACHER' && !halls.data?.length && !can('academics.write') },
        ]}
      />
      {tab === 'week' ? <Week groups={groups.data ?? []} halls={halls.data ?? []} /> : null}
      {tab === 'groups' ? <Groups groups={groups} halls={halls.data ?? []} /> : null}
      {tab === 'halls' ? <Halls halls={halls} /> : null}
    </>
  );
}

function Week({ groups, halls }: { groups: GroupRow[]; halls: Hall[] }) {
  const { can, current } = useSession();
  const [start, setStart] = useState(() => weekStart(cairoToday()));
  const end = addDays(start, 6);
  const sessions = useLoad(() => api<SessionRow[]>('/academics/sessions', { query: { from: start, to: end } }), [start, current?.workspace.id]);
  const [cancel, setCancel] = useState<SessionRow | null>(null);
  const [move, setMove] = useState<SessionRow | null>(null);
  const [extra, setExtra] = useState(false);

  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const byDay = (d: string) =>
    (sessions.data ?? []).filter((s) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date(s.startsAt)) === d);

  return (
    <div className="stack">
      <div className="row-between">
        <div className="row">
          <button className="btn quiet" onClick={() => setStart(addDays(start, -7))}>الأسبوع السابق</button>
          <button className="btn ghost" onClick={() => setStart(weekStart(cairoToday()))}>هذا الأسبوع</button>
          <button className="btn quiet" onClick={() => setStart(addDays(start, 7))}>الأسبوع التالي</button>
        </div>
        {can('academics.write') ? <button className="btn" onClick={() => setExtra(true)}>حصة إضافية</button> : null}
      </div>
      <ErrorNote error={sessions.error} onRetry={sessions.reload} />
      {sessions.loading && !sessions.data ? <Loading what="الجدول" /> : null}
      <div className="split-even">
        {days.map((d) => {
          const list = byDay(d);
          return (
            <section key={d} className="panel">
              <h3>{fmtDay(`${d}T12:00:00Z`)}</h3>
              {!list.length ? <p className="faint">لا حصص.</p> : null}
              <div className="timeline">
                {list.map((s) => (
                  <div key={s.id} className={`slot${s.status === 'CANCELLED' ? ' is-cancelled' : ''}`} style={{ gridTemplateColumns: '64px 1fr auto' }}>
                    <span className="time num" style={{ fontSize: '1rem' }}>{fmtTime(s.startsAt)}</span>
                    <div>
                      <div className="title">{s.group.name}</div>
                      <div className="faint">
                        {s.teacherName}{s.hall ? `، ${s.hall.name}` : ''}
                        {s.cancelReason ? `، السبب: ${s.cancelReason}` : ''}
                      </div>
                    </div>
                    {can('academics.write') && s.status === 'SCHEDULED' ? (
                      <div className="row" style={{ gap: 0 }}>
                        <button className="btn ghost" onClick={() => setMove(s)}>تغيير</button>
                        <button className="btn ghost" onClick={() => setCancel(s)}>إلغاء</button>
                      </div>
                    ) : s.status === 'CANCELLED' ? <Chip tone="bad">ملغاة</Chip> : s.status === 'CLOSED' ? <Chip>انتهت</Chip> : <Chip tone="info">جارية</Chip>}
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <Modal open={Boolean(cancel)} title="إلغاء الحصة" onClose={() => setCancel(null)}>
        {cancel ? <CancelForm session={cancel} onDone={() => { setCancel(null); void sessions.reload(); }} /> : null}
      </Modal>
      <Modal open={Boolean(move)} title="تغيير موعد الحصة" onClose={() => setMove(null)}>
        {move ? <SessionForm halls={halls} session={move} onDone={() => { setMove(null); void sessions.reload(); }} /> : null}
      </Modal>
      <Modal open={extra} title="حصة إضافية" onClose={() => setExtra(false)}>
        {extra ? <SessionForm halls={halls} groups={groups} onDone={() => { setExtra(false); void sessions.reload(); }} /> : null}
      </Modal>
    </div>
  );
}

function CancelForm({ session, onDone }: { session: SessionRow; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const { busy, error, run } = useAction();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api(`/academics/sessions/${session.id}/cancel`, { method: 'POST', body: { reason } });
      onDone();
    });
  };
  return (
    <form className="stack" onSubmit={submit}>
      <p>{session.group.name}، {fmtDateTime(session.startsAt)}</p>
      <Field label="سبب الإلغاء" hint="يصل لأولياء أمور طلاب المجموعة في الإشعار">
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} maxLength={200} />
      </Field>
      {error ? <div className="note error">{error}</div> : null}
      <button className="btn danger" disabled={busy || reason.trim().length < 3}>ألغِ الحصة وأبلغ الأسر</button>
    </form>
  );
}

function SessionForm({ halls, groups, session, onDone }: { halls: Hall[]; groups?: GroupRow[]; session?: SessionRow; onDone: () => void }) {
  const cairo = (iso: string) => {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
    const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    return { date: `${g('year')}-${g('month')}-${g('day')}`, time: `${g('hour')}:${g('minute')}` };
  };
  const initial = session ? cairo(session.startsAt) : { date: cairoToday(), time: '16:00' };
  const [f, setF] = useState({
    groupId: session?.group.id ?? '',
    date: initial.date,
    startTime: initial.time,
    durationMin: session ? Math.round((new Date(session.endsAt).getTime() - new Date(session.startsAt).getTime()) / 60000) : 120,
    hallId: session?.hall?.id ?? '',
  });
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const { busy, error, run } = useAction();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setConflicts([]);
    void run(async () => {
      const body = { date: f.date, startTime: f.startTime, durationMin: Number(f.durationMin), hallId: f.hallId || undefined };
      try {
        if (session) await api(`/academics/sessions/${session.id}`, { method: 'PATCH', body });
        else await api('/academics/sessions', { method: 'POST', body: { ...body, groupId: f.groupId } });
        onDone();
      } catch (err) {
        setConflicts(conflictsOf(err));
        throw err;
      }
    });
  };

  return (
    <form className="stack" onSubmit={submit}>
      {groups ? (
        <Field label="المجموعة">
          <select className="select" value={f.groupId} onChange={(e) => {
            const g = groups.find((x) => x.id === e.target.value);
            setF({ ...f, groupId: e.target.value, hallId: g?.defaultHallId ?? f.hallId });
          }} required>
            <option value="">اختر</option>
            {groups.filter((g) => !g.archived).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </Field>
      ) : null}
      <div className="form-grid">
        <Field label="التاريخ"><input className="input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required /></Field>
        <Field label="الساعة"><input className="input" type="time" value={f.startTime} onChange={(e) => setF({ ...f, startTime: e.target.value })} required /></Field>
        <Field label="المدة بالدقائق"><input className="input" type="number" min={15} max={360} step={15} value={f.durationMin} onChange={(e) => setF({ ...f, durationMin: Number(e.target.value) })} /></Field>
        {halls.length ? (
          <Field label="القاعة">
            <select className="select" value={f.hallId} onChange={(e) => setF({ ...f, hallId: e.target.value })}>
              <option value="">بدون قاعة</option>
              {halls.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </Field>
        ) : null}
      </div>
      <ConflictList conflicts={conflicts} />
      {error && !conflicts.length ? <div className="note error">{error}</div> : null}
      <button className="btn" disabled={busy || (groups && !f.groupId)}>{session ? 'احفظ الموعد الجديد' : 'أضف الحصة'}</button>
    </form>
  );
}

function ConflictList({ conflicts }: { conflicts: Conflict[] }) {
  if (!conflicts.length) return null;
  return (
    <div className="note error stack-sm" role="alert">
      <strong>يتعارض مع حصص قائمة، لم يُحفظ شيء:</strong>
      <ul style={{ margin: 0, paddingInlineStart: '1.2rem' }}>
        {conflicts.map((c, i) => (
          <li key={i}>{fmtDateTime(c.requested)}: {c.reason} ({c.group})</li>
        ))}
      </ul>
    </div>
  );
}

function Groups({ groups, halls }: { groups: ReturnType<typeof useLoad<GroupRow[]>>; halls: Hall[] }) {
  const { can, current } = useSession();
  const [create, setCreate] = useState(false);
  const [planFor, setPlanFor] = useState<GroupRow | null>(null);
  const action = useAction();
  const teachers = useLoad(() => api<TeacherOption[]>('/workspaces/current/teachers'), [current?.workspace.id]);

  const archive = (g: GroupRow) =>
    window.confirm(`أرشفة «${g.name}»؟ لن تظهر في التسجيل الجديد.`) &&
    void action.run(async () => {
      await api(`/academics/groups/${g.id}`, { method: 'PATCH', body: { archived: true } });
      await groups.reload();
    });

  return (
    <div className="stack">
      {can('academics.write') ? (
        <div className="row"><button className="btn" onClick={() => setCreate(true)}>مجموعة جديدة</button></div>
      ) : null}
      <ErrorNote error={groups.error ?? action.error} onRetry={groups.reload} />
      {groups.loading && !groups.data ? <Loading what="المجموعات" /> : null}
      {groups.data && !groups.data.length ? (
        <Empty action={can('academics.write') ? <button className="btn quiet" onClick={() => setCreate(true)}>أنشئ أول مجموعة</button> : undefined}>
          لا توجد مجموعات بعد. أنشئ مجموعة ثم ولّد مواعيدها الأسبوعية.
        </Empty>
      ) : null}
      {groups.data?.length ? (
        <Ledger head={<tr><th>المجموعة</th><th>المدرس</th><th>الطلاب</th><th className="amount">الاشتراك الشهري</th><th /></tr>}>
          {groups.data.map((g) => (
            <tr key={g.id} className={g.archived ? 'is-void' : undefined}>
              <td>{g.name}<div className="faint">{g.subject}، {g.grade}</div></td>
              <td>{g.teacherName}</td>
              <td>
                <span className="num">{num(g.activeStudents)} / {num(g.capacity)}</span>
                {g.waitlist ? <> <Chip tone="info">انتظار {num(g.waitlist)}</Chip></> : null}
                <div className="fill"><i style={{ width: `${Math.min(100, (g.activeStudents / g.capacity) * 100)}%` }} /></div>
              </td>
              <td className="amount num">{egp(g.monthlyFee)}</td>
              <td>
                {can('academics.write') && !g.archived ? (
                  <div className="row" style={{ gap: '0.25rem' }}>
                    <button className="btn quiet" onClick={() => setPlanFor(g)}>ولّد المواعيد</button>
                    <button className="btn ghost" onClick={() => archive(g)} disabled={action.busy}>أرشفة</button>
                  </div>
                ) : null}
              </td>
            </tr>
          ))}
        </Ledger>
      ) : null}

      <Modal open={create} title="مجموعة جديدة" onClose={() => setCreate(false)}>
        {create ? (
          <GroupForm
            halls={halls}
            teachers={teachers.data ?? []}
            onDone={(g) => { setCreate(false); void groups.reload(); setPlanFor(g); }}
          />
        ) : null}
      </Modal>
      <Modal open={Boolean(planFor)} title={`مواعيد ${planFor?.name ?? ''}`} onClose={() => setPlanFor(null)}>
        {planFor ? <PlanForm group={planFor} halls={halls} onDone={() => setPlanFor(null)} /> : null}
      </Modal>
    </div>
  );
}

function GroupForm({ halls, teachers, onDone }: { halls: Hall[]; teachers: TeacherOption[]; onDone: (g: GroupRow) => void }) {
  const [f, setF] = useState({ name: '', subject: '', grade: '', system: 'GENERAL', capacity: 30, monthlyFee: 250, teacherMembershipId: '', defaultHallId: '' });
  const { busy, error, run } = useAction();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const g = await api<GroupRow>('/academics/groups', {
        method: 'POST',
        body: { ...f, capacity: Number(f.capacity), monthlyFee: Number(f.monthlyFee), teacherMembershipId: f.teacherMembershipId || undefined, defaultHallId: f.defaultHallId || undefined },
      });
      onDone({ ...g, activeStudents: 0, waitlist: 0, teacherName: '' } as GroupRow);
    });
  };
  return (
    <form className="stack" onSubmit={submit}>
      <div className="form-grid">
        <Field label="اسم المجموعة" hint="مثال: فيزياء 3ث، السبت والثلاثاء">
          <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required minLength={2} maxLength={80} />
        </Field>
        <Field label="المادة"><input className="input" value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} required /></Field>
        <Field label="الصف"><input className="input" value={f.grade} onChange={(e) => setF({ ...f, grade: e.target.value })} required placeholder="3 ثانوي" /></Field>
        <Field label="النظام">
          <select className="select" value={f.system} onChange={(e) => setF({ ...f, system: e.target.value })}>
            <option value="GENERAL">عام</option>
            <option value="AZHAR">أزهري</option>
            <option value="LANGUAGES">لغات</option>
            <option value="BACCALAUREATE">بكالوريا</option>
            <option value="INTERNATIONAL">دولي</option>
          </select>
        </Field>
        <Field label="السعة"><input className="input" type="number" min={1} max={1000} value={f.capacity} onChange={(e) => setF({ ...f, capacity: Number(e.target.value) })} /></Field>
        <Field label="الاشتراك الشهري (ج.م)"><input className="input" type="number" min={0} step="0.5" value={f.monthlyFee} onChange={(e) => setF({ ...f, monthlyFee: Number(e.target.value) })} /></Field>
        {teachers.length > 1 ? (
          <Field label="المدرس">
            <select className="select" value={f.teacherMembershipId} onChange={(e) => setF({ ...f, teacherMembershipId: e.target.value })} required>
              <option value="">اختر المدرس</option>
              {teachers.map((t) => <option key={t.membershipId} value={t.membershipId}>{t.name}</option>)}
            </select>
          </Field>
        ) : null}
        {halls.length ? (
          <Field label="القاعة المعتادة">
            <select className="select" value={f.defaultHallId} onChange={(e) => setF({ ...f, defaultHallId: e.target.value })}>
              <option value="">بدون</option>
              {halls.map((h) => <option key={h.id} value={h.id}>{h.name} ({num(h.capacity)})</option>)}
            </select>
          </Field>
        ) : null}
      </div>
      {error ? <div className="note error">{error}</div> : null}
      <button className="btn" disabled={busy}>أنشئ المجموعة</button>
    </form>
  );
}

function PlanForm({ group, halls, onDone }: { group: GroupRow; halls: Hall[]; onDone: () => void }) {
  const [f, setF] = useState({ startDate: cairoToday(), weeks: 8, weekdays: [] as number[], startTime: '16:00', durationMin: 120, hallId: group.defaultHallId ?? '' });
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [done, setDone] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  const toggle = (d: number) => setF({ ...f, weekdays: f.weekdays.includes(d) ? f.weekdays.filter((x) => x !== d) : [...f.weekdays, d] });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setConflicts([]);
    void run(async () => {
      try {
        const r = await api<{ created: number }>(`/academics/groups/${group.id}/schedule`, {
          method: 'POST',
          body: { ...f, weeks: Number(f.weeks), durationMin: Number(f.durationMin), hallId: f.hallId || undefined },
        });
        setDone(`أُضيفت ${num(r.created)} حصة إلى الجدول.`);
      } catch (err) {
        setConflicts(conflictsOf(err));
        throw err;
      }
    });
  };

  if (done) {
    return (
      <div className="stack">
        <div className="note info">{done}</div>
        <button className="btn" onClick={onDone}>تم</button>
      </div>
    );
  }

  return (
    <form className="stack" onSubmit={submit}>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="field"><span>أيام الحصة</span></legend>
        <div className="checks" style={{ marginTop: '0.4rem' }}>
          {[6, 0, 1, 2, 3, 4, 5].map((d) => (
            <label key={d}><input type="checkbox" checked={f.weekdays.includes(d)} onChange={() => toggle(d)} />{WEEKDAYS[d]}</label>
          ))}
        </div>
      </fieldset>
      <div className="form-grid">
        <Field label="من تاريخ"><input className="input" type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
        <Field label="عدد الأسابيع"><input className="input" type="number" min={1} max={26} value={f.weeks} onChange={(e) => setF({ ...f, weeks: Number(e.target.value) })} /></Field>
        <Field label="الساعة"><input className="input" type="time" value={f.startTime} onChange={(e) => setF({ ...f, startTime: e.target.value })} /></Field>
        <Field label="المدة بالدقائق"><input className="input" type="number" min={15} max={360} step={15} value={f.durationMin} onChange={(e) => setF({ ...f, durationMin: Number(e.target.value) })} /></Field>
        {halls.length ? (
          <Field label="القاعة">
            <select className="select" value={f.hallId} onChange={(e) => setF({ ...f, hallId: e.target.value })}>
              <option value="">بدون قاعة</option>
              {halls.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </Field>
        ) : null}
      </div>
      <ConflictList conflicts={conflicts} />
      {error && !conflicts.length ? <div className="note error">{error}</div> : null}
      <button className="btn" disabled={busy || !f.weekdays.length}>ولّد المواعيد</button>
    </form>
  );
}

function Halls({ halls }: { halls: ReturnType<typeof useLoad<Hall[]>> }) {
  const { can } = useSession();
  const [month, setMonth] = useState(cairoMonth());
  const occupancy = useLoad(
    () => api<{ hallId: string; name: string; hours: number; occupancyPct: number }[]>('/academics/halls/occupancy', { query: { month } }),
    [month],
  );
  const [f, setF] = useState({ name: '', capacity: 40 });
  const action = useAction();

  const add = (e: FormEvent) => {
    e.preventDefault();
    void action.run(async () => {
      await api('/academics/halls', { method: 'POST', body: { name: f.name, capacity: Number(f.capacity) } });
      setF({ name: '', capacity: 40 });
      await Promise.all([halls.reload(), occupancy.reload()]);
    });
  };
  const remove = (h: Hall) =>
    window.confirm(`حذف ${h.name}؟`) &&
    void action.run(async () => {
      await api(`/academics/halls/${h.id}`, { method: 'DELETE' });
      await Promise.all([halls.reload(), occupancy.reload()]);
    });

  return (
    <div className="split">
      <section className="stack">
        <div className="row-between">
          <h2>نسبة الإشغال</h2>
          <div style={{ width: 200 }}><MonthInput value={month} onChange={setMonth} /></div>
        </div>
        <ErrorNote error={halls.error ?? occupancy.error ?? action.error} />
        {halls.data && !halls.data.length ? <Empty>لا توجد قاعات مسجلة.</Empty> : null}
        {occupancy.data?.length ? (
          <Ledger head={<tr><th>القاعة</th><th>السعة</th><th>ساعات مستخدمة</th><th>الإشغال</th><th /></tr>}>
            {occupancy.data.map((o) => {
              const h = halls.data?.find((x) => x.id === o.hallId);
              return (
                <tr key={o.hallId}>
                  <td>{o.name}</td>
                  <td className="num">{num(h?.capacity)}</td>
                  <td className="num">{num(o.hours)}</td>
                  <td>
                    <span className="num">{num(o.occupancyPct)}%</span>
                    <div className="fill"><i style={{ width: `${Math.min(100, o.occupancyPct)}%` }} /></div>
                  </td>
                  <td>{can('academics.write') && h ? <button className="btn ghost" onClick={() => remove(h)}>حذف</button> : null}</td>
                </tr>
              );
            })}
          </Ledger>
        ) : null}
        <p className="faint">الإشغال محسوب على 12 ساعة تشغيل يوميًا.</p>
      </section>
      {can('academics.write') ? (
        <form className="panel stack" onSubmit={add}>
          <h3>قاعة جديدة</h3>
          <Field label="الاسم"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
          <Field label="السعة"><input className="input" type="number" min={1} value={f.capacity} onChange={(e) => setF({ ...f, capacity: Number(e.target.value) })} /></Field>
          <button className="btn" disabled={action.busy || !f.name.trim()}>أضف القاعة</button>
        </form>
      ) : null}
    </div>
  );
}
