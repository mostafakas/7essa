import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { accessOf, type AccessReason } from '../common/access';
import type { PlatformCtx } from '../common/context';
import { env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { AdminWorkspacesService } from './admin-workspaces.service';
import type { AuditQuery } from './dto';
import { PlatformSettingsService } from './settings.service';
import { addDays, pageOf } from './util';

const TZ_MONTH = (col: string) => `to_char((${col} AT TIME ZONE 'UTC') AT TIME ZONE 'Africa/Cairo', 'YYYY-MM')`;

@Injectable()
export class AdminOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingsService,
    private readonly workspaces: AdminWorkspacesService,
  ) {}

  /** لوحة المؤشرات: أعداد مجمعة فقط */
  async overview(admin: PlatformCtx) {
    const now = new Date();
    const { graceDays } = await this.settings.get();
    const all = await this.prisma.workspace.findMany({
      select: { id: true, name: true, type: true, status: true, plan: true, trialEndsAt: true, paidUntil: true, createdAt: true },
    });
    const usage = await this.workspaces.usage(admin, null);
    const plans = await this.prisma.plan.findMany({ select: { code: true, name: true, monthlyPrice: true } });
    const priceOf = new Map<string, number>(plans.map((p) => [p.code, Number(p.monthlyPrice)]));

    const byReason: Record<AccessReason, number> = { ACTIVE: 0, TRIAL: 0, TRIAL_ENDED: 0, GRACE: 0, EXPIRED: 0, PAUSED: 0, SUSPENDED: 0 };
    const byType = { CENTER: 0, TEACHER: 0 };
    let activeStudents = 0;
    let engaged = 0;
    let mrr = 0;
    const trialsEnding: { id: string; name: string; until: Date | null; daysLeft: number | null }[] = [];
    const renewals: { id: string; name: string; until: Date | null; reason: AccessReason; daysLeft: number | null }[] = [];
    for (const w of all) {
      const a = accessOf(w, now, graceDays);
      byReason[a.reason]++;
      byType[w.type]++;
      const u = usage.get(w.id);
      activeStudents += u?.activeStudents ?? 0;
      if (u && (u.receipts30d > 0 || u.attendance30d > 0)) engaged++;
      if (a.reason === 'ACTIVE' || a.reason === 'GRACE') mrr += priceOf.get(w.plan) ?? 0;
      if (a.reason === 'TRIAL' && a.daysLeft !== null && a.daysLeft <= 7) trialsEnding.push({ id: w.id, name: w.name, until: a.until, daysLeft: a.daysLeft });
      if ((a.reason === 'ACTIVE' && a.daysLeft !== null && a.daysLeft <= 14) || a.reason === 'GRACE' || a.reason === 'EXPIRED') {
        renewals.push({ id: w.id, name: w.name, until: a.until, reason: a.reason, daysLeft: a.daysLeft });
      }
    }
    trialsEnding.sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0));
    renewals.sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0));

    const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
    const revenue = await this.prisma.$queryRawUnsafe<{ month: string; total: string; n: number }[]>(
      `SELECT ${TZ_MONTH('"paidAt"')} AS month, sum(amount)::text AS total, count(*)::int AS n
         FROM platform_payments WHERE "paidAt" >= $1 GROUP BY 1 ORDER BY 1`,
      since,
    );
    const signups = await this.prisma.$queryRawUnsafe<{ month: string; n: number }[]>(
      `SELECT ${TZ_MONTH('"createdAt"')} AS month, count(*)::int AS n
         FROM workspaces WHERE "createdAt" >= $1 GROUP BY 1 ORDER BY 1`,
      since,
    );
    const [users, admins, locked, noPassword, activeUsers30d] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { platformRole: { not: null } } }),
      this.prisma.user.count({ where: { lockedUntil: { gt: now } } }),
      this.prisma.user.count({ where: { passwordHash: null } }),
      this.prisma.user.count({ where: { lastLoginAt: { gt: addDays(now, -30) } } }),
    ]);
    const recent = await this.prisma.scoped({ userId: admin.userId }, (tx) =>
      tx.auditLog.findMany({ where: { action: { startsWith: 'platform.' } }, orderBy: { createdAt: 'desc' }, take: 12 }),
    );
    const actorNames = await this.names(recent.map((r) => r.actorUserId));
    const wsNames = new Map(all.map((w) => [w.id, w.name]));

    return {
      workspaces: { total: all.length, byReason, byType },
      users: { total: users, admins, locked, noPassword, active30d: activeUsers30d },
      activeStudents,
      engaged,
      mrr: mrr.toFixed(2),
      revenue: revenue.map((r) => ({ month: r.month, total: r.total, count: r.n })),
      signups,
      trialsEnding: trialsEnding.slice(0, 10),
      renewals: renewals.slice(0, 10),
      recent: recent.map((r) => ({
        id: r.id.toString(),
        action: r.action,
        createdAt: r.createdAt,
        actor: r.actorUserId ? (actorNames.get(r.actorUserId) ?? '—') : 'النظام',
        workspace: r.workspaceId ? (wsNames.get(r.workspaceId) ?? null) : null,
        meta: r.meta,
      })),
    };
  }

  /** سجل العمليات عبر المنصة كلها */
  async audit(admin: PlatformCtx, q: AuditQuery) {
    const { page, pageSize, skip } = pageOf(q, 50);
    const where: Prisma.AuditLogWhereInput = {
      workspaceId: q.workspaceId,
      actorUserId: q.actorId,
      ...(q.action ? { action: { contains: q.action } } : q.scope === 'platform' ? { action: { startsWith: 'platform.' } } : q.scope === 'auth' ? { action: { startsWith: 'auth.' } } : {}),
    };
    const rows = await this.prisma.scoped({ userId: admin.userId }, (tx) =>
      tx.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: pageSize + 1 }),
    );
    const page1 = rows.slice(0, pageSize);
    const actors = await this.names(page1.map((r) => r.actorUserId));
    const wsIds = [...new Set(page1.map((r) => r.workspaceId).filter((v): v is string => Boolean(v)))];
    const wss = new Map(
      (await this.prisma.workspace.findMany({ where: { id: { in: wsIds } }, select: { id: true, name: true } })).map((w) => [w.id, w.name]),
    );
    return {
      page,
      hasMore: rows.length > pageSize,
      items: page1.map((r) => ({
        id: r.id.toString(),
        action: r.action,
        entity: r.entity,
        entityId: r.entityId,
        meta: r.meta,
        ip: r.ip,
        createdAt: r.createdAt,
        actor: r.actorUserId ? { id: r.actorUserId, name: actors.get(r.actorUserId) ?? '—' } : null,
        workspace: r.workspaceId ? { id: r.workspaceId, name: wss.get(r.workspaceId) ?? '—' } : null,
      })),
    };
  }

  /** فحص صحة النظام: هل يعمل التطبيق فعلًا بالدور المقيد؟ */
  async system() {
    const [db] = await this.prisma.$queryRaw<
      { db_user: string; bypass: boolean; superuser: boolean; owns_tables: boolean; size: string; version: string }[]
    >`SELECT current_user::text AS db_user,
             COALESCE((SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user), false) AS bypass,
             COALESCE((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false) AS superuser,
             COALESCE((SELECT tableowner = current_user FROM pg_tables WHERE schemaname = 'public' AND tablename = 'users'), false) AS owns_tables,
             pg_size_pretty(pg_database_size(current_database())) AS size,
             split_part(version(), ' ', 2) AS version`;
    const tables = await this.prisma.$queryRaw<{ name: string; rows: bigint }[]>`
      SELECT relname::text AS name, GREATEST(reltuples, 0)::bigint AS rows FROM pg_class
       WHERE relkind = 'r' AND relnamespace = 'public'::regnamespace
         AND relname IN ('users','workspaces','students','enrollments','class_sessions','attendance','receipts','exam_attempts','notifications','audit_logs','refresh_sessions')
       ORDER BY relname`;
    const cfg = await this.settings.get(true);
    const e = env();
    const rlsEnforced = !db.bypass && !db.superuser && !db.owns_tables;
    return {
      database: { ...db, rlsEnforced },
      tables: tables.map((t) => ({ name: t.name, rows: Number(t.rows) })),
      runtime: {
        node: process.version,
        nodeEnv: e.NODE_ENV,
        vercelEnv: process.env.VERCEL_ENV ?? null,
        region: process.env.VERCEL_REGION ?? null,
        commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
        uptimeSeconds: Math.round(process.uptime()),
      },
      checks: {
        rlsEnforced,
        cronSecret: Boolean(e.CRON_SECRET),
        proxySecret: Boolean(e.PROXY_SHARED_SECRET),
        requireProxy: e.REQUIRE_PROXY,
        cookieSecure: e.COOKIE_SECURE,
      },
      cron: { lastRunAt: cfg.lastCronAt, lastResult: cfg.lastCronResult },
    };
  }

  private async names(ids: (string | null)[]) {
    const unique = [...new Set(ids.filter((v): v is string => Boolean(v)))];
    const rows = unique.length ? await this.prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } }) : [];
    return new Map(rows.map((u) => [u.id, u.name]));
  }
}

