'use client';

import { useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { egp, num } from '@/lib/format';
import type { Plan } from '@/lib/platform';
import { useAction, useLoad } from '@/lib/use-load';
import { IfCan } from '@/components/platform-shell';
import { Chip, ErrorNote, Field, Ledger, Loading, Modal, PageHead } from '@/components/ui';

type Draft = { id?: string; code: string; name: string; monthlyPrice: string; yearlyPrice: string; maxStudents: string; maxStaff: string; description: string; active: boolean; sortOrder: string };
const EMPTY: Draft = { code: '', name: '', monthlyPrice: '0', yearlyPrice: '', maxStudents: '', maxStaff: '', description: '', active: true, sortOrder: '0' };

export default function PlansPage() {
  const plans = useLoad(() => api<Plan[]>('/platform/plans', { workspace: false }), []);
  const [edit, setEdit] = useState<Draft | null>(null);
  return (
    <>
      <PageHead title="الخطط والأسعار" sub="الحدود تُفرض فعليًا عند تسجيل الطلاب وإضافة الفريق. يمكن تخصيص حد مختلف لأي مساحة من صفحتها.">
        <IfCan perm="platform.billing.manage"><button className="btn" onClick={() => setEdit({ ...EMPTY })}>خطة جديدة</button></IfCan>
      </PageHead>
      <ErrorNote error={plans.error} onRetry={plans.reload} />
      {plans.loading && !plans.data ? <Loading what="الخطط" /> : null}
      {plans.data ? (
        <Ledger head={<tr><th>الخطة</th><th>الكود</th><th>شهريًا</th><th>سنويًا</th><th>حد الطلاب</th><th>حد الفريق</th><th>المساحات</th><th>الحالة</th><th /></tr>}>
          {plans.data.map((p) => (
            <tr key={p.id} className={!p.active ? 'is-void' : undefined}>
              <td>{p.name}{p.description ? <div className="faint">{p.description}</div> : null}</td>
              <td className="num" dir="ltr">{p.code}</td>
              <td className="num">{egp(p.monthlyPrice)}</td>
              <td className="num">{p.yearlyPrice ? egp(p.yearlyPrice) : '—'}</td>
              <td className="num">{p.maxStudents ? num(p.maxStudents) : 'بلا حد'}</td>
              <td className="num">{p.maxStaff ? num(p.maxStaff) : 'بلا حد'}</td>
              <td className="num">{num(p.workspaces)}</td>
              <td>{p.active ? <Chip tone="ok">متاحة</Chip> : <Chip>مخفية</Chip>}</td>
              <td>
                <IfCan perm="platform.billing.manage">
                  <button
                    className="btn ghost"
                    onClick={() => setEdit({
                      id: p.id, code: p.code, name: p.name, monthlyPrice: p.monthlyPrice, yearlyPrice: p.yearlyPrice ?? '',
                      maxStudents: p.maxStudents ? String(p.maxStudents) : '', maxStaff: p.maxStaff ? String(p.maxStaff) : '',
                      description: p.description ?? '', active: p.active, sortOrder: String(p.sortOrder),
                    })}
                  >
                    تعديل
                  </button>
                </IfCan>
              </td>
            </tr>
          ))}
        </Ledger>
      ) : null}
      <Modal open={Boolean(edit)} title={edit?.id ? 'تعديل خطة' : 'خطة جديدة'} onClose={() => setEdit(null)}>
        {edit ? <PlanForm draft={edit} onDone={() => { setEdit(null); void plans.reload(); }} /> : null}
      </Modal>
    </>
  );
}

function PlanForm({ draft, onDone }: { draft: Draft; onDone: () => void }) {
  const [f, setF] = useState(draft);
  const { busy, error, run } = useAction();
  const money = /^\d+(\.\d{1,2})?$/;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const body = {
        name: f.name.trim(),
        monthlyPrice: f.monthlyPrice,
        yearlyPrice: f.yearlyPrice || null,
        maxStudents: f.maxStudents ? Number(f.maxStudents) : null,
        maxStaff: f.maxStaff ? Number(f.maxStaff) : null,
        description: f.description.trim() || null,
        active: f.active,
        sortOrder: Number(f.sortOrder) || 0,
      };
      if (f.id) await api(`/platform/plans/${f.id}`, { method: 'PATCH', workspace: false, body });
      else await api('/platform/plans', { method: 'POST', workspace: false, body: { ...body, code: f.code.trim() } });
      onDone();
    });
  };
  return (
    <form className="stack" onSubmit={submit}>
      <div className="form-grid">
        <Field label="الاسم"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required minLength={2} /></Field>
        <Field label="الكود" hint={f.id ? 'لا يتغير بعد الإنشاء' : 'حروف إنجليزية صغيرة وأرقام وشرطة'}>
          <input className="input" dir="ltr" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toLowerCase() })} disabled={Boolean(f.id)} required pattern="[a-z0-9-]{2,30}" />
        </Field>
        <Field label="السعر الشهري (ج.م)"><input className="input" dir="ltr" value={f.monthlyPrice} onChange={(e) => setF({ ...f, monthlyPrice: e.target.value })} required /></Field>
        <Field label="السعر السنوي (اختياري)"><input className="input" dir="ltr" value={f.yearlyPrice} onChange={(e) => setF({ ...f, yearlyPrice: e.target.value })} /></Field>
        <Field label="حد الطلاب النشطين" hint="فارغ = بلا حد"><input className="input" type="number" min={1} value={f.maxStudents} onChange={(e) => setF({ ...f, maxStudents: e.target.value })} /></Field>
        <Field label="حد أعضاء الفريق" hint="فارغ = بلا حد"><input className="input" type="number" min={1} value={f.maxStaff} onChange={(e) => setF({ ...f, maxStaff: e.target.value })} /></Field>
        <Field label="الترتيب"><input className="input" type="number" min={0} value={f.sortOrder} onChange={(e) => setF({ ...f, sortOrder: e.target.value })} /></Field>
      </div>
      <Field label="وصف مختصر"><input className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={300} /></Field>
      <label className="row" style={{ gap: '0.4rem' }}><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />متاحة للاختيار</label>
      {error ? <div className="note error">{error}</div> : null}
      <button className="btn" disabled={busy || !money.test(f.monthlyPrice) || (Boolean(f.yearlyPrice) && !money.test(f.yearlyPrice))}>احفظ</button>
    </form>
  );
}
