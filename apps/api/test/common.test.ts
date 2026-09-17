import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEgyptPhone } from '../src/common/phone';
import { cairoMonthRange, cairoToUtc, cairoMonthOf, weekdayOf } from '../src/common/time';
import { can, canAssignRole, teacherScopeOf } from '../src/common/permissions';
import { dueAfterDiscount, toDecimalString, toPiasters } from '../src/common/money';

test('تطبيع أرقام الموبايل المصرية', () => {
  for (const v of ['01012345678', '+201012345678', '00201012345678', '201012345678', '010 1234 5678', '٠١٠١٢٣٤٥٦٧٨']) {
    assert.equal(normalizeEgyptPhone(v), '+201012345678', v);
  }
  for (const v of ['01312345678', '0101234567', '12345', '+971501234567', '']) {
    assert.equal(normalizeEgyptPhone(v), null, v);
  }
});

test('توقيت القاهرة: شتوي وصيفي', () => {
  assert.equal(cairoToUtc('2027-01-10', '16:00').toISOString(), '2027-01-10T14:00:00.000Z');
  assert.equal(cairoToUtc('2027-07-10', '16:00').toISOString(), '2027-07-10T13:00:00.000Z');
  const r = cairoMonthRange('2027-12');
  assert.equal(r.start.toISOString(), '2027-11-30T22:00:00.000Z');
  assert.equal(r.end.toISOString(), '2027-12-31T22:00:00.000Z');
  assert.equal(cairoMonthOf(new Date('2027-11-30T23:30:00Z')), '2027-12');
  assert.equal(weekdayOf('2026-09-17'), 4);
});

test('مصفوفة الصلاحيات', () => {
  assert.ok(can('RECEPTION', 'finance.collect'));
  assert.ok(!can('RECEPTION', 'finance.cancel.approve'));
  assert.ok(!can('RECEPTION', 'finance.reports'));
  assert.ok(!can('TEACHER', 'finance.collect'));
  assert.ok(!can('ACCOUNTANT', 'settlements.approve'));
  assert.ok(can('ACCOUNTANT', 'settlements.pay'));
  assert.ok(!can('FOLLOWUP', 'attendance.record'));
  assert.ok(!canAssignRole('MANAGER', 'OWNER'));
  assert.equal(teacherScopeOf('ASSISTANT', 'a', 'b'), 'b');
  assert.equal(teacherScopeOf('MANAGER', 'a', null), null);
});

test('المال بالقرش', () => {
  assert.equal(toPiasters('350.50'), 35050);
  assert.equal(toDecimalString(35050), '350.50');
  assert.equal(toDecimalString(-5), '-0.05');
  assert.equal(dueAfterDiscount(40000, 15), 34000);
});
