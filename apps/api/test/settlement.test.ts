import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateSettlement } from '../src/settlements/settlement.calc';

test('نسبة مئوية: المدرس 70%', () => {
  const r = calculateSettlement({ gross: 1_000_000, payingStudents: 40, hoursUsed: 16, advances: 0, terms: { type: 'PERCENTAGE', teacherPct: 70 } });
  assert.equal(r.centerShare, 300_000);
  assert.equal(r.teacherShare, 700_000);
  assert.equal(r.net, 700_000);
});

test('إيجار قاعة بالساعة مع سلفة', () => {
  const r = calculateSettlement({ gross: 800_000, payingStudents: 30, hoursUsed: 12.5, advances: 100_000, terms: { type: 'HALL_RENT_HOURLY', hourlyRent: 15_000 } });
  assert.equal(r.centerShare, 187_500);
  assert.equal(r.teacherShare, 612_500);
  assert.equal(r.advancesDeducted, 100_000);
  assert.equal(r.net, 512_500);
});

test('مبلغ ثابت لكل طالب', () => {
  const r = calculateSettlement({ gross: 600_000, payingStudents: 20, hoursUsed: 0, advances: 0, terms: { type: 'PER_STUDENT', perStudent: 5_000 } });
  assert.equal(r.centerShare, 100_000);
  assert.equal(r.net, 500_000);
});

test('مختلط: يُطبق الحد الأدنى عندما يكون أعلى من النسبة', () => {
  const r = calculateSettlement({ gross: 300_000, payingStudents: 25, hoursUsed: 0, advances: 0, terms: { type: 'MIXED', teacherPct: 85, perStudent: 3_000 } });
  // النسبة = 45,000 قرش، الحد الأدنى = 75,000 قرش
  assert.equal(r.centerShare, 75_000);
  assert.equal(r.teacherShare, 225_000);
});

test('السلفة الأكبر من المستحق تُرحّل ولا تجعل الصافي سالبًا', () => {
  const r = calculateSettlement({ gross: 100_000, payingStudents: 5, hoursUsed: 0, advances: 150_000, terms: { type: 'PERCENTAGE', teacherPct: 60 } });
  assert.equal(r.advancesDeducted, 60_000);
  assert.equal(r.advancesCarried, 90_000);
  assert.equal(r.net, 0);
});

test('إيجار أعلى من المحصل يظهر صافيًا سالبًا دون خصم سلف', () => {
  const r = calculateSettlement({ gross: 50_000, payingStudents: 2, hoursUsed: 10, advances: 20_000, terms: { type: 'HALL_RENT_HOURLY', hourlyRent: 10_000 } });
  assert.equal(r.teacherShare, -50_000);
  assert.equal(r.advancesDeducted, 0);
  assert.equal(r.net, -50_000);
});

test('يرفض القيم غير الصالحة', () => {
  assert.throws(() => calculateSettlement({ gross: -1, payingStudents: 0, hoursUsed: 0, advances: 0, terms: { type: 'PERCENTAGE', teacherPct: 50 } }));
  assert.throws(() => calculateSettlement({ gross: 1, payingStudents: 0, hoursUsed: 0, advances: 0, terms: { type: 'PERCENTAGE', teacherPct: 120 } }));
});
