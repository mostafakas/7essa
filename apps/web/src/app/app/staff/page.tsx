'use client';

import { useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { fmtDateTime, localPhone, ROLE_LABEL } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { Member } from '@/lib/types';
import { useAction, useLoad } from '@/lib/use-load';
import { Guard } from '@/components/app-shell';
import { Chip, ErrorNote, Field, Ledger, Loading, Modal, PageHead, Tabs } from '@/components/ui';

interface AuditRow {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  actor: string;
  meta: Record<string, unknown> | null;
  createdAt: string;
}

const ACTION_LABEL: Record<string, string> = {
  'workspace.create': 'إنشاء مساحة العمل',
  'workspace.update': 'تعديل الإعدادات',
  'member.invite': 'إضافة عضو',
  'member.update': 'تعديل عضو',
  'student.register': 'تسجيل طالب',
  'student.card_reissue': 'كارنيه بدل فاقد',
  'enrollment.update': 'تعديل اشتراك',
  'enrollment.transfer': 'نقل طالب',
  'attendance.manual': 'حضور يدوي',
  'attendance.close': 'إغلاق كشف',
  'shift.open': 'فتح وردية',
  'shift.close': 'إغلاق وردية',
  'shift.approve': 'اعتماد وردية',
  'receipt.issue': 'إصدار إيصال',
  'receipt.cancel_request': 'طلب إلغاء إيصال',
  'receipt.cancel_approve': 'اعتماد إلغاء إيصال',
  'receipt.cancel_reject': 'رفض إلغاء إيصال',
  'expense.create': 'تسجيل مصروف',
  'contract.create': 'عقد مدرس',
  'contract.end': 'إنهاء عقد',
  'advance.create': 'سلفة مدرس',
  'settlement.calculate': 'حساب التسويات',
  'settlement.confirm': 'تأكيد المدرس للكشف',
  'settlement.dispute': 'اعتراض على كشف',
  'settlement.approve': 'اعتماد كشف',
  'settlement.pay': 'صرف تسوية',
  'exam.create': 'إنشاء امتحان',
  'exam.publish': 'نشر امتحان',
  'exam.paper_result': 'نتيجة ورقية',
  'question.create': 'إضافة أسئلة',
  'session.cancel': 'إلغاء حصة',
  'session.reschedule': 'تغيير موعد حصة',
  'session.create': 'حصة إضافية',
  'group.create': 'إنشاء مجموعة',
  'group.update': 'تعديل مجموعة',
  'session.schedule': 'توليد جدول',
  'guardian.consent': 'موافقة ولي الأمر',
  'user.rename': 'تعديل الاسم',
  'auth.login': 'تسجيل دخول',
  'auth.refresh_reuse': 'تنبيه أمني: إعادة استخدام جلسة',
  'platform.workspace_update': 'تعديل من إدارة المنصة',
};

const ASSIGNABLE: Record<string, string[]> = {
  OWNER: ['MANAGER', 'TEACHER', 'RECEPTION', 'ACCOUNTANT', 'ASSISTANT', 'FOLLOWUP', 'OWNER'],
  MANAGER: ['TEACHER', 'RECEPTION', 'ACCOUNTANT', 'ASSISTANT', 'FOLLOWUP'],
};

type Tab = 'team' | 'audit';

export default function StaffPage() {
  return (
    <Guard perm="staff.manage">
      <Staff />
    </Guard>
  );
}

function Staff() {
  const { current } = useSession();
  const [tab, setTab] = useState<Tab>('team');
  const members = useLoad(() => api<Member[]>('/workspaces/current/members'), [current?.workspace.id]);
  const audit = useLoad(() => (tab === 'audit' ? api<AuditRow[]>('/workspaces/current/audit') : Promise.resolve(null)), [tab, current?.workspace.id]);
  const [invite, setInvite] = useState(false);
  const action = useAction();
  const roles = ASSIGNABLE[current?.me.role ?? ''] ?? [];
  const teachers = (members.data ?? []).filter((m) => m.role === 'TEACHER' && m.status === 'ACTIVE');

  const update = (m: Member, body: Record<string, unknown>) =>
    void action.run(async () => {
      await api(`/workspaces/current/members/${m.membershipId}`, { method: 'PATCH', body });
      await members.reload();
    });

  return (
    <>
      <PageHead title="الفريق والسجل" sub="كل عضو يرى فقط ما يخص دوره، وكل حركة مهمة تُسجَّل ولا يمكن تعديلها أو حذفها.">
        {tab === 'team' ? <button className="btn" onClick={() => setInvite(true)}>أضف عضوًا</button> : null}
      </PageHead>
      <Tabs<Tab> value={tab} onChange={setTab} items={[{ id: 'team', label: 'الفريق' }, { id: 'audit', label: 'سجل العمليات' }]} />
      <ErrorNote error={action.error} />

      {tab === 'team' ? (
        <>
          <ErrorNote error={members.error} onRetry={members.reload} />
          {members.loading && !members.data ? <Loading what="الفريق" /> : null}
          {members.data ? (
            <Ledger head={<tr><th>الاسم</th><th>الموبايل</th><th>الدور</th><th>يتبع</th><th>الحالة</th><th /></tr>}>
              {members.data.map((m) => (
                <tr key={m.membershipId} className={m.status === 'DISABLED' ? 'is-void' : undefined}>
                  <td>{m.name} {m.isMe ? <Chip tone="info">أنت</Chip> : null}</td>
                  <td className="num">{localPhone(m.phone)}</td>
                  <td>
                    {!m.isMe && roles.includes(m.role) ? (
                      <select className="select" style={{ width: 'auto' }} value={m.role} disabled={action.busy} onChange={(e) => update(m, { role: e.target.value })}>
                        {roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                      </select>
                    ) : ROLE_LABEL[m.role] ?? m.role}
                  </td>
                  <td>
                    {m.role === 'ASSISTANT' ? (
                      <select className="select" style={{ width: 'auto' }} value={m.supervisorMembershipId ?? ''} disabled={action.busy} onChange={(e) => update(m, { supervisorMembershipId: e.target.value })}>
                        <option value="" disabled>اختر المدرس</option>
                        {teachers.map((t) => <option key={t.membershipId} value={t.membershipId}>{t.name}</option>)}
                      </select>
                    ) : '—'}
                  </td>
                  <td>
                    {m.status === 'DISABLED' ? <Chip tone="bad">موقوف</Chip> : m.activated ? <Chip tone="ok">نشط</Chip> : <Chip tone="warn">لم يسجل دخوله بعد</Chip>}
                  </td>
                  <td>
                    {!m.isMe && roles.includes(m.role) ? (
                      <button className="btn ghost" disabled={action.busy} onClick={() => update(m, { status: m.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' })}>
                        {m.status === 'ACTIVE' ? 'إيقاف الحساب' : 'إعادة التفعيل'}
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </Ledger>
          ) : null}
          <p className="faint" style={{ marginTop: '0.75rem' }}>إيقاف العضو يمنعه فورًا من دخول مساحة العمل دون حذف أي بيانات سجلها.</p>
        </>
      ) : (
        <>
          <ErrorNote error={audit.error} onRetry={audit.reload} />
          {audit.loading && !audit.data ? <Loading what="السجل" /> : null}
          {audit.data ? (
            <Ledger head={<tr><th>الوقت</th><th>بواسطة</th><th>العملية</th><th>تفاصيل</th></tr>}>
              {audit.data.map((a) => (
                <tr key={a.id}>
                  <td className="faint nowrap">{fmtDateTime(a.createdAt)}</td>
                  <td>{a.actor}</td>
                  <td>{ACTION_LABEL[a.action] ?? a.action}</td>
                  <td className="faint" style={{ maxWidth: 360, overflowWrap: 'anywhere' }}>
                    {a.meta ? Object.entries(a.meta).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join('، ') : ''}
                  </td>
                </tr>
              ))}
            </Ledger>
          ) : null}
        </>
      )}

      <Modal open={invite} title="إضافة عضو للفريق" onClose={() => setInvite(false)}>
        {invite ? <InviteForm roles={roles} teachers={teachers} onDone={() => { setInvite(false); void members.reload(); }} /> : null}
      </Modal>
    </>
  );
}

function InviteForm({ roles, teachers, onDone }: { roles: string[]; teachers: Member[]; onDone: () => void }) {
  const [f, setF] = useState({ name: '', phone: '', role: roles.includes('RECEPTION') ? 'RECEPTION' : roles[0] ?? '', supervisorMembershipId: '' });
  const { busy, error, run } = useAction();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api('/workspaces/current/members', {
        method: 'POST',
        body: { ...f, supervisorMembershipId: f.role === 'ASSISTANT' ? f.supervisorMembershipId : undefined },
      });
      onDone();
    });
  };
  return (
    <form className="stack" onSubmit={submit}>
      <div className="form-grid">
        <Field label="الاسم"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required minLength={2} /></Field>
        <Field label="رقم الموبايل" hint="يدخل به العضو بعد إضافته"><input className="input" dir="ltr" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} required /></Field>
        <Field label="الدور">
          <select className="select" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
            {roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
        </Field>
        {f.role === 'ASSISTANT' ? (
          <Field label="يساعد المدرس">
            <select className="select" value={f.supervisorMembershipId} onChange={(e) => setF({ ...f, supervisorMembershipId: e.target.value })} required>
              <option value="">اختر</option>
              {teachers.map((t) => <option key={t.membershipId} value={t.membershipId}>{t.name}</option>)}
            </select>
          </Field>
        ) : null}
      </div>
      {f.role === 'OWNER' ? <div className="note warn">المالك يملك كل الصلاحيات بما فيها إدارة المالية والفريق.</div> : null}
      {error ? <div className="note error">{error}</div> : null}
      <button className="btn" disabled={busy}>أضف العضو وأبلغه</button>
    </form>
  );
}
