'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api';
import { ATTENDANCE_LABEL, egp, egpP, fmtDate, fmtDateTime, localPhone, METHOD_LABEL, num } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { DueView, GroupRow } from '@/lib/types';
import { useAction, useLoad } from '@/lib/use-load';
import { Guard } from '@/components/app-shell';
import { CredentialsCard, type Credentials } from '@/components/credentials';
import { Chip, ErrorNote, Field, Ledger, Loading, Modal, PageHead, Tabs } from '@/components/ui';

interface Profile {
  student: {
    id: string;
    fullName: string;
    grade: string;
    school: string | null;
    cardVersion: number;
    guardianName: string;
    guardianPhone: string;
    sharedIdentity: boolean;
  };
  enrollments: {
    id: string;
    code: string;
    status: 'ACTIVE' | 'WAITLIST' | 'SUSPENDED' | 'LEFT';
    discountPct: number;
    consent: boolean;
    group: { id: string; name: string; subject: string; teacherName: string };
    due?: DueView;
  }[];
  attendanceSummary: { PRESENT: number; LATE: number; ABSENT: number };
  attendance: { id: string; status: 'PRESENT' | 'LATE' | 'ABSENT'; method: string; at: string; sessionStartsAt: string; group: string }[];
  results: { id: string; exam: string; score: number | null; maxScore: number | null; late: boolean; submittedAt: string }[];
  receipts: { id: string; number: number; amount: string; discountAmount: string; method: string; forMonth: string; status: string; createdAt: string; enrollmentId: string }[];
}

type Tab = 'attendance' | 'results' | 'receipts';
type EnrollmentEdit = { id: string; mode: 'transfer' | 'discount'; groupId: string; discountPct: number };

const STATUS_LABEL = { ACTIVE: 'نشط', WAITLIST: 'قائمة انتظار', SUSPENDED: 'موقوف', LEFT: 'انسحب' } as const;

export default function StudentProfilePage() {
  return (
    <Guard perm="students.read">
      <StudentProfile />
    </Guard>
  );
}

