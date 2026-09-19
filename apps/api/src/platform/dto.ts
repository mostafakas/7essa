import { Type } from 'class-transformer';
import {
  IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min,
  ValidateNested,
} from 'class-validator';
import { ROLES, type RoleName } from '../common/permissions';
import { PLATFORM_ROLES, type PlatformRoleName } from './platform-permissions';

const WS_STATUS = ['TRIAL', 'ACTIVE', 'PAUSED', 'SUSPENDED'] as const;
const METHODS = ['CASH', 'WALLET', 'CARD', 'TRANSFER'] as const;
const MONEY = /^\d{1,10}(\.\d{1,2})?$/;

export class PageQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10_000)
  page?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(5) @Max(200)
  pageSize?: number;
}

// ───── مساحات العمل

export class ListWorkspacesQuery extends PageQuery {
  @IsOptional() @IsString() @MaxLength(80)
  q?: string;

  @IsOptional() @IsIn(WS_STATUS)
  status?: (typeof WS_STATUS)[number];

  @IsOptional() @IsIn(['CENTER', 'TEACHER'])
  type?: 'CENTER' | 'TEACHER';

  @IsOptional() @IsString() @MaxLength(30)
  plan?: string;

  @IsOptional() @IsIn(['trial_ending', 'trial_ended', 'expiring', 'expired'])
  due?: 'trial_ending' | 'trial_ended' | 'expiring' | 'expired';
}

export class NewUserDto {
  @IsString() @Length(2, 80)
  name!: string;

  @IsOptional() @IsString() @MaxLength(32)
  phone?: string;

  @IsOptional() @IsString() @MaxLength(32)
  username?: string;
}

export class CreateWorkspaceDto {
  @IsIn(['CENTER', 'TEACHER'])
  type!: 'CENTER' | 'TEACHER';

  @IsString() @Length(2, 80)
  name!: string;

  @IsOptional() @IsString() @MaxLength(30)
  plan?: string;

  @IsOptional() @IsIn(['TRIAL', 'ACTIVE'])
  status?: 'TRIAL' | 'ACTIVE';

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(365)
  trialDays?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(36)
  paidMonths?: number;

  @IsOptional() @IsString() @MaxLength(40)
  governorate?: string;

  @IsOptional() @IsString() @MaxLength(32)
  contactPhone?: string;

  @IsOptional() @IsUUID()
  ownerUserId?: string;

  @IsOptional() @ValidateNested() @Type(() => NewUserDto)
  owner?: NewUserDto;
}

export class UpdateWorkspaceDto {
  @IsOptional() @IsString() @Length(2, 80)
  name?: string;

  @IsOptional() @IsIn(['CENTER', 'TEACHER'])
  type?: 'CENTER' | 'TEACHER';

  @IsOptional() @IsIn(WS_STATUS)
  status?: (typeof WS_STATUS)[number];

  @IsOptional() @IsString() @MaxLength(300)
  suspendReason?: string | null;

  @IsOptional() @IsString() @MaxLength(30)
  plan?: string;

  @IsOptional() @IsDateString()
  trialEndsAt?: string | null;

  @IsOptional() @IsDateString()
  paidUntil?: string | null;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1_000_000)
  maxStudents?: number | null;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10_000)
  maxStaff?: number | null;

  @IsOptional() @IsString() @MaxLength(40)
  governorate?: string | null;

  @IsOptional() @IsString() @MaxLength(32)
  contactPhone?: string | null;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100)
  receptionMaxDiscountPct?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(120)
  lateAfterMinutes?: number;
}

export class ExtendTrialDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(365)
  days!: number;
}

export class AddMemberDto {
  @IsIn(ROLES)
  role!: RoleName;

  @IsOptional() @IsUUID()
  supervisorMembershipId?: string;

  @IsOptional() @IsUUID()
  userId?: string;

  @IsOptional() @ValidateNested() @Type(() => NewUserDto)
  newUser?: NewUserDto;
}

export class UpdateMemberDto {
  @IsOptional() @IsIn(ROLES)
  role?: RoleName;

  @IsOptional() @IsIn(['ACTIVE', 'DISABLED'])
  status?: 'ACTIVE' | 'DISABLED';

  @IsOptional() @IsUUID()
  supervisorMembershipId?: string;
}

export class NoteDto {
  @IsString() @Length(1, 2000)
  body!: string;
}

export class RecordPaymentDto {
  @Matches(MONEY, { message: 'المبلغ غير صالح' })
  amount!: string;

  @Type(() => Number) @IsInt() @Min(1) @Max(36)
  months!: number;

  @IsIn(METHODS)
  method!: (typeof METHODS)[number];

  @IsOptional() @IsDateString()
  paidAt?: string;

