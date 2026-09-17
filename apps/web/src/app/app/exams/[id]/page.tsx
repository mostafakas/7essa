'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { fmtDateTime, num } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { StudentListItem } from '@/lib/types';
import { useAction, useLoad } from '@/lib/use-load';
import { Guard } from '@/components/app-shell';
import { Chip, Empty, ErrorNote, Field, Ledger, Loading, Modal, PageHead, Tabs } from '@/components/ui';

interface ExamDetail {
  id: string;
  title: string;
  status: 'DRAFT' | 'PUBLISHED' | 'CLOSED';
  groupId: string | null;
  group: string | null;
  durationMin: number;
  opensAt: string;
  closesAt: string;
  showResultImmediately: boolean;
  shuffle: boolean;
  questions: { id: string; position: number; points: number; type: string; body: string; choices: string[]; correctIndex: number; unit: string | null; difficulty: number }[];
}

interface Results {
  exam: { id: string; title: string; status: string; maxScore: number; group: string | null };
  stats: { started: number; submitted: number; average: number; distribution: { label: string; count: number }[] };
  attempts: { id: string; student: string; studentId: string; score: number | null; maxScore: number | null; rank: number | null; late: boolean; startedAt: string; submittedAt: string | null }[];
  items: { questionId: string; position: number; body: string; unit: string | null; facility: number; discrimination: number; answered: number; flag: string | null }[];
}

type Tab = 'questions' | 'results' | 'analysis';

export default function ExamPage() {
  return (
    <Guard perm="exams.grade">
      <Exam />
    </Guard>
  );
}