function StudentProfile() {
  const { id } = useParams<{ id: string }>();
  const { can, current } = useSession();
  const profile = useLoad(() => api<Profile>(`/students/${id}`), [id]);
  const groups = useLoad(() => (can('students.write') ? api<GroupRow[]>('/academics/groups') : Promise.resolve([])), [id]);
  const action = useAction();
  const [tab, setTab] = useState<Tab>('attendance');
  const [edit, setEdit] = useState<EnrollmentEdit | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const p = profile.data;
  const s = p?.student;
  const isManager = current?.me.role === 'OWNER' || current?.me.role === 'MANAGER';

  const setStatus = (enrollmentId: string, status: 'ACTIVE' | 'SUSPENDED' | 'LEFT') =>
    void action.run(async () => {
      await api(`/students/enrollments/${enrollmentId}`, { method: 'PATCH', body: { status } });
      await profile.reload();
    });

  const saveEdit = () =>
    edit &&
    void action.run(async () => {
      if (edit.mode === 'transfer') {
        await api(`/students/enrollments/${edit.id}/transfer`, { method: 'POST', body: { groupId: edit.groupId } });
      } else {
        await api(`/students/enrollments/${edit.id}`, { method: 'PATCH', body: { discountPct: edit.discountPct } });
      }
      setEdit(null);
      await profile.reload();
    });

  const reissue = () => {
    if (!window.confirm('سيتوقف الكارنيه الحالي عن العمل في كل الأماكن المسجل بها الطالب. متابعة؟')) return;
    void action.run(async () => {
      const r = await api<{ cardVersion: number }>(`/students/${id}/card/reissue`, { method: 'POST' });
      setNotice(`صدر كارنيه جديد (إصدار ${num(r.cardVersion)}). اطبعه وسلّمه للطالب.`);
      await profile.reload();
    });
  };

  return (
    <>
      <PageHead
        title={s?.fullName ?? 'ملف الطالب'}
        sub={s ? `${s.grade}${s.school ? `، ${s.school}` : ''}` : undefined}
      >
        {s ? <Link className="btn quiet" href={`/print/card/${s.id}`} target="_blank">اطبع الكارنيه</Link> : null}
        {s && can('students.write') ? <button className="btn ghost" onClick={reissue} disabled={action.busy}>كارنيه بدل فاقد</button> : null}
      </PageHead>

      <ErrorNote error={profile.error ?? action.error} onRetry={profile.reload} />
      {notice ? <div className="note info" role="status">{notice}</div> : null}
      {profile.loading && !p ? <Loading what="ملف الطالب" /> : null}

      {p && s ? (
        <div className="stack">
          <div className="split">
            <section className="panel stack-sm">
              <h2>الاشتراكات</h2>
              <Ledger
                head={
                  <tr>
                    <th>المجموعة</th>
                    <th>الكود</th>
                    <th>الحالة</th>
                    <th>هذا الشهر</th>
                    <th />
                  </tr>
                }
              >
                {p.enrollments.map((e) => (
                  <tr key={e.id}>
                    <td>
                      {e.group.name}
                      <div className="faint">{e.group.teacherName}</div>
                    </td>
                    <td className="num">{e.code}</td>
                    <td>
                      <span className="row" style={{ gap: '0.3rem' }}>
                        <Chip tone={e.status === 'ACTIVE' ? 'ok' : e.status === 'WAITLIST' ? 'info' : 'bad'}>{STATUS_LABEL[e.status]}</Chip>
                        {e.discountPct ? <Chip>خصم {num(e.discountPct)}%</Chip> : null}
                        {!e.consent ? <Chip tone="warn">بدون موافقة ولي الأمر</Chip> : null}
                      </span>
                    </td>
                    <td>
                      {e.due?.state === 'OK' ? <Chip tone="ok">مسدد</Chip> : null}
                      {e.due?.state === 'DUES' ? <Chip tone="warn">{e.due.remaining !== undefined ? `متبقي ${egpP(e.due.remaining)}` : 'متأخر'}</Chip> : null}
                      {e.due?.state === 'SUSPENDED' ? <Chip tone="bad">موقوف</Chip> : null}
                    </td>
                    <td>
                      <div className="row" style={{ gap: '0.25rem' }}>
                        {can('finance.collect') && e.status !== 'LEFT' && e.status !== 'WAITLIST' ? (
                          <Link className="btn quiet" href={`/app/cash?student=${s.id}&enrollment=${e.id}`}>استلم مبلغ</Link>
                        ) : null}
                        {can('students.write') ? (
                          <>
                            {e.status !== 'ACTIVE' ? (
                              <button className="btn ghost" disabled={action.busy} onClick={() => setStatus(e.id, 'ACTIVE')}>تفعيل</button>
                            ) : (
                              <button className="btn ghost" disabled={action.busy} onClick={() => setStatus(e.id, 'SUSPENDED')}>إيقاف</button>
                            )}
                            {e.status !== 'LEFT' ? (
                              <button className="btn ghost" disabled={action.busy} onClick={() => window.confirm('تسجيل انسحاب الطالب من المجموعة؟') && setStatus(e.id, 'LEFT')}>انسحاب</button>
                            ) : null}
                            <button className="btn ghost" onClick={() => setEdit({ id: e.id, mode: 'transfer', groupId: '', discountPct: e.discountPct })}>نقل</button>
                            {can('finance.discount') ? (
                              <button className="btn ghost" onClick={() => setEdit({ id: e.id, mode: 'discount', groupId: '', discountPct: e.discountPct })}>الخصم</button>
                            ) : null}
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </Ledger>
            </section>

            <aside className="panel stack-sm">
              <h3>ولي الأمر</h3>
              <p>{s.guardianName}</p>
              <p className="num">{localPhone(s.guardianPhone)}</p>
              {s.guardianPhone.startsWith('+20') ? (
                <div className="row">
                  <a className="btn quiet" href={`tel:${s.guardianPhone}`}>اتصال</a>
                  <a className="btn quiet" href={`https://wa.me/${s.guardianPhone.slice(1)}`} target="_blank" rel="noopener noreferrer">واتساب</a>
                </div>
              ) : null}
              {s.sharedIdentity ? (
                <p className="note info">هذا الطالب مسجل أيضًا في مكان آخر على حصّة بنفس الهوية؛ ولي الأمر يتابعه من حساب واحد.</p>
              ) : null}
              <h3 style={{ marginTop: '0.75rem' }}>الحضور آخر 60 يومًا</h3>
              <div className="row">
                <Chip tone="ok">حاضر {num(p.attendanceSummary.PRESENT)}</Chip>
                <Chip tone="warn">متأخر {num(p.attendanceSummary.LATE)}</Chip>
                <Chip tone="bad">غائب {num(p.attendanceSummary.ABSENT)}</Chip>
              </div>
            </aside>
          </div>

          <section className="panel">
            <Tabs<Tab>
              value={tab}
              onChange={setTab}
              items={[
                { id: 'attendance', label: 'سجل الحضور' },
                { id: 'results', label: 'نتائج الامتحانات' },
                { id: 'receipts', label: 'الإيصالات', hidden: !p.receipts.length && !can('finance.collect') },
              ]}
            />
            {tab === 'attendance' ? (
              p.attendance.length ? (
                <Ledger head={<tr><th>الحصة</th><th>المجموعة</th><th>الحالة</th><th>وقت التسجيل</th></tr>}>
                  {p.attendance.map((a) => (
                    <tr key={a.id}>
                      <td>{fmtDateTime(a.sessionStartsAt)}</td>
                      <td>{a.group}</td>
                      <td><Chip tone={a.status === 'PRESENT' ? 'ok' : a.status === 'LATE' ? 'warn' : 'bad'}>{ATTENDANCE_LABEL[a.status]}</Chip></td>
                      <td className="faint">{a.status === 'ABSENT' ? '—' : fmtDateTime(a.at)}</td>
                    </tr>
                  ))}
                </Ledger>
              ) : <p className="faint">لا يوجد حضور مسجل في آخر 60 يومًا.</p>
            ) : null}
            {tab === 'results' ? (
              p.results.length ? (
                <Ledger head={<tr><th>الامتحان</th><th>الدرجة</th><th>التسليم</th></tr>}>
                  {p.results.map((r) => (
                    <tr key={r.id}>
                      <td>{r.exam}</td>
                      <td className="num">{r.score ?? '—'} / {r.maxScore ?? '—'}</td>
                      <td>{fmtDateTime(r.submittedAt)} {r.late ? <Chip tone="warn">متأخر</Chip> : null}</td>
                    </tr>
                  ))}
                </Ledger>
              ) : <p className="faint">لا توجد نتائج بعد.</p>
            ) : null}
            {tab === 'receipts' ? (
              p.receipts.length ? (
                <Ledger head={<tr><th>رقم</th><th>عن شهر</th><th className="amount">المبلغ</th><th>الطريقة</th><th>التاريخ</th><th /></tr>}>
                  {p.receipts.map((r) => (
                    <tr key={r.id} className={r.status === 'CANCELLED' ? 'is-void' : undefined}>
                      <td className="num">{r.number}</td>
                      <td className="num">{r.forMonth}</td>
                      <td className="amount num">{egp(r.amount)}{Number(r.discountAmount) ? <div className="faint">خصم {egp(r.discountAmount)}</div> : null}</td>
                      <td>{METHOD_LABEL[r.method] ?? r.method}</td>
                      <td>{fmtDate(r.createdAt)}</td>
                      <td>
                        {r.status === 'CANCEL_REQUESTED' ? <Chip tone="warn">طلب إلغاء</Chip> : null}
                        {r.status === 'VALID' && can('finance.collect') ? <Link href={`/print/receipt/${r.id}`} target="_blank">اطبع</Link> : null}
                      </td>
                    </tr>
                  ))}
                </Ledger>
              ) : <p className="faint">لا توجد إيصالات.</p>
            ) : null}
          </section>
          {can('students.write') ? <AccountsPanel studentId={s.id} studentName={s.fullName} guardianName={s.guardianName} /> : null}
        </div>
      ) : null}

      <Modal open={Boolean(edit)} title={edit?.mode === 'transfer' ? 'نقل لمجموعة أخرى' : 'تعديل الخصم'} onClose={() => setEdit(null)}>
        {edit ? (
          <div className="stack">
            {edit.mode === 'transfer' ? (
              <Field label="المجموعة الجديدة">
                <select className="select" value={edit.groupId} onChange={(e) => setEdit({ ...edit, groupId: e.target.value })}>
                  <option value="">اختر</option>
                  {(groups.data ?? [])
                    .filter((g) => !g.archived && !p?.enrollments.some((x) => x.group.id === g.id))
                    .map((g) => (
                      <option key={g.id} value={g.id}>{g.name} ({num(g.activeStudents)}/{num(g.capacity)})</option>
                    ))}
                </select>
              </Field>
            ) : (
              <Field
                label="نسبة الخصم %"
                hint={isManager ? undefined : `الحد المسموح لك ${num(current?.workspace.receptionMaxDiscountPct ?? 0)}%`}
              >
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={100}
                  value={edit.discountPct}
                  onChange={(e) => setEdit({ ...edit, discountPct: Number(e.target.value) })}
                />
              </Field>
            )}
            {action.error ? <div className="note error">{action.error}</div> : null}
            <div className="row">
              <button className="btn" onClick={saveEdit} disabled={action.busy || (edit.mode === 'transfer' && !edit.groupId)}>
                {edit.mode === 'transfer' ? 'انقل الطالب' : 'احفظ الخصم'}
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  );
}

interface AccountView {
  name: string;
  login: string;
  hasPassword: boolean;
  lastLoginAt: string | null;
  status: 'ACTIVE' | 'DISABLED';
}

/** حسابات الدخول: ولي الأمر يتابع الحضور والدرجات، والطالب يحل الامتحانات من موبايله */
function AccountsPanel({ studentId, studentName, guardianName }: { studentId: string; studentName: string; guardianName: string }) {
  const accounts = useLoad(() => api<{ guardian: AccountView; student: AccountView | null }>(`/students/${studentId}/accounts`), [studentId]);
  const action = useAction();
  const [issued, setIssued] = useState<{ name: string; title: string; credentials: Credentials } | null>(null);
  const [username, setUsername] = useState('');

  const guardianCreds = () =>
    window.confirm('إصدار كلمة مرور مؤقتة جديدة لولي الأمر؟') &&
    void action.run(async () => {
      const c = await api<Credentials>(`/students/${studentId}/guardian-credentials`, { method: 'POST' });
      setIssued({ name: guardianName, title: 'بيانات دخول ولي الأمر', credentials: c });
      await accounts.reload();
    });

  const studentCreds = () =>
    void action.run(async () => {
      const c = await api<Credentials>(`/students/${studentId}/student-account`, { method: 'POST', body: username.trim() ? { username: username.trim() } : {} });
      setIssued({ name: studentName, title: 'بيانات دخول الطالب', credentials: c });
      setUsername('');
      await accounts.reload();
    });

  const row = (label: string, a: AccountView) => (
    <tr>
      <td>{label}<div className="faint">{a.name}</div></td>
      <td className="num" dir="ltr" style={{ textAlign: 'right' }}>{a.login || '—'}</td>
      <td>
        {a.status === 'DISABLED' ? <Chip tone="bad">موقوف</Chip> : a.lastLoginAt ? <Chip tone="ok">آخر دخول {fmtDateTime(a.lastLoginAt)}</Chip> : a.hasPassword ? <Chip tone="warn">لم يدخل بعد</Chip> : <Chip tone="bad">بلا كلمة مرور</Chip>}
      </td>
    </tr>
  );

  return (
    <section className="panel stack-sm">
      <h2>حسابات الدخول</h2>
      <ErrorNote error={accounts.error ?? action.error} onRetry={accounts.reload} />
      {issued ? <CredentialsCard credentials={issued.credentials} name={issued.name} title={issued.title} /> : null}
      {accounts.data ? (
        <>
          <Ledger head={<tr><th>الحساب</th><th>اسم المستخدم</th><th>الحالة</th></tr>}>
            {row('ولي الأمر', accounts.data.guardian)}
            {accounts.data.student ? row('الطالب', accounts.data.student) : null}
          </Ledger>
          <div className="row">
            {!accounts.data.guardian.lastLoginAt ? (
              <button className="btn quiet" disabled={action.busy} onClick={guardianCreds}>بيانات دخول ولي الأمر</button>
            ) : null}
            {!accounts.data.student ? (
              <>
                <input className="input" dir="ltr" style={{ width: 'auto', minWidth: 160 }} placeholder="اسم مستخدم (اختياري)" value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} />
                <button className="btn quiet" disabled={action.busy} onClick={studentCreds}>إنشاء حساب للطالب</button>
              </>
            ) : !accounts.data.student.lastLoginAt ? (
              <button className="btn quiet" disabled={action.busy} onClick={studentCreds}>بيانات دخول جديدة للطالب</button>
            ) : null}
          </div>
          <p className="faint">بعد أول دخول لا يستطيع السنتر تغيير كلمة المرور؛ يتم ذلك من إدارة المنصة حفاظًا على أمان الحساب.</p>
        </>
      ) : null}
    </section>
  );
}
