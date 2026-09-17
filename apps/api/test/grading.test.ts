import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOrder, grade, itemAnalysis, mapAnswers } from '../src/exams/grading';

const qs = [
  { id: 'q1', correctIndex: 2, points: 1, choiceCount: 4 },
  { id: 'q2', correctIndex: 0, points: 2, choiceCount: 2 },
  { id: 'q3', correctIndex: 3, points: 1, choiceCount: 4 },
];

test('الترتيب ثابت لنفس البذرة ومختلف بين الطلاب', () => {
  const a = buildOrder(qs, 'exam:s1', true);
  assert.deepEqual(a, buildOrder(qs, 'exam:s1', true));
  assert.equal(a.length, 3);
  for (const o of a) assert.deepEqual([...o.perm].sort(), o.perm.map((_, i) => i));
});

test('التصحيح يعتمد على الاختيار الأصلي بعد التبديل', () => {
  const order = buildOrder(qs, 'exam:s2', true);
  const displayed: Record<string, number> = {};
  for (const o of order) {
    const q = qs.find((x) => x.id === o.id)!;
    displayed[o.id] = o.perm.indexOf(q.correctIndex);
  }
  const r = grade(qs, mapAnswers(order, displayed));
  assert.equal(r.score, 4);
  assert.equal(r.maxScore, 4);
});

test('الإجابات غير الصالحة تُعامل كفارغة', () => {
  const order = buildOrder(qs, 's', false);
  const mapped = mapAnswers(order, { q1: 9, q2: 'x', q3: -1 });
  assert.deepEqual(mapped, { q1: null, q2: null, q3: null });
});

test('تحليل الأسئلة', () => {
  const attempts = [
    { score: 4, results: { q1: true, q2: true } },
    { score: 3, results: { q1: true, q2: false } },
    { score: 1, results: { q1: false, q2: true } },
    { score: 0, results: { q1: false, q2: false } },
  ];
  const [s1] = itemAnalysis(attempts, ['q1', 'q2']);
  assert.equal(s1.facility, 0.5);
  assert.equal(s1.discrimination, 1);
});
