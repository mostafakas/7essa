'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorText } from '@/lib/api';
import { num } from '@/lib/format';
import { useLoad } from '@/lib/use-load';
import { ErrorNote, Loading, Stamp } from '@/components/ui';

interface PaperQuestion {
  id: string;
  n: number;
  type: string;
  body: string;
  points: number;
  choices: string[];
}

interface ResultQuestion {
  id: string;
  n: number;
  body: string;
  choices: string[];
  chosen: number | null;
  correct: boolean;
  modelAnswer: number | null;
}

type Attempt =
  | { state: 'IN_PROGRESS'; attemptId: string; title: string; deadlineAt: string; serverNow: string; questions: PaperQuestion[] }
  | { state: 'EXPIRED'; attemptId: string; title: string }
  | {
      state: 'SUBMITTED';
      attemptId: string;
      title: string;
      late: boolean;
      released: boolean;
      score?: number;
      maxScore?: number;
      questions?: ResultQuestion[];
    };

const storeKey = (id: string) => `hessa.attempt.${id}`;

export default function AttemptPage() {
  const { id } = useParams<{ id: string }>();
  const attempt = useLoad(() => api<Attempt>(`/family/attempts/${id}`, { workspace: false }), [id]);
  const [result, setResult] = useState<Attempt | null>(null);
  const shown = result ?? attempt.data;

  return (
    <div className="stack">
      <ErrorNote error={attempt.error} onRetry={attempt.reload} />
      {attempt.loading && !shown ? <Loading what="الامتحان" /> : null}
      {shown?.state === 'IN_PROGRESS' ? <Paper attempt={shown} onSubmitted={setResult} /> : null}
      {shown?.state === 'EXPIRED' ? (
        <div className="stamp-zone">
          <Stamp tone="bad" word="انتهى الوقت" who={shown.title} sub="لم يُسلَّم الامتحان في موعده" />
        </div>
      ) : null}
      {shown?.state === 'SUBMITTED' ? <Result attempt={shown} /> : null}
    </div>
  );
}