  @IsOptional() @IsString() @MaxLength(30)
  planCode?: string;

  @IsOptional() @IsString() @MaxLength(300)
  note?: string;
}

// ───── المستخدمون

export class ListUsersQuery extends PageQuery {
  @IsOptional() @IsString() @MaxLength(80)
  q?: string;

  @IsOptional() @IsIn(['ACTIVE', 'DISABLED'])
  status?: 'ACTIVE' | 'DISABLED';

  @IsOptional() @IsIn(['admin', 'staff', 'family', 'none', 'nopassword', 'locked', 'pending'])
  kind?: 'admin' | 'staff' | 'family' | 'none' | 'nopassword' | 'locked' | 'pending';
}

export class CreateUserDto extends NewUserDto {
  @IsOptional() @IsString() @Length(8, 128)
  password?: string;

  @IsOptional() @IsBoolean()
  mustChangePassword?: boolean;

  @IsOptional() @IsIn(PLATFORM_ROLES)
  platformRole?: PlatformRoleName;
}

export class UpdateUserDto {
  @IsOptional() @IsString() @Length(2, 80)
  name?: string;

  @IsOptional() @IsString() @MaxLength(32)
  phone?: string | null;

  @IsOptional() @IsString() @MaxLength(32)
  username?: string | null;

  @IsOptional() @IsIn(['ACTIVE', 'DISABLED'])
  status?: 'ACTIVE' | 'DISABLED';

  @IsOptional() @IsIn(PLATFORM_ROLES)
  platformRole?: PlatformRoleName | null;

  @IsOptional() @IsString() @MaxLength(2000)
  notes?: string | null;
}

export class ResetPasswordDto {
  @IsOptional() @IsString() @Length(8, 128)
  password?: string;

  @IsOptional() @IsBoolean()
  mustChangePassword?: boolean;
}

// ───── الخطط والمدفوعات

export class PlanDto {
  @IsOptional() @Matches(/^[a-z0-9-]{2,30}$/, { message: 'الكود: حروف إنجليزية صغيرة وأرقام وشرطة' })
  code?: string;

  @IsOptional() @IsString() @Length(2, 60)
  name?: string;

  @IsOptional() @Matches(MONEY, { message: 'السعر غير صالح' })
  monthlyPrice?: string;

  @IsOptional() @Matches(MONEY, { message: 'السعر غير صالح' })
  yearlyPrice?: string | null;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1_000_000)
  maxStudents?: number | null;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10_000)
  maxStaff?: number | null;

  @IsOptional() @IsString() @MaxLength(300)
  description?: string | null;

  @IsOptional() @IsBoolean()
  active?: boolean;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(1000)
  sortOrder?: number;
}

export class ListPaymentsQuery extends PageQuery {
  @IsOptional() @IsDateString()
  from?: string;

  @IsOptional() @IsDateString()
  to?: string;

  @IsOptional() @IsUUID()
  workspaceId?: string;
}

// ───── الإعلانات والإعدادات والسجل

const AUDIENCES = ['ALL', 'STAFF', 'OWNERS', 'FAMILIES'] as const;
const LEVELS = ['INFO', 'WARNING', 'CRITICAL'] as const;

export class AnnouncementDto {
  @IsOptional() @IsString() @Length(2, 120)
  title?: string;

  @IsOptional() @IsString() @Length(2, 2000)
  body?: string;

  @IsOptional() @IsIn(AUDIENCES)
  audience?: (typeof AUDIENCES)[number];

  @IsOptional() @IsIn(LEVELS)
  level?: (typeof LEVELS)[number];

  @IsOptional() @IsDateString()
  startsAt?: string;

  @IsOptional() @IsDateString()
  endsAt?: string | null;

  @IsOptional() @IsBoolean()
  active?: boolean;

  /** إرسال إشعار داخل التطبيق لكل الشريحة أيضًا */
  @IsOptional() @IsBoolean()
  notify?: boolean;
}

export class SettingsDto {
  @IsOptional() @IsBoolean()
  allowSelfSignup?: boolean;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(365)
  defaultTrialDays?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(60)
  graceDays?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  maxOwnedWorkspaces?: number;

  @IsOptional() @IsString() @MaxLength(32)
  supportPhone?: string | null;

  @IsOptional() @IsString() @MaxLength(300)
  maintenanceMessage?: string | null;
}

export class AuditQuery extends PageQuery {
  @IsOptional() @IsString() @MaxLength(60)
  action?: string;

  @IsOptional() @IsUUID()
  workspaceId?: string;

  @IsOptional() @IsUUID()
  actorId?: string;

  @IsOptional() @IsIn(['platform', 'auth', 'all'])
  scope?: 'platform' | 'auth' | 'all';
}

