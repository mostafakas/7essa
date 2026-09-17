'use client';

import Link from 'next/link';
import { useMemo, useState, type FormEvent } from 'react';
import { api, UserError } from '@/lib/api';
import { fmtDateTime, num } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { GroupRow } from '@/lib/types';
import { useAction, useLoad } from '@/lib/use-load';
import { Guard } from '@/components/app-shell';
import { Chip, Empty, ErrorNote, Field, Ledger, Loading, Modal, PageHead, Tabs } from '@/components/ui';

type Tab = 'exams' | 'bank';

interface ExamRow {
  id: string;
  title: string;
  status: 'DRAFT' | 'PUBLISHED' | 'CLOSED';
  group: string | null;
  opensAt: string;
  closesAt: string;
  durationMin: number;
  questions: number;
  submitted: number;
}

interface Question {
  id: string;
  type: 'MCQ' | 'TRUE_FALSE';
  body: string;
  choices: string[];
  correctIndex: number;
  subject: string;
  grade: string;
  unit: string | null;
  difficulty: number;
  shared: boolean;
}

const EXAM_STATUS = { DRAFT: 'مسودة', PUBLISHED: 'منشور', CLOSED: 'مغلق' } as const;
const DIFFICULTY = ['', 'سهل', 'متوسط', 'صعب'];

/**
 * صيغة الاستيراد النصي: سطر السؤال، ثم الاختيارات كل واحد في سطر يبدأ بـ - ،
 * والإجابة الصحيحة تبدأ بـ * . سطر فارغ بين كل سؤال والتالي.
 */
function parseBulk(text: string) {
  const blocks = text.split(/\n\s*\n/).map((b) => b.split('\n').map((l) => l.trim()).filter(Boolean)).filter((b) => b.length);
  const out: { body: string; choices: string[]; correctIndex: number }[] = [];
  const errors: string[] = [];
  blocks.forEach((lines, i) => {
    const [body, ...rest] = lines;
    const choices = rest.filter((l) => /^[-*]/.test(l)).map((l) => l.replace(/^[-*]\s*/, ''));
    const correct = rest.filter((l) => /^[-*]/.test(l)).findIndex((l) => l.startsWith('*'));
    if (choices.length < 2 || correct < 0) errors.push(`السؤال ${i + 1}: يحتاج اختيارين على الأقل وإجابة صحيحة تبدأ بـ *`);
    else out.push({ body, choices, correctIndex: correct });
  });
  return { questions: out, errors };
}

export default function ExamsPage() {
  return (
    <Guard perm="exams.grade">
      <Exams />
    </Guard>
  );
}

function Exams() {
  const { can } = useSession();
  const [tab, setTab] = useState<Tab>('exams');
  return (
    <>
      <PageHead title="الامتحانات" sub="امتحانات إلكترونية بترتيب مختلف لكل طالب، وتصحيح فوري، وتحليل يوضح الأسئلة التي تحتاج مراجعة." />
      <Tabs<Tab> value={tab} onChange={setTab} items={[{ id: 'exams', label: 'الامتحانات' }, { id: 'bank', label: 'بنك الأسئلة', hidden: !can('exams.manage') }]} />
      {tab === 'exams' ? <ExamList /> : <Bank />}
    </>
  );
}

function ExamList() {
  const { can, current } = useSession();
  const exams = useLoad(() => api<ExamRow[]>('/exams'), [current?.workspace.id]);
  const [open, setOpen] = useState(false);
  return (
    <div className="stack">
      {can('exams.manage') ? <div className="row"><button className="btn" onClick={() => setOpen(true)}>امتحان جديد</button></div> : null}
      <ErrorNote error={exams.error} onRetry={exams.reload} />
      {exams.loading && !exams.data ? <Loading what="الامتحانات" /> : null}
      {exams.data && !exams.data.length ? <Empty>لا توجد امتحانات بعد. أضف أسئلة للبنك ثم ابنِ أول امتحان.</Empty> : null}
      {exams.data?.length ? (
        <Ledger head={<tr><th>الامتحان</th><th>المجموعة</th><th>الموعد</th><th>الأسئلة</th><th>سلّموا</th><th>الحالة</th></tr>}>
          {exams.data.map((e) => (
            <tr key={e.id}>
              <td><Link href={`/app/exams/${e.id}`}>{e.title}</Link><div className="faint">{num(e.durationMin)} دقيقة</div></td>
              <td>{e.group ?? '—'}</td>
              <td className="faint">{fmtDateTime(e.opensAt)}<br />حتى {fmtDateTime(e.closesAt)}</td>
              <td className="num">{num(e.questions)}</td>
              <td className="num">{num(e.submitted)}</td>
              <td><Chip tone={e.status === 'PUBLISHED' ? 'info' : e.status === 'CLOSED' ? 'plain' : 'warn'}>{EXAM_STATUS[e.status]}</Chip></td>
            </tr>
          ))}
        </Ledger>
      ) : null}
      <Modal open={open} title="امتحان جديد" onClose={() => setOpen(false)}>
        {open ? <ExamBuilder onDone={(id) => window.location.assign(`/app/exams/${id}`)} /> : null}
      </Modal>
    </div>
  );
}