function Exam() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const exam = useLoad(() => api<ExamDetail>(`/exams/${id}`), [id]);
  const results = useLoad(() => api<Results>(`/exams/${id}/results`), [id]);
  const action = useAction();
  const [tab, setTab] = useState<Tab>('questions');
  const [paper, setPaper] = useState(false);

  const e = exam.data;
  const r = results.data;
  const maxBucket = Math.max(1, ...(r?.stats.distribution.map((d) => d.count) ?? [1]));

  const step = (path: 'publish' | 'close', confirmText: string) =>
    window.confirm(confirmText) &&
    void action.run(async () => {
      await api(`/exams/${id}/${path}`, { method: 'POST' });
      await Promise.all([exam.reload(), results.reload()]);
    });

  const release = () =>
    void action.run(async () => {
      await api(`/exams/${id}`, { method: 'PATCH', body: { showResultImmediately: true } });
      await exam.reload();
    });

  return (
    <>
      <PageHead
        title={e?.title ?? 'الامتحان'}
        sub={e ? `${e.group ?? ''}، ${num(e.durationMin)} دقيقة، من ${fmtDateTime(e.opensAt)} حتى ${fmtDateTime(e.closesAt)}` : undefined}
      >
        <Link className="btn ghost" href="/app/exams">كل الامتحانات</Link>
        {e && can('exams.manage') && e.status === 'DRAFT' ? (
          <button className="btn" disabled={action.busy} onClick={() => step('publish', 'بعد النشر يصل إشعار لأولياء أمور المجموعة ولا يمكن تعديل الأسئلة. متابعة؟')}>انشر الامتحان</button>
        ) : null}
        {e && can('exams.manage') && e.status === 'PUBLISHED' ? (
          <button className="btn danger" disabled={action.busy} onClick={() => step('close', 'إغلاق الامتحان يمنع أي محاولات جديدة ويُظهر الإجابات النموذجية للطلاب. متابعة؟')}>أغلق الامتحان</button>
        ) : null}
        {e && can('exams.manage') && !e.showResultImmediately && e.status === 'PUBLISHED' ? (
          <button className="btn quiet" disabled={action.busy} onClick={release}>أظهر الدرجات للطلاب</button>
        ) : null}
        {e && e.groupId && e.status !== 'DRAFT' ? <button className="btn quiet" onClick={() => setPaper(true)}>أدخل نتيجة ورقية</button> : null}
      </PageHead>

      <ErrorNote error={exam.error ?? action.error} onRetry={exam.reload} />
      {exam.loading && !e ? <Loading what="الامتحان" /> : null}

      {e ? (
        <>
          <div className="row" style={{ marginBottom: '1rem' }}>
            <Chip tone={e.status === 'PUBLISHED' ? 'info' : e.status === 'DRAFT' ? 'warn' : 'plain'}>
              {e.status === 'DRAFT' ? 'مسودة' : e.status === 'PUBLISHED' ? 'منشور' : 'مغلق'}
            </Chip>
            <Chip>{num(e.questions.length)} سؤال</Chip>
            {r ? <Chip>سلّم {num(r.stats.submitted)} من {num(r.stats.started)} بدأوا</Chip> : null}
            {e.shuffle ? <Chip>ترتيب مختلف لكل طالب</Chip> : null}
            {!e.showResultImmediately ? <Chip tone="warn">الدرجات محجوبة حتى الإغلاق</Chip> : null}
          </div>

          <Tabs<Tab>
            value={tab}
            onChange={setTab}
            items={[
              { id: 'questions', label: 'الأسئلة' },
              { id: 'results', label: 'النتائج والترتيب' },
              { id: 'analysis', label: 'تحليل الأسئلة' },
            ]}
          />

          {tab === 'questions' ? (
            <section className="panel">
              {e.questions.map((q, i) => (
                <article key={q.id} className="question">
                  <div className="q">{num(i + 1)}. {q.body}</div>
                  <ol style={{ margin: 0, paddingInlineStart: '1.2rem' }}>
                    {q.choices.map((c, j) => (
                      <li key={j}>{j === q.correctIndex ? <span className="mark">{c}</span> : c}</li>
                    ))}
                  </ol>
                  <div className="faint">{q.unit ?? 'بدون وحدة'}، {num(q.points)} درجة</div>
                </article>
              ))}
            </section>
          ) : null}

          {tab === 'results' ? (
            <div className="stack">
              <ErrorNote error={results.error} onRetry={results.reload} />
              {r && !r.attempts.length ? <Empty>لم يبدأ أي طالب الامتحان بعد.</Empty> : null}
              {r?.attempts.length ? (
                <div className="split">
                  <Ledger head={<tr><th>الترتيب</th><th>الطالب</th><th>الدرجة</th><th>التسليم</th></tr>}>
                    {r.attempts.map((a) => (
                      <tr key={a.id}>
                        <td className="num">{a.rank ?? '—'}</td>
                        <td><Link href={`/app/students/${a.studentId}`}>{a.student}</Link></td>
                        <td className="num">{a.score === null ? '—' : `${a.score} / ${a.maxScore}`}</td>
                        <td>
                          {a.submittedAt ? fmtDateTime(a.submittedAt) : <Chip tone="info">يحل الآن أو لم يسلّم</Chip>}
                          {a.late ? <> <Chip tone="warn">متأخر</Chip></> : null}
                        </td>
                      </tr>
                    ))}
                  </Ledger>
                  <aside className="panel stack-sm">
                    <h3>المتوسط</h3>
                    <div className="big-figure num">{r.stats.average} / {r.exam.maxScore}</div>
                    <h3>توزيع الدرجات</h3>
                    {r.stats.distribution.map((d) => (
                      <div key={d.label}>
                        <div className="row-between"><span>{d.label}</span><span className="num">{num(d.count)}</span></div>
                        <div className="fill"><i style={{ width: `${(d.count / maxBucket) * 100}%`, background: 'var(--pen)' }} /></div>
                      </div>
                    ))}
                  </aside>
                </div>
              ) : null}
            </div>
          ) : null}

          {tab === 'analysis' ? (
            <div className="stack-sm">
              <p className="muted">
                السهولة = نسبة من أجابوا صح. التمييز = الفرق بين أفضل وأضعف 27% من الطلاب؛ القيمة المنخفضة تعني أن السؤال لا يفرق بين المستويات.
              </p>
              {r?.items.length ? (
                <Ledger head={<tr><th>#</th><th>السؤال</th><th>السهولة</th><th>التمييز</th><th /></tr>}>
                  {r.items.map((it) => (
                    <tr key={it.questionId}>
                      <td className="num">{num(it.position)}</td>
                      <td>{it.body}<div className="faint">{it.unit ?? ''}</div></td>
                      <td>
                        <span className="num">{Math.round(it.facility * 100)}%</span>
                        <div className="fill"><i style={{ width: `${it.facility * 100}%` }} /></div>
                      </td>
                      <td className="num">{it.discrimination.toFixed(2)}</td>
                      <td>{it.flag ? <Chip tone="warn">{it.flag}</Chip> : null}</td>
                    </tr>
                  ))}
                </Ledger>
              ) : <Empty>يظهر التحليل بعد تسليم الطلاب.</Empty>}
            </div>
          ) : null}

          <Modal open={paper} title="نتيجة امتحان ورقي" onClose={() => setPaper(false)}>
            {paper && e.groupId ? <PaperForm exam={e} onDone={() => { setPaper(false); void results.reload(); }} /> : null}
          </Modal>
        </>
      ) : null}
    </>
  );
}

