import assert from 'node:assert/strict';
import { test } from 'node:test';
import { billableHours, findConflicts, generateSlots } from '../src/academics/schedule';
import { attendanceStatusAt, discountWithinLimit, remainingDue, scanWindowOpen, subscriptionState } from '../src/finance/dues';

test('توليد الحصص الأسبوعية بتوقيت القاهرة', () => {
  // 2026-09-19 سبت، 2026-09-22 ثلاثاء
  const slots = generateSlots({ startDate: '2026-09-19', weeks: 2, weekdays: [6, 2], startTime: '16:00', durationMin: 90 });
  assert.equal(slots.length, 4);
  // سبتمبر: التوقيت الصيفي في مصر (UTC+3) ينتهي آخر خميس في أكتوبر
  assert.equal(slots[0].startsAt.toISOString(), '2026-09-19T13:00:00.000Z');
  assert.equal(slots[0].endsAt.toISOString(), '2026-09-19T14:30:00.000Z');
  assert.ok(slots.every((s, i) => i === 0 || s.startsAt > slots[i - 1].startsAt));
});

test('التوقيت الشتوي بعد انتهاء الصيفي', () => {
  const [s] = generateSlots({ startDate: '2026-12-05', weeks: 1, weekdays: [6], startTime: '16:00', durationMin: 60 });
  assert.equal(s.startsAt.toISOString(), '2026-12-05T14:00:00.000Z');
});

test('رفض المدخلات غير الصحيحة', () => {
  assert.throws(() => generateSlots({ startDate: '2026-09-19', weeks: 0, weekdays: [1], startTime: '10:00', durationMin: 60 }));
  assert.throws(() => generateSlots({ startDate: '2026-09-19', weeks: 1, weekdays: [], startTime: '10:00', durationMin: 60 }));
  assert.throws(() => generateSlots({ startDate: '2026-09-19', weeks: 1, weekdays: [9], startTime: '10:00', durationMin: 60 }));
  assert.throws(() => generateSlots({ startDate: '2026-09-19', weeks: 1, weekdays: [1], startTime: '25:00', durationMin: 60 }));
});

test('كشف تعارض القاعات', () => {
  const t = (h: number, m = 0) => new Date(Date.UTC(2026, 8, 20, h, m));
  const existing = [{ id: 'a', startsAt: t(10), endsAt: t(11, 30) }];
  const conflicts = findConflicts(
    [
      { startsAt: t(10, 30), endsAt: t(11, 15) }, // يتداخل
      { startsAt: t(11, 30), endsAt: t(12, 30) }, // يبدأ عند النهاية تمامًا: لا تعارض
    ],
    existing,
  );
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].with.id, 'a');
  assert.throws(() => findConflicts([{ startsAt: t(8), endsAt: t(9) }, { startsAt: t(8, 30), endsAt: t(9, 30) }], []));
  assert.equal(billableHours([{ startsAt: t(10), endsAt: t(11, 30) }, { startsAt: t(12), endsAt: t(12, 50) }]), 2.25);
});

test('المتبقي على الطالب وحالة الاشتراك', () => {
  assert.equal(remainingDue({ monthlyFee: 30000, discountPct: 10, paid: 20000, discounted: 0 }), 7000);
  assert.equal(remainingDue({ monthlyFee: 30000, discountPct: 0, paid: 25000, discounted: 5000 }), 0);
  assert.equal(remainingDue({ monthlyFee: 30000, discountPct: 0, paid: 40000, discounted: 0 }), 0);
  assert.equal(subscriptionState('ACTIVE', 0), 'OK');
  assert.equal(subscriptionState('ACTIVE', 100), 'DUES');
  assert.equal(subscriptionState('SUSPENDED', 0), 'SUSPENDED');
});

test('حد الخصم والتأخير ونافذة المسح', () => {
  assert.equal(discountWithinLimit(30000, 3000, 10), true);
  assert.equal(discountWithinLimit(30000, 3001, 10), false);
  assert.equal(discountWithinLimit(0, 1, 100), false);
  const start = new Date('2026-09-20T13:00:00Z');
  const end = new Date('2026-09-20T14:30:00Z');
  assert.equal(attendanceStatusAt(start, new Date('2026-09-20T13:15:00Z'), 15), 'PRESENT');
  assert.equal(attendanceStatusAt(start, new Date('2026-09-20T13:15:01Z'), 15), 'LATE');
  assert.equal(scanWindowOpen(start, end, new Date('2026-09-20T12:44:00Z')), false);
  assert.equal(scanWindowOpen(start, end, new Date('2026-09-20T12:45:00Z')), true);
  assert.equal(scanWindowOpen(start, end, new Date('2026-09-20T15:31:00Z')), false);
});

import { cairoMonthOf, monthWithin, shiftMonth } from '../src/common/time';

test('إزاحة الأشهر ونافذة التحصيل', () => {
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-09', -21), '2024-12');
  assert.throws(() => shiftMonth('2026-13', 1));
  const now = new Date('2026-09-30T22:30:00Z'); // 1 أكتوبر بتوقيت القاهرة
  assert.equal(cairoMonthOf(now), '2026-10');
  assert.equal(monthWithin('2026-10', now, 12, 3), true);
  assert.equal(monthWithin('2027-01', now, 12, 3), true);
  assert.equal(monthWithin('2027-02', now, 12, 3), false);
  assert.equal(monthWithin('2025-10', now, 12, 3), true);
  assert.equal(monthWithin('2025-09', now, 12, 3), false);
  assert.equal(monthWithin('bad', now, 12, 3), false);
});