function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function ExamBuilder({ onDone }: { onDone: (id: string) => void }) {
  const { current } = useSession();
  const groups = useLoad(() => api<GroupRow[]>('/academics/groups'), [current?.workspace.id]);
  const now = new Date();
  const [f, setF] = useState({
    title: '',
    groupId: '',
    durationMin: 30,
    opensAt: toLocalInput(new Date(now.getTime() + 3_600_000)),
    closesAt: toLocalInput(new Date(now.getTime() + 3 * 86_400_000)),
    showResultImmediately: true,
    shuffle: true,
  });
  const [mode, setMode] = useState<'blueprint' | 'manual'>('blueprint');
  const [rows, setRows] = useState([{ unit: '', difficulty: '', count: 10 }]);
  const [picked, setPicked] = useState<string[]>([]);
  const group = groups.data?.find((g) => g.id === f.groupId);
  const bank = useLoad(
    () => (group ? api<Question[]>('/exams/questions', { query: { subject: group.subject, grade: group.grade } }) : Promise.resolve([] as Question[])),
    [group?.id],
  );
  const units = useMemo(() => [...new Set((bank.data ?? []).map((q) => q.unit).filter((u): u is string => Boolean(u)))], [bank.data]);
  const { busy, error, run } = useAction();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const r = await api<{ id: string }>('/exams', {
        method: 'POST',
        body: {
          ...f,
          durationMin: Number(f.durationMin),
          opensAt: new Date(f.opensAt).toISOString(),
          closesAt: new Date(f.closesAt).toISOString(),
          ...(mode === 'manual'
            ? { items: picked.map((questionId) => ({ questionId, points: 1 })) }
            : { blueprint: rows.map((r) => ({ unit: r.unit || undefined, difficulty: r.difficulty ? Number(r.difficulty) : undefined, count: Number(r.count) })) }),
        },
      });
      onDone(r.id);
    });
  };

  return (
    <form className="stack" onSubmit={submit}>
      <div className="form-grid">
        <Field label="عنوان الامتحان"><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required minLength={3} /></Field>
        <Field label="المجموعة">
          <select className="select" value={f.groupId} onChange={(e) => { setF({ ...f, groupId: e.target.value }); setPicked([]); }} required>
            <option value="">اختر</option>
            {groups.data?.filter((g) => !g.archived).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </Field>
        <Field label="المدة بالدقائق"><input className="input" type="number" min={5} max={300} value={f.durationMin} onChange={(e) => setF({ ...f, durationMin: Number(e.target.value) })} /></Field>
        <Field label="يفتح"><input className="input" type="datetime-local" value={f.opensAt} onChange={(e) => setF({ ...f, opensAt: e.target.value })} required /></Field>
        <Field label="يغلق"><input className="input" type="datetime-local" value={f.closesAt} onChange={(e) => setF({ ...f, closesAt: e.target.value })} required /></Field>
      </div>
      <div className="checks">
        <label><input type="checkbox" checked={f.showResultImmediately} onChange={(e) => setF({ ...f, showResultImmediately: e.target.checked })} />الدرجة تظهر فور التسليم</label>
        <label><input type="checkbox" checked={f.shuffle} onChange={(e) => setF({ ...f, shuffle: e.target.checked })} />ترتيب مختلف لكل طالب</label>
      </div>

      {group ? (
        <>
          <p className="faint">في البنك {num(bank.data?.length)} سؤال لمادة {group.subject}، {group.grade}.</p>
          <div className="checks">
            <label><input type="radio" checked={mode === 'blueprint'} onChange={() => setMode('blueprint')} />اختيار تلقائي بالمواصفات</label>
            <label><input type="radio" checked={mode === 'manual'} onChange={() => setMode('manual')} />اختيار يدوي</label>
          </div>
          {mode === 'blueprint' ? (
            <div className="stack-sm">
              {rows.map((r, i) => (
                <div key={i} className="form-grid">
                  <Field label="الوحدة">
                    <select className="select" value={r.unit} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)))}>
                      <option value="">أي وحدة</option>
                      {units.map((u) => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </Field>
                  <Field label="الصعوبة">
                    <select className="select" value={r.difficulty} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, difficulty: e.target.value } : x)))}>
                      <option value="">أي مستوى</option>
                      <option value="1">سهل</option>
                      <option value="2">متوسط</option>
                      <option value="3">صعب</option>
                    </select>
                  </Field>
                  <Field label="عدد الأسئلة">
                    <input className="input" type="number" min={1} max={100} value={r.count} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, count: Number(e.target.value) } : x)))} />
                  </Field>
                  {rows.length > 1 ? <button type="button" className="btn ghost" onClick={() => setRows(rows.filter((_, j) => j !== i))}>حذف السطر</button> : <span />}
                </div>
              ))}
              <div className="row">
                <button type="button" className="btn quiet" onClick={() => setRows([...rows, { unit: '', difficulty: '', count: 5 }])}>أضف مواصفة</button>
              </div>
            </div>
          ) : (
            <div className="stack-sm" style={{ maxHeight: 320, overflowY: 'auto' }}>
              {bank.data?.map((q) => (
                <label key={q.id} className="row" style={{ alignItems: 'flex-start' }}>
                  <input
                    type="checkbox"
                    checked={picked.includes(q.id)}
                    onChange={(e) => setPicked(e.target.checked ? [...picked, q.id] : picked.filter((x) => x !== q.id))}
                  />
                  <span>{q.body} <span className="faint">({q.unit ?? 'بدون وحدة'}، {DIFFICULTY[q.difficulty]})</span></span>
                </label>
              ))}
              <p className="faint">المختار: {num(picked.length)}</p>
            </div>
          )}
        </>
      ) : null}

      {error ? <div className="note error">{error}</div> : null}
      <button className="btn" disabled={busy || !group || (mode === 'manual' && !picked.length)}>أنشئ الامتحان كمسودة</button>
    </form>
  );
}

