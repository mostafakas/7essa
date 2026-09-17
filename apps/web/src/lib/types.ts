/** أشكال ردود الـAPI المستخدمة في الواجهة (المبالغ المحسوبة بالقرش، وحقول Decimal نصية) */

export type DueState = 'OK' | 'DUES' | 'SUSPENDED';
export interface DueView {
  state: DueState;
  remaining?: number;
}

export interface TodaySession {
  id: string;
  startsAt: string;
  endsAt: string;
  status: 'SCHEDULED' | 'OPEN' | 'CLOSED' | 'CANCELLED';
  hall: string | null;
  group: string;
  subject: string;
  grade: string;
  teacherName: string;
  enrolled: number;
  present: number;
}

export interface SessionRow {
  id: string;
  startsAt: string;
  endsAt: string;
  status: TodaySession['status'];
  cancelReason: string | null;
  hall: { id: string; name: string } | null;
  group: { id: string; name: string; subject: string; grade: string };
  teacherName: string;
  attendanceCount: number;
}

export interface ScanResult {
  ok: true;
  duplicate: boolean;
  studentId: string;
  studentName: string;
  group: string;
  status: 'PRESENT' | 'LATE' | 'ABSENT';
  enrollmentStatus: string;
  due?: DueView;
}

export interface GroupRow {
  id: string;
  name: string;
  subject: string;
  grade: string;
  system: string;
  capacity: number;
  monthlyFee: string;
  defaultHallId: string | null;
  archived: boolean;
  teacherMembershipId: string;
  teacherName: string;
  activeStudents: number;
  waitlist: number;
}

export interface Hall {
  id: string;
  name: string;
  capacity: number;
}

export interface StudentListItem {
  enrollmentId: string;
  studentId: string;
  code: string;
  status: 'ACTIVE' | 'WAITLIST' | 'SUSPENDED' | 'LEFT';
  discountPct: number;
  consent: boolean;
  fullName: string;
  grade: string;
  school: string | null;
  guardianName: string;
  guardianPhone: string;
  group: { id: string; name: string; subject: string };
  due?: DueView;
}

export interface Receipt {
  id: string;
  number: number;
  amount: string;
  discountAmount: string;
  method: string;
  forMonth: string;
  status: 'VALID' | 'CANCEL_REQUESTED' | 'CANCELLED';
  cancelReason: string | null;
  createdAt: string;
  student?: string;
  code?: string;
  group?: string;
  mine?: boolean;
}

export interface ShiftTotals {
  opening: number;
  methods: Record<string, { amount: number; count: number }>;
  cashIn: number;
  expenses: number;
  expectedCash: number;
}

export interface Shift {
  id: string;
  status: 'OPEN' | 'CLOSED' | 'APPROVED';
  openingBalance: string;
  openedAt: string;
  closedAt: string | null;
  expectedCash: string | null;
  countedCash: string | null;
  variance: string | null;
  closeNote: string | null;
  openedBy?: string;
  openedById: string;
}

export interface SettlementView {
  id: string;
  month: string;
  teacherMembershipId: string;
  teacherName?: string;
  contractType: string;
  grossCollected: string;
  payingStudents: number;
  hoursUsed: string;
  teacherShare: string;
  centerShare: string;
  advancesDeducted: string;
  net: string;
  lines: { label: string; amount: number }[];
  advancesCarried: number;
  pendingCancellations: number;
  receipts: number;
  status: 'DRAFT' | 'TEACHER_CONFIRMED' | 'DISPUTED' | 'APPROVED' | 'PAID';
  disputeNote: string | null;
  confirmedAt: string | null;
  approvedAt: string | null;
  paidAt: string | null;
  paymentMethod: string | null;
  updatedAt: string;
}

export interface Member {
  membershipId: string;
  role: string;
  status: 'ACTIVE' | 'DISABLED';
  supervisorMembershipId: string | null;
  name: string;
  phone: string;
  activated: boolean;
  isMe: boolean;
}

export interface TeacherOption {
  membershipId: string;
  name: string;
  role: string;
}
