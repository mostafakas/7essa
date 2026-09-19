import { Body, Controller, Delete, Get, HttpCode, Module, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { AuthUser, PlatformCtx } from '../common/context';
import { Admin, CurrentUser } from '../common/decorators';
import { AdminBillingService } from './admin-billing.service';
import { AdminOverviewService } from './admin-overview.service';
import { AdminUsersService } from './admin-users.service';
import { AdminWorkspacesService } from './admin-workspaces.service';
import { AnnouncementsService } from './announcements.service';
import {
  AddMemberDto, AnnouncementDto, AuditQuery, CreateUserDto, CreateWorkspaceDto, ExtendTrialDto, ListPaymentsQuery, ListUsersQuery,
  ListWorkspacesQuery, NoteDto, PageQuery, PlanDto, RecordPaymentDto, ResetPasswordDto, SettingsDto, UpdateMemberDto, UpdateUserDto,
  UpdateWorkspaceDto,
} from './dto';
import { platformPermissionsOf } from './platform-permissions';
import { PlatformGuard, PlatformPerm } from './platform.guard';
import { PlatformSettingsService } from './settings.service';

// ───── لوحة المؤشرات والسجل والإعدادات وصحة النظام

@Controller('platform')
@UseGuards(PlatformGuard)
export class PlatformController {
  constructor(
    private readonly overviewSvc: AdminOverviewService,
    private readonly settings: PlatformSettingsService,
    private readonly auditLog: AuditService,
  ) {}

  /** من أنا في فريق المنصة وما صلاحياتي (لإظهار وإخفاء عناصر الواجهة) */
  @Get('whoami')
  whoami(@Admin() admin: PlatformCtx) {
    return { role: admin.role, permissions: platformPermissionsOf(admin.role) };
  }

  @Get('overview')
  overview(@Admin() admin: PlatformCtx) {
    return this.overviewSvc.overview(admin);
  }

  @Get('audit')
  audit(@Admin() admin: PlatformCtx, @Query() q: AuditQuery) {
    return this.overviewSvc.audit(admin, q);
  }

  @Get('system')
  system() {
    return this.overviewSvc.system();
  }

  @Get('settings')
  getSettings() {
    return this.settings.get(true);
  }

  @Patch('settings')
  @PlatformPerm('platform.settings.manage')
  async updateSettings(@Admin() admin: PlatformCtx, @Body() dto: SettingsDto) {
    const result = await this.settings.update({
      ...dto,
      supportPhone: dto.supportPhone === undefined ? undefined : dto.supportPhone?.trim() || null,
      maintenanceMessage: dto.maintenanceMessage === undefined ? undefined : dto.maintenanceMessage?.trim() || null,
    });
    await this.auditLog.log(null, { actorUserId: admin.userId, action: 'platform.settings_update', entity: 'platform_settings', entityId: '1', meta: JSON.parse(JSON.stringify(dto)), ip: admin.ip });
    return result;
  }
}

// ───── مساحات العمل

@Controller('platform/workspaces')
@UseGuards(PlatformGuard)
export class PlatformWorkspacesController {
  constructor(private readonly svc: AdminWorkspacesService) {}

  @Get()
  list(@Admin() admin: PlatformCtx, @Query() q: ListWorkspacesQuery) {
    return this.svc.list(admin, q);
  }

  @Post()
  @PlatformPerm('platform.workspaces.manage')
  create(@Admin() admin: PlatformCtx, @Body() dto: CreateWorkspaceDto) {
    return this.svc.create(admin, dto);
  }

  @Get(':id')
  get(@Admin() admin: PlatformCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(admin, id);
  }

  /** الصلاحية الدقيقة تُفحص لكل حقل داخل الخدمة (عام أم مالي) */
  @Patch(':id')
  update(@Admin() admin: PlatformCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateWorkspaceDto) {
    return this.svc.update(admin, id, dto);
  }

  @Post(':id/extend-trial')
  @HttpCode(200)
  @PlatformPerm('platform.workspaces.manage')
  extendTrial(@Admin() admin: PlatformCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ExtendTrialDto) {
    return this.svc.extendTrial(admin, id, dto.days);
  }

  @Post(':id/members')
  @PlatformPerm('platform.workspaces.manage')
  addMember(@Admin() admin: PlatformCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AddMemberDto) {
    return this.svc.addMember(admin, id, dto);
  }

  @Patch(':id/members/:mid')
  @PlatformPerm('platform.workspaces.manage')
  updateMember(
    @Admin() admin: PlatformCtx,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('mid', ParseUUIDPipe) mid: string,
    @Body() dto: UpdateMemberDto,
  ) {
    return this.svc.updateMember(admin, id, mid, dto);
  }

  @Post(':id/notes')
  @PlatformPerm('platform.workspaces.manage')
  addNote(@Admin() admin: PlatformCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: NoteDto) {
    return this.svc.addNote(admin, id, dto);
  }

  @Delete(':id/notes/:noteId')
  @PlatformPerm('platform.workspaces.manage')
  deleteNote(@Admin() admin: PlatformCtx, @Param('id', ParseUUIDPipe) id: string, @Param('noteId', ParseUUIDPipe) noteId: string) {
    return this.svc.deleteNote(admin, id, noteId);
  }

  @Post(':id/payments')
  @PlatformPerm('platform.billing.manage')
  recordPayment(@Admin() admin: PlatformCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RecordPaymentDto) {
    return this.svc.recordPayment(admin, id, dto);
  }

  @Get(':id/audit')
  audit(@Admin() admin: PlatformCtx, @Param('id', ParseUUIDPipe) id: string, @Query() q: PageQuery) {
    return this.svc.auditOf(admin, id, q.page ?? 1);
  }
}

// ───── المستخدمون

@Controller('platform/users')
@UseGuards(PlatformGuard)
export class PlatformUsersController {
  constructor(private readonly svc: AdminUsersService) {}

  @Get()
  list(@Admin() admin: PlatformCtx, @Query() q: ListUsersQuery) {
    return this.svc.list(admin, q);
  }

  @Post()
  @PlatformPerm('platform.users.manage')
  create(@Admin() admin: PlatformCtx, @Body() dto: CreateUserDto) {
    return this.svc.create(admin, dto);
  }

  @Get(':id')
  get(@Admin() admin: PlatformCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(admin, id);
  }

  @Patch(':id')
  @PlatformPerm('platform.users.manage')
  update(@Admin() admin: PlatformCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto) {
    return this.svc.update(admin, id, dto);
  }

  @Post(':id/reset-password')
  @HttpCode(200)
  @PlatformPerm('platform.users.manage')
  resetPassword(@Admin() admin: PlatformCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ResetPasswordDto) {
    return this.svc.resetPassword(admin, id, dto);
  }

  @Post(':id/revoke-sessions')
  @HttpCode(200)
  @PlatformPerm('platform.users.manage')
  revokeSessions(@Admin() admin: PlatformCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.revokeSessions(admin, id);
  }

  @Post(':id/unlock')
  @HttpCode(200)
  @PlatformPerm('platform.users.manage')
  unlock(@Admin() admin: PlatformCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.unlock(admin, id);
  }
}

// ───── الخطط والمدفوعات

@Controller('platform')
@UseGuards(PlatformGuard)
export class PlatformBillingController {
  constructor(private readonly svc: AdminBillingService) {}

  @Get('plans')
  plans() {
    return this.svc.plans();
  }

  @Post('plans')
  @PlatformPerm('platform.billing.manage')
  createPlan(@Admin() admin: PlatformCtx, @Body() dto: PlanDto) {
    return this.svc.createPlan(admin, dto);
  }

  @Patch('plans/:id')
  @PlatformPerm('platform.billing.manage')
  updatePlan(@Admin() admin: PlatformCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PlanDto) {
    return this.svc.updatePlan(admin, id, dto);
  }

  @Get('payments')
  payments(@Query() q: ListPaymentsQuery) {
    return this.svc.payments(q);
  }

  /** حذف دفعة مسجلة بالخطأ: لمالك المنصة فقط */
  @Delete('payments/:id')
  @PlatformPerm('platform.settings.manage')
  deletePayment(@Admin() admin: PlatformCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deletePayment(admin, id);
  }
}

// ───── الإعلانات

@Controller('platform/announcements')
@UseGuards(PlatformGuard)
export class PlatformAnnouncementsController {
  constructor(private readonly svc: AnnouncementsService) {}

  @Get()
  list() {
    return this.svc.list();
  }

  @Post()
  @PlatformPerm('platform.content.manage')
  create(@Admin() admin: PlatformCtx, @Body() dto: AnnouncementDto) {
    return this.svc.create(admin, dto);
  }

  @Patch(':id')
  @PlatformPerm('platform.content.manage')
  update(@Admin() admin: PlatformCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AnnouncementDto) {
    return this.svc.update(admin, id, dto);
  }

  @Delete(':id')
  @PlatformPerm('platform.content.manage')
  remove(@Admin() admin: PlatformCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(admin, id);
  }
}

/** الإعلانات السارية لأي مستخدم مسجل (شريط أعلى التطبيق) */
@Controller('announcements')
export class PublicAnnouncementsController {
  constructor(private readonly svc: AnnouncementsService) {}

  @Get('active')
  active(@CurrentUser() user: AuthUser) {
    return this.svc.activeFor(user.id);
  }
}

@Module({
  controllers: [
    PlatformController,
    PlatformWorkspacesController,
    PlatformUsersController,
    PlatformBillingController,
    PlatformAnnouncementsController,
    PublicAnnouncementsController,
  ],
  providers: [PlatformGuard, AdminOverviewService, AdminWorkspacesService, AdminUsersService, AdminBillingService, AnnouncementsService],
})
export class PlatformModule {}
