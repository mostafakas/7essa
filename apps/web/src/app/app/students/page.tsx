'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { egpP, localPhone, num } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { GroupRow, StudentListItem } from '@/lib/types';
import { useAction, useLoad } from '@/lib/use-load';
import { Guard } from '@/components/app-shell';
import { Chip, Empty, ErrorNote, Field, Ledger, Loading, Modal, PageHead } from '@/components/ui';

const STATUS_LABEL: Record<StudentListItem['status'], string> = {
  ACTIVE: 'نشط',
  WAITLIST: 'قائمة انتظار',
  SUSPENDED: 'موقوف',
  LEFT: 'انسحب',
};

interface RegisterResult {
  studentId: string;
  enrollmentId: string;
  code: string;
  status: string;
  matchedExisting: boolean;
  siblingsInWorkspace: number;
}

export default function StudentsPage() {
  return (
    <Guard perm="students.read">
      <Students />
    </Guard>
  );
}

function Students() {
  const { can, current } = useSession();
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [groupId, setGroupId] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('new') === '1' && can('students.write')) setOpen(true);
  }, [can]);

  // بحث بعد توقف الكتابة لحظة
  useEffect(() => {
    const t = setTimeout(() => {
      setTerm(q.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const groups = useLoad(() => api<GroupRow[]>('/academics/groups'), [current?.workspace.id]);
  const list = useLoad(
    () => api<{ total: number; page: number; items: StudentListItem[] }>('/students', { query: { q: term, groupId, status, page } }),
    [term, groupId, status, page, current?.workspace.id],
  );

  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / 50)) : 1;

  return (
    <>
      <PageHead title="الطلاب" sub={list.data ? `${num(list.data.total)} اشتراك مطابق` : undefined}>
        {can('students.write') ? <button className="btn" onClick={() => setOpen(true)}>سجّل طالبًا</button> : null}
      </PageHead>

      <div className="form-grid" style={{ marginBottom: '1rem' }}>
        <Field label="بحث بالاسم أو الكود">
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="مثال: مريم أو 482913" />
        </Field>
        <Field label="المجموعة">
          <select className="select" value={groupId} onChange={(e) => { setGroupId(e.target.value); setPage(1); }}>
            <option value="">كل المجموعات</option>
            {groups.data?.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </Field>
        <Field label="حالة الاشتراك">
          <select className="select" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">الكل</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
      </div>

      <ErrorNote error={list.error} onRetry={list.reload} />
      {list.loading && !list.data ? <Loading what="الطلاب" /> : null}
      {list.data && !list.data.items.length ? (
        <Empty action={can('students.write') ? <button className="btn quiet" onClick={() => setOpen(true)}>سجّل أول طالب</button> : undefined}>
          {term || groupId || status ? 'لا توجد نتائج مطابقة للبحث.' : 'لم يُسجل أي طالب بعد.'}
        </Empty>
      ) : null}

      {list.data?.items.length ? (
        <Ledger
          head={
            <tr>
              <th>الطالب</th>
              <th>الكود</th>
              <th>المجموعة</th>
              <th>ولي الأمر</th>
              <th>الحالة</th>
              <th>هذا الشهر</th>
            </tr>
          }
        >
          {list.data.items.map((s) => (
            <tr key={s.enrollmentId}>
              <td>
                <Link href={`/app/students/${s.studentId}`}>{s.fullName}</Link>
                <div className="faint">{s.grade}{s.school ? `، ${s.school}` : ''}</div>
              </td>
              <td className="num">{s.code}</td>
              <td>{s.group.name}</td>
              <td>
                {s.guardianName}
                <div className="faint num">{localPhone(s.guardianPhone)}</div>
              </td>
              <td>
                <span className="row" style={{ gap: '0.3rem' }}>
                  <Chip tone={s.status === 'ACTIVE' ? 'ok' : s.status === 'WAITLIST' ? 'info' : 'bad'}>{STATUS_LABEL[s.status]}</Chip>
                  {!s.consent ? <Chip tone="warn">بانتظار موافقة ولي الأمر</Chip> : null}
                  {s.discountPct ? <Chip>خصم {num(s.discountPct)}%</Chip> : null}
                </span>
              </td>
              <td>
                {s.due?.state === 'OK' ? <Chip tone="ok">مسدد</Chip> : null}
                {s.due?.state === 'DUES' ? <Chip tone="warn">{s.due.remaining !== undefined ? egpP(s.due.remaining) : 'متأخر'}</Chip> : null}
                {s.due?.state === 'SUSPENDED' ? <Chip tone="bad">موقوف</Chip> : null}
              </td>
            </tr>
          ))}
        </Ledger>
      ) : null}

      {pages > 1 ? (
        <div className="row" style={{ marginTop: '1rem' }}>
          <button className="btn quiet" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>السابق</button>
          <span className="num">{num(page)} / {num(pages)}</span>
          <button className="btn quiet" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>التالي</button>
        </div>
      ) : null}

      <Modal open={open} title="تسجيل طالب" onClose={() => setOpen(false)}>
        <RegisterForm groups={groups.data ?? []} onDone={() => void list.reload()} />
      </Modal>
    </>
  );
}

function RegisterForm({ groups, onDone }: { groups: GroupRow[]; onDone: () => void }) {
  const { can, current } = useSession();
  const empty = { fullName: '', grade: '', school: '', guardianName: '', guardianPhone: '', groupId: '', discountPct: '0' };
  const [f, setF] = useState(empty);
  const [result, setResult] = useState<RegisterResult | null>(null);
  const { busy, error, run } = useAction();
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const active = groups.filter((g) => !g.archived);
  const group = active.find((g) => g.id === f.groupId);
  const isManager = current?.me.role === 'OWNER' || current?.me.role === 'MANAGER';
  const maxDiscount = isManager ? 100 : (current?.workspace.receptionMaxDiscountPct ?? 0);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const r = await api<RegisterResult>('/students', {
        method: 'POST',
        body: {
          fullName: f.fullName,
          grade: f.grade,
          school: f.school || undefined,
          guardianName: f.guardianName,
          guardianPhone: f.guardianPhone,
          groupId: f.groupId,
          discountPct: Number(f.discountPct) || 0,
        },
      });
      setResult(r);
      setF({ ...empty, groupId: f.groupId, grade: f.grade });
      onDone();
    });
  };

  return (
    <div className="stack">
      {result ? (
        <div className="note info stack-sm" role="status">
          <strong>تم التسجيل بالكود <span className="num">{result.code}</span></strong>
          {result.status === 'WAITLIST' ? <span>المجموعة مكتملة، فأُضيف الطالب لقائمة الانتظار.</span> : null}
          {result.matchedExisting ? <span>الطالب مسجل من قبل بنفس بيانات ولي الأمر، فرُبط بنفس الهوية بدل تكرارها.</span> : null}
          {result.siblingsInWorkspace ? <span>لديه {num(result.siblingsInWorkspace)} أخ/أخت مسجلون هنا، يمكنك مراجعة خصم الإخوة.</span> : null}
          <span>أُرسل طلب موافقة لولي الأمر على رقمه.</span>
          <div className="row">
            <Link className="btn quiet" href={`/app/students/${result.studentId}`}>ملف الطالب</Link>
            <Link className="btn quiet" href={`/print/card/${result.studentId}`} target="_blank">اطبع الكارنيه</Link>
          </div>
        </div>
      ) : null}

      <form className="stack" onSubmit={submit}>
        <div className="form-grid">
          <Field label="اسم الطالب رباعيًا">
            <input className="input" value={f.fullName} onChange={set('fullName')} required minLength={3} maxLength={80} autoFocus />
          </Field>
          <Field label="المجموعة">
            <select className="select" value={f.groupId} onChange={(e) => {
              const g = active.find((x) => x.id === e.target.value);
              setF((x) => ({ ...x, groupId: e.target.value, grade: g?.grade ?? x.grade }));
            }} required>
              <option value="">اختر المجموعة</option>
              {active.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} ({num(g.activeStudents)}/{num(g.capacity)})
                </option>
              ))}
            </select>
          </Field>
          <Field label="الصف">
            <input className="input" value={f.grade} onChange={set('grade')} required maxLength={40} />
          </Field>
          <Field label="المدرسة (اختياري)">
            <input className="input" value={f.school} onChange={set('school')} maxLength={80} />
          </Field>
          <Field label="اسم ولي الأمر">
            <input className="input" value={f.guardianName} onChange={set('guardianName')} required minLength={2} maxLength={80} />
          </Field>
          <Field label="موبايل ولي الأمر" hint="يستخدمه ولي الأمر للدخول ومتابعة ابنه">
            <input className="input" dir="ltr" inputMode="tel" value={f.guardianPhone} onChange={set('guardianPhone')} required placeholder="01xxxxxxxxx" />
          </Field>
          {can('finance.discount') ? (
            <Field label="نسبة الخصم %" hint={isManager ? undefined : `الحد المسموح لك ${num(maxDiscount)}%`}>
              <input className="input" type="number" min={0} max={maxDiscount} value={f.discountPct} onChange={set('discountPct')} />
            </Field>
          ) : null}
        </div>
        {group && group.activeStudents >= group.capacity ? (
          <div className="note warn">هذه المجموعة مكتملة، سيُضاف الطالب لقائمة الانتظار.</div>
        ) : null}
        {error ? <div className="note error" role="alert">{error}</div> : null}
        <div className="row">
          <button className="btn big" disabled={busy}>{busy ? 'جارٍ التسجيل…' : 'سجّل الطالب'}</button>
        </div>
      </form>
    </div>
  );
}
