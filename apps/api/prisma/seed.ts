/**
 * بيانات تجريبية للتطوير فقط.
 * تعمل بحساب المالك (DATABASE_URL_UNPOOLED) لأن التطبيق نفسه مقيد بسياسات RLS.
 * كل الحسابات التجريبية كلمة مرورها: Hessa2026
 *   npm run db:seed            (يرفض إن وُجدت بيانات)
 *   npm run db:seed -- --force (يضيف فوق الموجود)
 */
import { PrismaClient, type Prisma } from '@prisma/client';
import { hashPassword } from '../src/auth/password';
import { generateSlots } from '../src/academics/schedule';
import { dueAfterDiscount, toDecimalString } from '../src/common/money';
import { addDays, cairoDateOf, cairoMonthOf, shiftMonth, weekdayOf } from '../src/common/time';

if (process.env.NODE_ENV === 'production') {
  console.error('لا تُشغَّل البيانات التجريبية في الإنتاج.');
  process.exit(1);
}
const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL_UNPOOLED غير مضبوط.');
  process.exit(1);
}
const prisma = new PrismaClient({ datasourceUrl: url });

const DEMO_PASSWORD = 'Hessa2026';
let demoHash: string | null = null;

// مولد ثابت حتى تتكرر نفس البيانات في كل تشغيل
let seed = 20260917;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = <T>(arr: readonly T[]) => arr[Math.floor(rand() * arr.length)];

const phone = (local: string) => `+20${local.slice(1)}`;
const usedCodes = new Set<string>();
const nextCode = () => {
  let code: string;
  do code = String(100000 + Math.floor(rand() * 900000));
  while (usedCodes.has(code));
  usedCodes.add(code);
  return code;
};

const FIRST = ['يوسف', 'مريم', 'عمر', 'نور', 'آدم', 'ملك', 'زياد', 'جنى', 'مازن', 'حبيبة', 'كريم', 'فريدة', 'سليم', 'لارا', 'حمزة', 'رنا', 'علي', 'تسنيم'];
const FATHERS = ['محمد', 'أحمد', 'مصطفى', 'خالد', 'طارق', 'إبراهيم', 'حسن', 'وليد', 'شريف', 'عادل'];
const FAMILY = ['عبد الله', 'السيد', 'منصور', 'الشافعي', 'رمضان', 'عثمان', 'فوزي', 'النجار', 'حافظ', 'سالم'];
const SCHOOLS = ['مدرسة النصر الثانوية', 'مدرسة الأورمان', 'مدرسة السعيدية', 'مدرسة الإبراهيمية'];

async function user(local: string, name: string, extra: Partial<Prisma.UserCreateInput> = {}) {
  demoHash ??= await hashPassword(DEMO_PASSWORD);
  // مالك المنصة يُنشأ غالبًا قبل البيانات التجريبية (db:migrate) بنفس اسم المستخدم: نستخدمه كما هو
  if (extra.username) {
    const existing = await prisma.user.findUnique({ where: { username: extra.username } });
    if (existing) return existing;
  }
  return prisma.user.upsert({
    where: { phone: phone(local) },
    update: {},
    create: {
      phone: phone(local), name, passwordHash: demoHash, mustChangePassword: false, lastLoginAt: new Date(), ...extra,
    },
  });
}

