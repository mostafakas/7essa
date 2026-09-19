import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateTempPassword, hashPassword, normalizeUsername, passwordProblem, verifyPassword } from '../src/auth/password';
import { accessOf } from '../src/common/access';
import { localPhone, maskPhone } from '../src/common/phone';
import { platformCan } from '../src/platform/platform-permissions';
import { addMonths } from '../src/platform/util';

test('تجزئة كلمات المرور والتحقق منها', async () => {
  const hash = await hashPassword('Nour2026');
  assert.match(hash, /^scrypt\$16384\$8\$1\$/);
  assert.ok(await verifyPassword('Nour2026', hash));
  assert.ok(!(await verifyPassword('nour2026', hash)));
  assert.ok(!(await verifyPassword('Nour2026', null)));
  assert.ok(!(await verifyPassword('Nour2026', 'plain-text')));
  // نفس الكلمة تعطي تجزئة مختلفة (ملح عشوائي)
  assert.notEqual(await hashPassword('Nour2026'), hash);
});

test('سياسة كلمة المرور والكلمات المؤقتة', () => {
  assert.equal(passwordProblem('Nour2026'), null);
  assert.equal(passwordProblem('نور2026ab'), null);
  assert.ok(passwordProblem('short1'));
  assert.ok(passwordProblem('onlyletters'));
  assert.ok(passwordProblem('12345678'));
  assert.ok(passwordProblem('Password1'));
  assert.ok(passwordProblem('Hessa2026'));
  for (let i = 0; i < 50; i++) {
    const p = generateTempPassword();
    assert.match(p, /^[a-hjkmnp-z]{4}-[2-9]{4}$/);
    assert.equal(passwordProblem(p), null);
  }
});

test('أسماء المستخدمين', () => {
  assert.equal(normalizeUsername('  Hesham.Nour '), 'hesham.nour');
  assert.equal(normalizeUsername('s-482913'), 's-482913');
  assert.equal(normalizeUsername('ab'), null);
  assert.equal(normalizeUsername('هشام'), null);
  assert.equal(normalizeUsername('.start'), null);
});

test('عرض الأرقام', () => {
  assert.equal(localPhone('+201012345678'), '01012345678');
  assert.equal(localPhone(null), '');
  assert.equal(maskPhone(null), '—');
  assert.equal(maskPhone('+201012345678'), '+2010*****678');
});

test('حالة الوصول حسب الاشتراك', () => {
  const now = new Date('2026-09-18T10:00:00Z');
  const day = 86_400_000;
  const at = (d: number) => new Date(now.getTime() + d * day);

  assert.deepEqual(accessOf({ status: 'TRIAL', trialEndsAt: at(5), paidUntil: null }, now, 7).mode, 'FULL');
  assert.equal(accessOf({ status: 'TRIAL', trialEndsAt: at(5), paidUntil: null }, now, 7).daysLeft, 5);
  assert.equal(accessOf({ status: 'TRIAL', trialEndsAt: at(-1), paidUntil: null }, now, 7).mode, 'READ_ONLY');
  assert.equal(accessOf({ status: 'TRIAL', trialEndsAt: at(-1), paidUntil: null }, now, 7).reason, 'TRIAL_ENDED');

  assert.equal(accessOf({ status: 'ACTIVE', trialEndsAt: null, paidUntil: null }, now, 7).mode, 'FULL');
  assert.equal(accessOf({ status: 'ACTIVE', trialEndsAt: null, paidUntil: at(10) }, now, 7).reason, 'ACTIVE');
  const grace = accessOf({ status: 'ACTIVE', trialEndsAt: null, paidUntil: at(-3) }, now, 7);
  assert.equal(grace.mode, 'FULL');
  assert.equal(grace.reason, 'GRACE');
  assert.equal(grace.daysLeft, 4);
  assert.equal(accessOf({ status: 'ACTIVE', trialEndsAt: null, paidUntil: at(-8) }, now, 7).mode, 'READ_ONLY');
  assert.equal(accessOf({ status: 'ACTIVE', trialEndsAt: null, paidUntil: at(-1) }, now, 0).reason, 'EXPIRED');

  assert.equal(accessOf({ status: 'PAUSED', trialEndsAt: null, paidUntil: at(30) }, now, 7).mode, 'READ_ONLY');
  assert.equal(accessOf({ status: 'SUSPENDED', trialEndsAt: null, paidUntil: at(30) }, now, 7).mode, 'BLOCKED');
});

test('إضافة الأشهر مع تثبيت آخر الشهر', () => {
  assert.equal(addMonths(new Date('2026-01-31T12:00:00Z'), 1).toISOString(), '2026-02-28T12:00:00.000Z');
  assert.equal(addMonths(new Date('2028-01-31T12:00:00Z'), 1).toISOString(), '2028-02-29T12:00:00.000Z');
  assert.equal(addMonths(new Date('2026-10-15T00:00:00Z'), 3).toISOString(), '2027-01-15T00:00:00.000Z');
  assert.equal(addMonths(new Date('2026-03-31T00:00:00Z'), 12).toISOString(), '2027-03-31T00:00:00.000Z');
});

test('صلاحيات فريق المنصة', () => {
  assert.ok(platformCan('SUPER_ADMIN', 'platform.admins.manage'));
  assert.ok(platformCan('SUPPORT', 'platform.users.manage'));
  assert.ok(!platformCan('SUPPORT', 'platform.billing.manage'));
  assert.ok(!platformCan('SUPPORT', 'platform.admins.manage'));
  assert.ok(platformCan('FINANCE', 'platform.billing.manage'));
  assert.ok(!platformCan('FINANCE', 'platform.users.manage'));
  assert.ok(platformCan('VIEWER', 'platform.read'));
  assert.ok(!platformCan('VIEWER', 'platform.workspaces.manage'));
});
