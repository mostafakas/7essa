import type { Piasters } from '../common/money';

/**
 * محرك تسويات المدرس والسنتر — دالة بحتة قابلة للاختبار.
 *  PERCENTAGE        : المدرس يأخذ نسبة من المحصل
 *  HALL_RENT_HOURLY  : السنتر يأخذ إيجار القاعة بالساعة، والباقي للمدرس
 *  PER_STUDENT       : السنتر يأخذ مبلغًا ثابتًا عن كل طالب دافع
 *  MIXED             : نسبة بحد أدنى للسنتر عن كل طالب دافع (الأعلى بينهما)
 */
export type ContractTerms =
  | { type: 'PERCENTAGE'; teacherPct: number }
  | { type: 'HALL_RENT_HOURLY'; hourlyRent: Piasters }
  | { type: 'PER_STUDENT'; perStudent: Piasters }
  | { type: 'MIXED'; teacherPct: number; perStudent: Piasters };

export interface SettlementInput {
  gross: Piasters;
  payingStudents: number;
  hoursUsed: number;
  advances: Piasters;
  terms: ContractTerms;
}

export interface SettlementLine {
  label: string;
  amount: Piasters;
}

export interface SettlementResult {
  gross: Piasters;
  centerShare: Piasters;
  teacherShare: Piasters;
  advancesDeducted: Piasters;
  advancesCarried: Piasters;
  net: Piasters;
  lines: SettlementLine[];
}

function assertNonNegative(name: string, v: number) {
  if (!Number.isFinite(v) || v < 0) throw new Error(`${name} يجب أن يكون رقمًا غير سالب`);
}

export function calculateSettlement(input: SettlementInput): SettlementResult {
  const { gross, payingStudents, hoursUsed, advances, terms } = input;
  assertNonNegative('المحصل', gross);
  assertNonNegative('عدد الطلاب', payingStudents);
  assertNonNegative('الساعات', hoursUsed);
  assertNonNegative('السلف', advances);

  const lines: SettlementLine[] = [{ label: 'إجمالي المحصل من طلاب المدرس', amount: gross }];
  let centerShare: Piasters;

  switch (terms.type) {
    case 'PERCENTAGE': {
      if (terms.teacherPct < 0 || terms.teacherPct > 100) throw new Error('نسبة المدرس بين 0 و100');
      centerShare = Math.round((gross * (100 - terms.teacherPct)) / 100);
      lines.push({ label: `نصيب السنتر (${100 - terms.teacherPct}%)`, amount: -centerShare });
      break;
    }
    case 'HALL_RENT_HOURLY': {
      assertNonNegative('إيجار الساعة', terms.hourlyRent);
      centerShare = Math.round(hoursUsed * terms.hourlyRent);
      lines.push({ label: `إيجار القاعة (${hoursUsed} ساعة)`, amount: -centerShare });
      break;
    }
    case 'PER_STUDENT': {
      assertNonNegative('مبلغ الطالب', terms.perStudent);
      centerShare = payingStudents * terms.perStudent;
      lines.push({ label: `نصيب السنتر (${payingStudents} طالب × مبلغ ثابت)`, amount: -centerShare });
      break;
    }
    case 'MIXED': {
      if (terms.teacherPct < 0 || terms.teacherPct > 100) throw new Error('نسبة المدرس بين 0 و100');
      const byPct = Math.round((gross * (100 - terms.teacherPct)) / 100);
      const floor = payingStudents * terms.perStudent;
      centerShare = Math.max(byPct, floor);
      lines.push({
        label: byPct >= floor
          ? `نصيب السنتر بالنسبة (${100 - terms.teacherPct}%)`
          : `نصيب السنتر بالحد الأدنى (${payingStudents} طالب)`,
        amount: -centerShare,
      });
      break;
    }
  }

  // قد يكون سالبًا في صيغة الإيجار إذا لم يغطِ المحصل الإيجار
  const teacherShare = gross - centerShare;
  const advancesDeducted = Math.min(advances, Math.max(teacherShare, 0));
  const advancesCarried = advances - advancesDeducted;
  if (advancesDeducted > 0) lines.push({ label: 'خصم السلف', amount: -advancesDeducted });
  const net = teacherShare - advancesDeducted;
  lines.push({ label: 'صافي المستحق للمدرس', amount: net });

  return { gross, centerShare, teacherShare, advancesDeducted, advancesCarried, net, lines };
}
