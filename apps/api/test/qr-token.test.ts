import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCardToken, makeDynamicToken, verifyToken, QR_STEP_SECONDS } from '../src/attendance/qr-token';

const SECRET = 'x'.repeat(48);
const ID = '3f2b8c1e-8d7a-4c1b-9e2f-0a1b2c3d4e5f';

test('الرمز المتغير صالح خلال نافذته', () => {
  const now = 1_800_000_000_000;
  const t = makeDynamicToken(SECRET, ID, 2, now);
  assert.deepEqual(verifyToken(SECRET, t, now + 30_000), { kind: 'dynamic', studentId: ID, cardVersion: 2 });
});

test('الرمز المتغير يُرفض بعد انتهاء النافذة', () => {
  const now = 1_800_000_000_000;
  const t = makeDynamicToken(SECRET, ID, 1, now);
  assert.equal(verifyToken(SECRET, t, now + 3 * QR_STEP_SECONDS * 1000), null);
});

test('أي تعديل على الرمز يبطله', () => {
  const t = makeCardToken(SECRET, ID, 1);
  assert.ok(verifyToken(SECRET, t));
  assert.equal(verifyToken(SECRET, t.replace('.1.', '.2.')), null);
  assert.equal(verifyToken('y'.repeat(48), t), null);
  assert.equal(verifyToken(SECRET, 'S.not-a-uuid.1.abc'), null);
  assert.equal(verifyToken(SECRET, 'garbage'), null);
});