function Bank() {
  const { current } = useSession();
  const [filter, setFilter] = useState({ subject: '', grade: '', unit: '' });
  const bank = useLoad(() => api<Question[]>('/exams/questions', { query: filter }), [filter.subject, filter.grade, filter.unit, current?.workspace.id]);
  const [adding, setAdding] = useState<'one' | 'bulk' | null>(null);

  return (
    <div className="stack">
      <div className="row-between">
        <div className="form-grid grow">
          <Field label="المادة"><input className="input" value={filter.subject} onChange={(e) => setFilter({ ...filter, subject: e.target.value })} /></Field>
          <Field label="الصف"><input className="input" value={filter.grade} onChange={(e) => setFilter({ ...filter, grade: e.target.value })} /></Field>
          <Field label="الوحدة"><input className="input" value={filter.unit} onChange={(e) => setFilter({ ...filter, unit: e.target.value })} /></Field>
        </div>
      </div>
      <div className="row">
        <button className="btn" onClick={() => setAdding('one')}>سؤال جديد</button>
        <button className="btn quiet" onClick={() => setAdding('bulk')}>لصق مجموعة أسئلة</button>
      </div>
      <ErrorNote error={bank.error} onRetry={bank.reload} />
      {bank.loading && !bank.data ? <Loading what="البنك" /> : null}
      {bank.data && !bank.data.length ? <Empty>لا توجد أسئلة مطابقة.</Empty> : null}
      {bank.data?.length ? (
        <Ledger head={<tr><th>السؤال</th><th>الإجابة</th><th>التصنيف</th></tr>}>
          {bank.data.map((q) => (
            <tr key={q.id}>
              <td>{q.body}<div className="faint">{q.choices.join('، ')}</div></td>
              <td><Chip tone="ok">{q.choices[q.correctIndex]}</Chip></td>
              <td className="faint">
                {q.subject}، {q.grade}{q.unit ? `، ${q.unit}` : ''}، {DIFFICULTY[q.difficulty]}
                {q.shared ? <> <Chip tone="info">مشترك</Chip></> : null}
              </td>
            </tr>
          ))}
        </Ledger>
      ) : null}
      <Modal open={adding !== null} title={adding === 'bulk' ? 'لصق أسئلة' : 'سؤال جديد'} onClose={() => setAdding(null)}>
        {adding ? <QuestionForm bulk={adding === 'bulk'} onDone={() => { setAdding(null); void bank.reload(); }} /> : null}
      </Modal>
    </div>
  );
}

