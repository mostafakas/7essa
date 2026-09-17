import { createHash } from 'node:crypto';

export interface OrderedQuestion {
  /** معرف السؤال */
  id: string;
  /** perm[i] = رقم الاختيار الأصلي المعروض في الموضع i */
  perm: number[];
}

export interface GradableQuestion {
  id: string;
  correctIndex: number;
  points: number;
  choiceCount: number;
}

/** مولد أرقام شبه عشوائية حتمي من بذرة نصية (Mulberry32) */
function rng(seed: string): () => number {
  let a = createHash('sha256').update(seed).digest().readUInt32LE(0);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffled<T>(items: readonly T[], seed: string): T[] {
  const out = [...items];
  const next = rng(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** ترتيب أسئلة واختيارات خاص بكل طالب، ثابت لنفس (الامتحان، الطالب) */
export function buildOrder(questions: GradableQuestion[], seed: string, shuffle: boolean): OrderedQuestion[] {
  const qs = shuffle ? shuffled(questions, `${seed}:q`) : questions;
  return qs.map((q) => {
    const base = Array.from({ length: q.choiceCount }, (_, i) => i);
    return { id: q.id, perm: shuffle ? shuffled(base, `${seed}:${q.id}`) : base };
  });
}

/** يحول إجابات الطالب (بترتيب العرض) إلى أرقام الاختيارات الأصلية بعد التحقق */
export function mapAnswers(
  order: OrderedQuestion[],
  displayed: Record<string, unknown>,
): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const q of order) {
    const v = displayed[q.id];
    out[q.id] = Number.isInteger(v) && (v as number) >= 0 && (v as number) < q.perm.length ? q.perm[v as number] : null;
  }
  return out;
}

export function grade(questions: GradableQuestion[], answers: Record<string, number | null>) {
  let score = 0;
  let maxScore = 0;
  const results: Record<string, boolean> = {};
  for (const q of questions) {
    maxScore += q.points;
    const ok = answers[q.id] === q.correctIndex;
    results[q.id] = ok;
    if (ok) score += q.points;
  }
  return { score, maxScore, results };
}

export interface ItemStats {
  questionId: string;
  answered: number;
  /** معامل السهولة: نسبة من أجابوا صحيحًا */
  facility: number;
  /** معامل التمييز: الفرق بين أعلى 27% وأدنى 27% */
  discrimination: number;
}

/** تحليل الأسئلة بعد الامتحان */
export function itemAnalysis(
  attempts: { score: number; results: Record<string, boolean> }[],
  questionIds: string[],
): ItemStats[] {
  const n = attempts.length;
  const sorted = [...attempts].sort((a, b) => b.score - a.score);
  const k = Math.max(1, Math.round(n * 0.27));
  const top = sorted.slice(0, k);
  const bottom = sorted.slice(-k);
  const rate = (group: typeof attempts, id: string) =>
    group.length ? group.filter((a) => a.results[id]).length / group.length : 0;
  return questionIds.map((id) => ({
    questionId: id,
    answered: n,
    facility: n ? Number(rate(attempts, id).toFixed(2)) : 0,
    discrimination: n >= 2 ? Number((rate(top, id) - rate(bottom, id)).toFixed(2)) : 0,
  }));
}
