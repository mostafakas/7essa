'use client';

import { useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { AUDIENCE_LABEL, dateInput, LEVEL_LABEL, type Announcement } from '@/lib/platform';
import { useAction, useLoad } from '@/lib/use-load';
import { IfCan } from '@/components/platform-shell';
import { Chip, Empty, ErrorNote, Field, Ledger, Loading, Modal, PageHead } from '@/components/ui';

type Draft = { id?: string; title: string; body: string; audience: Announcement['audience']; level: Announcement['level']; endsAt: string; active: boolean; notify: boolean };
const EMPTY: Draft = { title: '', body: '', audience: 'ALL', level: 'INFO', endsAt: '', active: true, notify: false };

const isLive = (a: Announcement) => a.active && new Date(a.startsAt) <= new Date() && (!a.endsAt || new Date(a.endsAt) > new Date());

export default function AnnouncementsPage() {
  const list = useLoad(() => api<Announcement[]>('/platform/announcements', { workspace: false }), []);
  const [edit, setEdit] = useState<Draft | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const action = useAction();

  const toggle = (a: Announcement) =>
    void action.run(async () => {
      await api(`/platform/announcements/${a.id}`, { method: 'PATCH', workspace: false, body: { active: !a.active } });
      await list.reload();
    });
  const remove = (a: Announcement) =>
    window.confirm(`حذف الإعلان «${a.title}»؟`) &&
    void action.run(async () => {
      await api(`/platform/announcements/${a.id}`, { method: 'DELETE', workspace: false });
      await list.reload();
    });

  return (
    <>
      <PageHead title="الإعلانات" sub="تظهر كشريط أعلى التطبيق للشريحة المختارة. «هام جدًا» لا يمكن إخفاؤه.">
        <IfCan perm="platform.content.manage"><button className="btn" onClick={() => setEdit({ ...EMPTY })}>إعلان جديد</button></IfCan>
      </PageHead>
      {notice ? <div className="note info" style={{ marginBottom: '1rem' }}>{notice}</div> : null}
      <ErrorNote error={list.error ?? action.error} onRetry={list.reload} />
      {list.loading && !list.data ? <Loading what="الإعلانات" /> : null}
      {list.data && !list.data.length ? <Empty>لا توجد إعلانات.</Empty> : null}
      {list.data?.length ? (
        <Ledger head={<tr><th>الإعلان</th><th>الشريحة</th><th>المستوى</th><th>الحالة</th><th>ينتهي</th><th /></tr>}>
          {list.data.map((a) => (
            <tr key={a.id} className={!a.active ? 'is-void' : undefined}>
              <td><strong>{a.title}</strong><div className="faint" style={{ maxWidth: 420 }}>{a.body}</div></td>
              <td>{AUDIENCE_LABEL[a.audience]}</td>
              <td><Chip tone={a.level === 'CRITICAL' ? 'bad' : a.level === 'WARNING' ? 'warn' : 'info'}>{LEVEL_LABEL[a.level]}</Chip></td>
              <td>{isLive(a) ? <Chip tone="ok">يظهر الآن</Chip> : a.active ? <Chip>مجدول/منتهٍ</Chip> : <Chip>متوقف</Chip>}</td>
              <td className="faint">{a.endsAt ? fmtDateTime(a.endsAt) : 'بلا نهاية'}</td>
              <td>
                <IfCan perm="platform.content.manage">
                  <span className="row" style={{ gap: '0.25rem' }}>
                    <button className="btn ghost" onClick={() => setEdit({ id: a.id, title: a.title, body: a.body, audience: a.audience, level: a.level, endsAt: dateInput(a.endsAt), active: a.active, notify: false })}>تعديل</button>
                    <button className="btn ghost" onClick={() => toggle(a)} disabled={action.busy}>{a.active ? 'إيقاف' : 'تفعيل'}</button>
                    <button className="btn ghost" onClick={() => remove(a)} disabled={action.busy}>حذف</button>
                  </span>
                </IfCan>
              </td>
            </tr>
          ))}
        </Ledger>
      ) : null}
      <Modal open={Boolean(edit)} title={edit?.id ? 'تعديل إعلان' : 'إعلان جديد'} onClose={() => setEdit(null)}>
        {edit ? (
          <AnnouncementForm
            draft={edit}
            onDone={(n) => {
              setEdit(null);
              setNotice(n !== null ? `نُشر الإعلان وأُرسل كإشعار إلى ${n} مستخدم.` : 'تم الحفظ.');
              void list.reload();
            }}
          />
        ) : null}
      </Modal>
    </>
  );
}

function AnnouncementForm({ draft, onDone }: { draft: Draft; onDone: (notified: number | null) => void }) {
  const [f, setF] = useState(draft);
  const { busy, error, run } = useAction();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const body = {
        title: f.title.trim(), body: f.body.trim(), audience: f.audience, level: f.level, active: f.active,
        endsAt: f.endsAt ? new Date(`${f.endsAt}T21:59:59Z`).toISOString() : null,
      };
      if (f.id) {
        await api(`/platform/announcements/${f.id}`, { method: 'PATCH', workspace: false, body });
        onDone(null);
      } else {
        const r = await api<{ notified: number }>('/platform/announcements', { method: 'POST', workspace: false, body: { ...body, notify: f.notify } });
        onDone(f.notify ? r.notified : null);
      }
    });
  };
  return (
    <form className="stack" onSubmit={submit}>
      <Field label="العنوان"><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required minLength={2} maxLength={120} /></Field>
      <Field label="النص"><textarea className="textarea" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} required minLength={2} maxLength={2000} /></Field>
      <div className="form-grid">
        <Field label="الشريحة">
          <select className="select" value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value as Draft['audience'] })}>
            {Object.entries(AUDIENCE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="المستوى">
          <select className="select" value={f.level} onChange={(e) => setF({ ...f, level: e.target.value as Draft['level'] })}>
            {Object.entries(LEVEL_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="ينتهي في (اختياري)"><input className="input" type="date" value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} /></Field>
      </div>
      <label className="row" style={{ gap: '0.4rem' }}><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />مفعّل</label>
      {!f.id ? <label className="row" style={{ gap: '0.4rem' }}><input type="checkbox" checked={f.notify} onChange={(e) => setF({ ...f, notify: e.target.checked })} />أرسله أيضًا كإشعار داخل التطبيق لكل الشريحة</label> : null}
      {error ? <div className="note error">{error}</div> : null}
      <button className="btn" disabled={busy}>{f.id ? 'احفظ' : 'انشر'}</button>
    </form>
  );
}