function QuestionForm({ bulk, onDone }: { bulk: boolean; onDone: () => void }) {
  const [meta, setMeta] = useState({ subject: '', grade: '', unit: '', difficulty: '2', shared: false });
  const [q, setQ] = useState({ type: 'MCQ' as 'MCQ' | 'TRUE_FALSE', body: '', choices: ['', '', '', ''], correctIndex: 0 });
  const [text, setText] = useState('');
  const { busy, error, run } = useAction();
  const parsed = bulk ? parseBulk(text) : null;

  const base = { subject: meta.subject, grade: meta.grade, unit: meta.unit || undefined, difficulty: Number(meta.difficulty), shared: meta.shared };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      if (bulk && parsed) {
        await api('/exams/questions/import', {
          method: 'POST',
          body: { questions: parsed.questions.map((x) => ({ ...base, type: 'MCQ', ...x })) },
        });
      } else {
        // الاختيارات الفارغة تُحذف، فيُعاد حساب موضع الإجابة الصحيحة بعد الحذف
        const filled = q.choices.map((c, i) => ({ c: c.trim(), i })).filter((x) => x.c);
        const correctIndex = q.type === 'TRUE_FALSE' ? q.correctIndex : filled.findIndex((x) => x.i === q.correctIndex);
        if (correctIndex < 0) throw new UserError('الإجابة الصحيحة المختارة فارغة');
        const choices = q.type === 'TRUE_FALSE' ? undefined : filled.map((x) => x.c);
        await api('/exams/questions', { method: 'POST', body: { ...base, type: q.type, body: q.body, choices, correctIndex } });
      }
      onDone();
    });
  };

  return (
    <form className="stack" onSubmit={submit}>
      <div className="form-grid">
        <Field label="المادة"><input className="input" value={meta.subject} onChange={(e) => setMeta({ ...meta, subject: e.target.value })} required /></Field>
        <Field label="الصف"><input className="input" value={meta.grade} onChange={(e) => setMeta({ ...meta, grade: e.target.value })} required /></Field>
        <Field label="الوحدة"><input className="input" value={meta.unit} onChange={(e) => setMeta({ ...meta, unit: e.target.value })} /></Field>
        <Field label="الصعوبة">
          <select className="select" value={meta.difficulty} onChange={(e) => setMeta({ ...meta, difficulty: e.target.value })}>
            <option value="1">سهل</option><option value="2">متوسط</option><option value="3">صعب</option>
          </select>
        </Field>
      </div>
      <label className="row">
        <input type="checkbox" checked={meta.shared} onChange={(e) => setMeta({ ...meta, shared: e.target.checked })} />
        <span>متاح لباقي مدرسي مساحة العمل</span>
      </label>

      {bulk ? (
        <>
          <Field label="الأسئلة" hint="السؤال في سطر، ثم كل اختيار في سطر يبدأ بـ - ، والإجابة الصحيحة تبدأ بـ * ، وسطر فارغ بين الأسئلة.">
            <textarea
              className="textarea"
              style={{ minHeight: 220 }}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={'وحدة قياس شدة التيار هي\n- الفولت\n* الأمبير\n- الأوم\n\nالسؤال التالي…'}
            />
          </Field>
          {parsed?.errors.length ? <div className="note warn">{parsed.errors.slice(0, 5).join('، ')}</div> : null}
          <p className="faint">جاهز للإضافة: {num(parsed?.questions.length)} سؤال.</p>
        </>
      ) : (
        <>
          <div className="checks">
            <label><input type="radio" checked={q.type === 'MCQ'} onChange={() => setQ({ ...q, type: 'MCQ', correctIndex: 0 })} />اختيار من متعدد</label>
            <label><input type="radio" checked={q.type === 'TRUE_FALSE'} onChange={() => setQ({ ...q, type: 'TRUE_FALSE', correctIndex: 0 })} />صح أو خطأ</label>
          </div>
          <Field label="نص السؤال"><textarea className="textarea" value={q.body} onChange={(e) => setQ({ ...q, body: e.target.value })} required minLength={3} /></Field>
          {q.type === 'MCQ' ? (
            <fieldset className="stack-sm" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="field"><span>الاختيارات (حدد الصحيحة)</span></legend>
              {q.choices.map((c, i) => (
                <div key={i} className="row">
                  <input type="radio" name="correct" checked={q.correctIndex === i} onChange={() => setQ({ ...q, correctIndex: i })} aria-label={`الاختيار ${i + 1} صحيح`} />
                  <input className="input grow" value={c} onChange={(e) => setQ({ ...q, choices: q.choices.map((x, j) => (j === i ? e.target.value : x)) })} placeholder={`الاختيار ${i + 1}`} />
                </div>
              ))}
            </fieldset>
          ) : (
            <div className="checks">
              <label><input type="radio" checked={q.correctIndex === 0} onChange={() => setQ({ ...q, correctIndex: 0 })} />العبارة صحيحة</label>
              <label><input type="radio" checked={q.correctIndex === 1} onChange={() => setQ({ ...q, correctIndex: 1 })} />العبارة خاطئة</label>
            </div>
          )}
        </>
      )}
      {error ? <div className="note error">{error}</div> : null}
      <button className="btn" disabled={busy || (bulk ? !parsed?.questions.length : !q.body.trim())}>
        {bulk ? `أضف ${num(parsed?.questions.length)} سؤال` : 'أضف السؤال'}
      </button>
    </form>
  );
}