async function main() {
  const force = process.argv.includes('--force');
  if (!force && (await prisma.workspace.count()) > 0) {
    console.log('توجد بيانات بالفعل. استخدم --force للإضافة.');
    return;
  }

  const now = new Date();
  const today = cairoDateOf(now);
  const month = cairoMonthOf(now);
  const prevMonth = shiftMonth(month, -1);

  // ───── الحسابات
  await user('01000000000', 'إدارة منصة حصّة', { username: 'admin', isPlatformAdmin: true, platformRole: 'SUPER_ADMIN' });
  const owner = await user('01000000001', 'أ. هشام عبد الرحمن', { username: 'hesham' });
  const reception = await user('01000000002', 'منى سعيد', { username: 'mona' });
  const accountant = await user('01000000003', 'محمود فتحي', { username: 'mahmoud' });
  const tAhmed = await user('01000000004', 'أ. أحمد سمير', { username: 'ahmed' });
  const tSara = await user('01000000005', 'أ. سارة كمال', { username: 'sara' });
  const assistant = await user('01000000006', 'يوسف علي', { username: 'youssef' });
  const tKhaled = await user('01000000007', 'أ. خالد منصور', { username: 'khaled' });

  // ───── السنتر
  const center = await prisma.workspace.create({
    data: {
      type: 'CENTER', name: 'سنتر النور التعليمي', status: 'ACTIVE', plan: 'center-pro', receptionMaxDiscountPct: 10, lateAfterMinutes: 15,
      paidUntil: new Date(Date.now() + 60 * 86_400_000), governorate: 'الجيزة',
    },
  });
  const m = async (userId: string, role: Prisma.MembershipCreateManyInput['role'], supervisorMembershipId?: string) =>
    prisma.membership.create({ data: { workspaceId: center.id, userId, role, supervisorMembershipId } });
  await m(owner.id, 'OWNER');
  await m(reception.id, 'RECEPTION');
  await m(accountant.id, 'ACCOUNTANT');
  const mAhmed = await m(tAhmed.id, 'TEACHER');
  const mSara = await m(tSara.id, 'TEACHER');
  await m(assistant.id, 'ASSISTANT', mAhmed.id);

  const hall1 = await prisma.hall.create({ data: { workspaceId: center.id, name: 'قاعة 1', capacity: 60 } });
  const hall2 = await prisma.hall.create({ data: { workspaceId: center.id, name: 'قاعة 2', capacity: 40 } });

  const contractStart = new Date(`${shiftMonth(month, -3)}-01T00:00:00Z`);
  await prisma.teacherContract.create({
    data: { workspaceId: center.id, teacherMembershipId: mAhmed.id, type: 'PERCENTAGE', teacherPct: '70', startsOn: contractStart, notes: '70% للمدرس' },
  });
  await prisma.teacherContract.create({
    data: { workspaceId: center.id, teacherMembershipId: mSara.id, type: 'HALL_RENT_HOURLY', hourlyRent: '150.00', startsOn: contractStart },
  });
  await prisma.teacherAdvance.create({
    data: { workspaceId: center.id, teacherMembershipId: mAhmed.id, amount: '500.00', month, note: 'سلفة منتصف الشهر', createdById: owner.id },
  });

  // أقرب سبت قبل 3 أسابيع حتى تتضمن البيانات حصصًا ماضية وقادمة
  let start = addDays(today, -21);
  while (weekdayOf(start) !== 6) start = addDays(start, -1);

  const groupsSpec = [
    { teacher: mAhmed, hall: hall1, name: 'فيزياء 3ث — السبت والثلاثاء', subject: 'فيزياء', grade: '3 ثانوي', fee: 300, capacity: 40, days: [6, 2], time: '16:00', dur: 120 },
    { teacher: mAhmed, hall: hall1, name: 'فيزياء 2ث — الأحد والأربعاء', subject: 'فيزياء', grade: '2 ثانوي', fee: 250, capacity: 35, days: [0, 3], time: '18:00', dur: 90 },
    { teacher: mSara, hall: hall2, name: 'English 3ث — الاثنين والخميس', subject: 'لغة إنجليزية', grade: '3 ثانوي', fee: 280, capacity: 30, days: [1, 4], time: '17:00', dur: 90 },
  ];

  const groups: ((typeof groupsSpec)[number] & { group: { id: string } })[] = [];
  for (const g of groupsSpec) {
    const group = await prisma.group.create({
      data: {
        workspaceId: center.id, teacherMembershipId: g.teacher.id, name: g.name, subject: g.subject, grade: g.grade,
        capacity: g.capacity, monthlyFee: toDecimalString(g.fee * 100), defaultHallId: g.hall.id,
      },
    });
    const slots = generateSlots({ startDate: start, weeks: 6, weekdays: g.days, startTime: g.time, durationMin: g.dur });
    await prisma.classSession.createMany({
      data: slots.map((s) => ({
        workspaceId: center.id, groupId: group.id, hallId: g.hall.id, startsAt: s.startsAt, endsAt: s.endsAt,
        status: s.endsAt < now ? ('CLOSED' as const) : ('SCHEDULED' as const),
        openedAt: s.endsAt < now ? s.startsAt : null,
        closedAt: s.endsAt < now ? s.endsAt : null,
      })),
    });
    groups.push({ ...g, group });
  }

  // ───── الطلاب وأولياء الأمور
  const guardians: { id: string; name: string }[] = [];
  for (let i = 0; i < 12; i++) {
    const father = `${FATHERS[i % FATHERS.length]} ${FAMILY[i % FAMILY.length]}`;
    guardians.push(await user(`011000000${String(i + 1).padStart(2, '0')}`, father));
  }

  let receiptSeq = 0;
  const shift = await prisma.cashShift.create({
    data: {
      workspaceId: center.id, openedById: reception.id, openingBalance: '500.00', openedAt: new Date(now.getTime() - 5 * 86_400_000),
      closedAt: new Date(now.getTime() - 5 * 86_400_000 + 8 * 3_600_000), status: 'CLOSED',
      expectedCash: '0.00', countedCash: '0.00', variance: '0.00',
    },
  });
  let shiftCash = 0;

  const enrollmentsByGroup = new Map<string, { enrollmentId: string; studentId: string }[]>();
  for (let i = 0; i < 18; i++) {
    const guardian = guardians[i % guardians.length];
    const g = groups[i % groups.length];
    const fullName = `${FIRST[i]} ${guardian.name}`;
    const student = await prisma.student.create({
      data: { fullName, grade: g.grade, school: pick(SCHOOLS), guardianUserId: guardian.id, createdInWorkspaceId: center.id },
    });
    const discountPct = i % 7 === 0 ? 10 : 0;
    const enrollment = await prisma.enrollment.create({
      data: {
        workspaceId: center.id, studentId: student.id, groupId: g.group.id, code: nextCode(), discountPct,
        guardianConsentAt: i % 4 === 0 ? null : new Date(),
      },
    });
    // الطلاب ذوو الترتيب الفردي يحضرون أيضًا مجموعة ثانية
    if (i % 5 === 1) {
      const other = groups.find((x) => x.grade === g.grade && x.group.id !== g.group.id);
      if (other) {
        const e2 = await prisma.enrollment.create({
          data: { workspaceId: center.id, studentId: student.id, groupId: other.group.id, code: nextCode(), guardianConsentAt: new Date() },
        });
        enrollmentsByGroup.set(other.group.id, [...(enrollmentsByGroup.get(other.group.id) ?? []), { enrollmentId: e2.id, studentId: student.id }]);
      }
    }
    enrollmentsByGroup.set(g.group.id, [...(enrollmentsByGroup.get(g.group.id) ?? []), { enrollmentId: enrollment.id, studentId: student.id }]);
  }

  // ───── الحضور والإيصالات
  for (const g of groups) {
    const list = enrollmentsByGroup.get(g.group.id) ?? [];
    const past = await prisma.classSession.findMany({ where: { groupId: g.group.id, status: 'CLOSED' } });
    await prisma.attendance.createMany({
      data: past.flatMap((s) =>
        list.map((e) => {
          const r = rand();
          const status = r < 0.1 ? ('ABSENT' as const) : r < 0.22 ? ('LATE' as const) : ('PRESENT' as const);
          const offset = status === 'LATE' ? 20 : Math.round(rand() * 10) - 10;
          return {
            workspaceId: center.id, sessionId: s.id, studentId: e.studentId, status,
            method: status === 'ABSENT' ? ('AUTO' as const) : pick(['QR_CARD', 'QR_DYNAMIC', 'CODE'] as const),
            recordedAt: new Date(s.startsAt.getTime() + offset * 60_000),
            recordedById: status === 'ABSENT' ? null : reception.id,
          };
        }),
      ),
    });

    for (const e of list) {
      const enr = await prisma.enrollment.findUniqueOrThrow({ where: { id: e.enrollmentId } });
      const due = dueAfterDiscount(g.fee * 100, enr.discountPct);
      for (const [mo, prob] of [[prevMonth, 0.95], [month, 0.65]] as const) {
        if (rand() > prob) continue;
        const partial = mo === month && rand() < 0.2;
        const amount = partial ? Math.round(due / 2) : due;
        const cash = rand() < 0.8;
        const createdAt = mo === month ? new Date(now.getTime() - (5 * 86_400_000 - 3_600_000)) : new Date(`${mo}-03T10:00:00Z`);
        receiptSeq++;
        await prisma.receipt.create({
          data: {
            workspaceId: center.id, number: receiptSeq, studentId: e.studentId, enrollmentId: e.enrollmentId,
            amount: toDecimalString(amount), method: cash ? 'CASH' : 'WALLET', forMonth: mo,
            issuedById: reception.id, createdAt, shiftId: mo === month ? shift.id : null,
          },
        });
        if (mo === month && cash) shiftCash += amount;
      }
    }
  }
  await prisma.expense.create({
    data: { workspaceId: center.id, shiftId: shift.id, amount: '120.00', category: 'بوفيه وأدوات', note: 'مياه وأقلام', createdById: reception.id },
  });
  const expected = 50000 + shiftCash - 12000;
  await prisma.cashShift.update({
    where: { id: shift.id },
    data: { expectedCash: toDecimalString(expected), countedCash: toDecimalString(expected - 2000), variance: toDecimalString(-2000), closeNote: 'عجز 20 جنيه قيد المراجعة' },
  });
  // طلب إلغاء معلق ليظهر في لوحة المدير
  const lastReceipt = await prisma.receipt.findFirst({ where: { workspaceId: center.id, forMonth: month }, orderBy: { number: 'desc' } });
  if (lastReceipt) {
    await prisma.receipt.update({
      where: { id: lastReceipt.id },
      data: { status: 'CANCEL_REQUESTED', cancelReason: 'تم التحصيل مرتين بالخطأ', cancelRequestedById: reception.id },
    });
  }
  await prisma.workspace.update({ where: { id: center.id }, data: { receiptSeq } });

  // ───── بنك أسئلة وامتحان منشور
  const physics = groups[0];
  const qs: [string, string[], number, string][] = [
    ['وحدة قياس شدة التيار الكهربي هي', ['الفولت', 'الأمبير', 'الأوم', 'الوات'], 1, 'الكهربية التيارية'],
    ['المقاومة الكهربية لموصل تتناسب طرديًا مع', ['مساحة المقطع', 'طوله', 'شدة التيار', 'فرق الجهد'], 1, 'الكهربية التيارية'],
    ['قانون أوم يربط بين', ['القوة والكتلة', 'الجهد والتيار والمقاومة', 'الشحنة والزمن فقط', 'القدرة والطاقة'], 1, 'الكهربية التيارية'],
    ['عند توصيل مقاومات على التوالي فإن', ['الجهد ثابت', 'التيار ثابت', 'المقاومة الكلية تقل', 'القدرة ثابتة'], 1, 'الكهربية التيارية'],
    ['اتجاه المجال المغناطيسي حول سلك مستقيم يُحدد بقاعدة', ['اليد اليمنى لأمبير', 'فليمنج لليد اليسرى', 'لنز', 'كيرشوف'], 0, 'التأثير المغناطيسي'],
    ['وحدة كثافة الفيض المغناطيسي', ['ويبر', 'تسلا', 'هنري', 'كولوم'], 1, 'التأثير المغناطيسي'],
    ['تعمل فكرة الموتور الكهربي على', ['الحث الذاتي', 'عزم الازدواج على ملف', 'التأثير الحراري', 'الانعكاس'], 1, 'التأثير المغناطيسي'],
    ['قاعدة لنز هي تطبيق لقانون', ['بقاء الطاقة', 'بقاء الكتلة', 'الجذب العام', 'بويل'], 0, 'الحث الكهرومغناطيسي'],
    ['تزداد القوة الدافعة المستحثة بزيادة', ['مقاومة الملف', 'معدل تغير الفيض', 'زمن التغير', 'درجة الحرارة'], 1, 'الحث الكهرومغناطيسي'],
    ['المحول الرافع يرفع', ['التيار', 'الجهد', 'القدرة', 'التردد'], 1, 'الحث الكهرومغناطيسي'],
  ];
  const created: { id: string }[] = [];
  for (const [body, choices, correctIndex, unit] of qs) {
    created.push(
      await prisma.question.create({
        data: { workspaceId: center.id, ownerMembershipId: mAhmed.id, subject: 'فيزياء', grade: '3 ثانوي', unit, type: 'MCQ', body, choices, correctIndex, difficulty: 1 + Math.floor(rand() * 3) },
      }),
    );
  }
  created.push(
    await prisma.question.create({
      data: { workspaceId: center.id, ownerMembershipId: mAhmed.id, subject: 'فيزياء', grade: '3 ثانوي', unit: 'الكهربية التيارية', type: 'TRUE_FALSE', body: 'الأميتر يوصل على التوازي في الدائرة', choices: ['صح', 'خطأ'], correctIndex: 1 },
    }),
  );
  const exam = await prisma.exam.create({
    data: {
      workspaceId: center.id, groupId: physics.group.id, title: 'اختبار الكهربية — الأسبوع الثالث', durationMin: 20,
      opensAt: new Date(now.getTime() - 3_600_000), closesAt: new Date(now.getTime() + 3 * 86_400_000), status: 'PUBLISHED', createdById: tAhmed.id,
    },
  });
  await prisma.examQuestion.createMany({
    data: created.map((q, position) => ({ examId: exam.id, questionId: q.id, workspaceId: center.id, position, points: 1 })),
  });

  // ───── مدرس خاص يشترك معه طالب من السنتر (نفس الهوية)
  const teacherWs = await prisma.workspace.create({ data: { type: 'TEACHER', name: 'أ. خالد منصور — رياضيات', status: 'TRIAL', trialEndsAt: new Date(now.getTime() + 20 * 86_400_000) } });
  const mKhaled = await prisma.membership.create({ data: { workspaceId: teacherWs.id, userId: tKhaled.id, role: 'OWNER' } });
  const math = await prisma.group.create({
    data: { workspaceId: teacherWs.id, teacherMembershipId: mKhaled.id, name: 'رياضيات 3ث — مجموعة البيت', subject: 'رياضيات', grade: '3 ثانوي', capacity: 12, monthlyFee: '400.00' },
  });
  const mathSlots = generateSlots({ startDate: start, weeks: 6, weekdays: [5], startTime: '11:00', durationMin: 120 });
  await prisma.classSession.createMany({
    data: mathSlots.map((s) => ({ workspaceId: teacherWs.id, groupId: math.id, startsAt: s.startsAt, endsAt: s.endsAt, status: s.endsAt < now ? ('CLOSED' as const) : ('SCHEDULED' as const) })),
  });
  const shared = await prisma.student.findFirstOrThrow({ where: { guardianUserId: guardians[0].id, grade: '3 ثانوي' } });
  await prisma.enrollment.create({ data: { workspaceId: teacherWs.id, studentId: shared.id, groupId: math.id, code: nextCode(), guardianConsentAt: new Date() } });
  await prisma.receipt.create({
    data: { workspaceId: teacherWs.id, number: 1, studentId: shared.id, enrollmentId: (await prisma.enrollment.findFirstOrThrow({ where: { workspaceId: teacherWs.id, studentId: shared.id } })).id, amount: '400.00', method: 'WALLET', forMonth: month, issuedById: tKhaled.id },
  });
  await prisma.workspace.update({ where: { id: teacherWs.id }, data: { receiptSeq: 1 } });

  console.log('\nتم إنشاء البيانات التجريبية ✔');
  console.log(`كلمة المرور لكل الحسابات: ${DEMO_PASSWORD}`);
  console.table([
    { الدور: 'مالك المنصة (لوحة الإدارة)', الدخول: 'admin (كلمة مروره من BOOTSTRAP_ADMIN_PASSWORD إن أُنشئ قبل البيانات التجريبية)' },
    { الدور: 'مالك السنتر', الدخول: 'hesham' },
    { الدور: 'الاستقبال', الدخول: 'mona' },
    { الدور: 'المحاسب', الدخول: 'mahmoud' },
    { الدور: 'مدرس (فيزياء)', الدخول: 'ahmed' },
    { الدور: 'مدرسة (إنجليزي)', الدخول: 'sara' },
    { الدور: 'مساعد المدرس', الدخول: 'youssef' },
    { الدور: 'مدرس خاص (رياضيات)', الدخول: 'khaled' },
    { الدور: 'ولي أمر (ابن في السنتر وعند المدرس الخاص)', الدخول: '01100000001' },
  ]);
  console.log(`الإيصالات: ${receiptSeq} — الحصص الأولى تبدأ ${start}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