function PaperForm({ exam, onDone }: { exam: ExamDetail; onDone: () => void }) {
  // القائمة مقسمة على صفحات من 50 طالبًا
  const students = useLoad(async () => {
    const all: StudentListItem[] = [];
    for (let page = 1; page <= 20; page++) {
      const r = await api<{ total: number; items: StudentListItem[] }>('/students', {
        query: { groupId: exam.groupId ?? undefined, status: 'ACTIVE', page },
      });
      all.push(...r.items);
      if (!r.items.length || all.length >= r.total) break;
    }
    return all;
  }, [exam.groupId]);
  const [studentId, setStudentId] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [done, setDone] = useState<string | null>(null);
  const { busy, error, run } = useAction();

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    void run(async () => {
      const r = await api<{ score: number; maxScore: number }>(`/exams/${exam.id}/paper-results`, {
        method: 'POST',
        body: {
          studentId,
          answers: Object.fromEntries(exam.questions.map((q) => [q.id, answers[q.id] === undefined || answers[q.id] === '' ? null : Number(answers[q.id])])),
        },
      });
      setDone(`سُجلت الدرجة ${r.score} من ${r.maxScore}.`);
      setAnswers({});
      setStudentId('');
    });
  };

  return (
    <form className="stack" onSubmit={submit}>
      {done ? <div className="note info">{done}</div> : null}
      <Field label="الطالب">
        <select className="select" value={studentId} onChange={(e) => setStudentId(e.target.value)} required>
          <option value="">اختر</option>
          {students.data?.map((s) => <option key={s.studentId} value={s.studentId}>{s.fullName} ({s.code})</option>)}
        </select>
      </Field>
      <div className="stack-sm" style={{ maxHeight: 360, overflowY: 'auto' }}>
        {exam.questions.map((q, i) => (
          <label key={q.id} className="row-between">
            <span>{num(i + 1)}. {q.body.slice(0, 60)}{q.body.length > 60 ? '…' : ''}</span>
            <select className="select" style={{ width: 'auto' }} value={answers[q.id] ?? ''} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}>
              <option value="">بدون إجابة</option>
              {q.choices.map((c, j) => <option key={j} value={j}>{c}</option>)}
            </select>
          </label>
        ))}
      </div>
      {error ? <div className="note error">{error}</div> : null}
      <div className="row">
        <button className="btn" disabled={busy || !studentId}>صحّح واحفظ</button>
        <button type="button" className="btn ghost" onClick={onDone}>إنهاء</button>
      </div>
    </form>
  );
}