function Paper({ attempt, onSubmitted }: { attempt: Extract<Attempt, { state: 'IN_PROGRESS' }>; onSubmitted: (a: Attempt) => void }) {
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [left, setLeft] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const submitted = useRef(false);
  const lastAutoTry = useRef(0);
  // فرق الساعة بين الجهاز والخادم حتى لا يؤثر ضبط ساعة الموبايل على المؤقت
  const offset = useRef(new Date(attempt.serverNow).getTime() - Date.now());

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storeKey(attempt.attemptId));
      if (saved) setAnswers(JSON.parse(saved) as Record<string, number>);
    } catch {
      /* تجاهل */
    }
  }, [attempt.attemptId]);

  const choose = (qid: string, i: number) => {
    setAnswers((a) => {
      const next = { ...a, [qid]: i };
      window.localStorage.setItem(storeKey(attempt.attemptId), JSON.stringify(next));
      return next;
    });
  };

  const submit = useCallback(
    async (auto: boolean) => {
      if (submitted.current) return;
      if (!auto && !window.confirm('تسليم الإجابات نهائيًا؟ لا يمكن التعديل بعد التسليم.')) return;
      submitted.current = true;
      setSending(true);
      setError(null);
      try {
        const saved = JSON.parse(window.localStorage.getItem(storeKey(attempt.attemptId)) ?? '{}') as Record<string, number>;
        const res = await api<Attempt>(`/family/attempts/${attempt.attemptId}/submit`, {
          method: 'POST',
          body: { answers: saved },
          workspace: false,
        });
        window.localStorage.removeItem(storeKey(attempt.attemptId));
        onSubmitted(res);
      } catch (e) {
        submitted.current = false;
        setError(`${errorText(e)}. إجاباتك محفوظة على الجهاز، حاول التسليم مرة أخرى.`);
      } finally {
        setSending(false);
      }
    },
    [attempt.attemptId, onSubmitted],
  );

  useEffect(() => {
    const deadline = new Date(attempt.deadlineAt).getTime();
    const tick = () => {
      const remaining = Math.max(0, Math.floor((deadline - (Date.now() + offset.current)) / 1000));
      setLeft(remaining);
      // عند فشل التسليم التلقائي (انقطاع الشبكة) يُعاد كل 10 ثوانٍ
      if (remaining === 0 && Date.now() - lastAutoTry.current > 10_000) {
        lastAutoTry.current = Date.now();
        void submit(true);
      }
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [attempt.deadlineAt, submit]);

  const answered = attempt.questions.filter((q) => answers[q.id] !== undefined).length;
  const mm = String(Math.floor(left / 60)).padStart(2, '0');
  const ss = String(left % 60).padStart(2, '0');

  return (
    <>
      <div className="row-between">
        <h1>{attempt.title}</h1>
        <div className={`timer num${left < 120 ? ' low' : ''}`} role="timer" aria-live={left < 60 ? 'assertive' : 'off'}>
          {mm}:{ss}
        </div>
      </div>
      <p className="muted">أجبت {num(answered)} من {num(attempt.questions.length)}. إجاباتك تُحفظ على الجهاز أولًا بأول، وتُسلَّم تلقائيًا عند انتهاء الوقت.</p>

      <section className="panel">
        {attempt.questions.map((q) => (
          <fieldset key={q.id} className="question" style={{ border: 0, margin: 0, paddingInline: 0 }}>
            <legend className="q">{num(q.n)}. {q.body} <span className="faint">({num(q.points)} درجة)</span></legend>
            <div className="choices">
              {q.choices.map((c, i) => (
                <label key={i}>
                  <input type="radio" name={q.id} checked={answers[q.id] === i} onChange={() => choose(q.id, i)} />
                  <span>{c}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </section>

      {error ? <div className="note error" role="alert">{error}</div> : null}
      <div className="row">
        <button className="btn big" disabled={sending} onClick={() => void submit(false)}>
          {sending ? 'جارٍ التسليم…' : 'سلّم الإجابات'}
        </button>
        {answered < attempt.questions.length ? <span className="mark">باقي {num(attempt.questions.length - answered)} سؤال بدون إجابة</span> : null}
      </div>
    </>
  );
}

function Result({ attempt }: { attempt: Extract<Attempt, { state: 'SUBMITTED' }> }) {
  const pct = attempt.released && attempt.maxScore ? Math.round(((attempt.score ?? 0) / attempt.maxScore) * 100) : null;
  return (
    <>
      <div className="row-between">
        <h1>{attempt.title}</h1>
        <Link href="/family/exams">كل الامتحانات</Link>
      </div>
      <div className="stamp-zone">
        {attempt.released ? (
          <Stamp
            tone={pct !== null && pct >= 50 ? 'ok' : 'bad'}
            word={`${attempt.score} / ${attempt.maxScore}`}
            sub={`${num(pct ?? 0)}%${attempt.late ? '، سُلّم متأخرًا' : ''}`}
          />
        ) : (
          <Stamp tone="neutral" word="تم التسليم" sub="تظهر الدرجة بعد أن يغلق المدرس الامتحان" />
        )}
      </div>
      {attempt.questions?.length ? (
        <section className="panel">
          {attempt.questions.map((q) => (
            <article key={q.id} className="question">
              <div className="q">{num(q.n)}. {q.body}</div>
              <div className="choices">
                {q.choices.map((c, i) => {
                  const cls = q.modelAnswer === i ? 'right' : q.chosen === i && !q.correct ? 'wrong' : undefined;
                  return (
                    <label key={i} className={cls}>
                      <input type="radio" disabled checked={q.chosen === i} readOnly />
                      <span>{c}</span>
                      {q.chosen === i ? <span className="faint">(إجابتك)</span> : null}
                    </label>
                  );
                })}
              </div>
              {q.modelAnswer === null ? (
                <p className="faint">{q.correct ? 'إجابة صحيحة' : q.chosen === null ? 'لم تُجب' : 'إجابة خاطئة'}، والإجابة النموذجية تظهر بعد إغلاق الامتحان.</p>
              ) : null}
            </article>
          ))}
        </section>
      ) : null}
    </>
  );
}
