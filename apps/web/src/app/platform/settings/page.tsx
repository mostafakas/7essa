'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { fmtDateTime, num } from '@/lib/format';
import { useAction, useLoad } from '@/lib/use-load';
import { usePlatform } from '@/components/platform-shell';
import { Chip, ErrorNote, Field, Ledger, Loading, PageHead } from '@/components/ui';

interface Settings {
  allowSelfSignup: boolean;
  defaultTrialDays: number;
  graceDays: number;
  maxOwnedWorkspaces: number;
  supportPhone: string | null;
  maintenanceMessage: string | null;
  lastCronAt: string | null;
  lastCronResult: Record<string, unknown> | null;
}

interface SystemInfo {
  database: { db_user: string; bypass: boolean; superuser: boolean; owns_tables: boolean; size: string; version: string; rlsEnforced: boolean };
  tables: { name: string; rows: number }[];
  runtime: { node: string; nodeEnv: string; vercelEnv: string | null; region: string | null; commit: string | null; uptimeSeconds: number };
  checks: { rlsEnforced: boolean; cronSecret: boolean; proxySecret: boolean; requireProxy: boolean; cookieSecure: boolean };
  cron: { lastRunAt: string | null; lastResult: Record<string, unknown> | null };
}

const TABLE_LABEL: Record<string, string> = {
  users: 'المستخدمون', workspaces: 'مساحات العمل', students: 'الطلاب', enrollments: 'الاشتراكات', class_sessions: 'الحصص',
  attendance: 'الحضور', receipts: 'الإيصالات', exam_attempts: 'محاولات الامتحانات', notifications: 'الإشعارات',
  audit_logs: 'سجل العمليات', refresh_sessions: 'جلسات الدخول',
};

function Check({ ok, label, hint }: { ok: boolean; label: string; hint: string }) {
  return (
    <tr>
      <td>{label}</td>
      <td>{ok ? <Chip tone="ok">سليم</Chip> : <Chip tone="bad">يحتاج ضبط</Chip>}</td>
      <td className="faint">{hint}</td>
    </tr>
  );
}

export default function PlatformSettingsPage() {
  const { can } = usePlatform();
  const settings = useLoad(() => api<Settings>('/platform/settings', { workspace: false }), []);
  const system = useLoad(() => api<SystemInfo>('/platform/system', { workspace: false }), []);
  const [f, setF] = useState<{ allowSelfSignup: boolean; defaultTrialDays: string; graceDays: string; maxOwnedWorkspaces: string; supportPhone: string; maintenanceMessage: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();
  const editable = can('platform.settings.manage');

  useEffect(() => {
    const s = settings.data;
    if (s) {
      setF({
        allowSelfSignup: s.allowSelfSignup,
        defaultTrialDays: String(s.defaultTrialDays),
        graceDays: String(s.graceDays),
        maxOwnedWorkspaces: String(s.maxOwnedWorkspaces),
        supportPhone: s.supportPhone ?? '',
        maintenanceMessage: s.maintenanceMessage ?? '',
      });
    }
  }, [settings.data]);

  const save = (e: FormEvent) => {
    e.preventDefault();
    if (!f) return;
    void run(async () => {
      await api('/platform/settings', {
        method: 'PATCH',
        workspace: false,
        body: {
          allowSelfSignup: f.allowSelfSignup,
          defaultTrialDays: Number(f.defaultTrialDays),
          graceDays: Number(f.graceDays),
          maxOwnedWorkspaces: Number(f.maxOwnedWorkspaces),
          supportPhone: f.supportPhone.trim() || null,
          maintenanceMessage: f.maintenanceMessage.trim() || null,
        },
      });
      setSaved(true);
      await settings.reload();
    });
  };

  const sys = system.data;
  return (
    <>
      <PageHead title="الإعدادات وصحة النظام" />
      <div className="stack">
        <ErrorNote error={settings.error} onRetry={settings.reload} />
        {settings.loading && !f ? <Loading what="الإعدادات" /> : null}
        {f ? (
          <form className="panel stack" onSubmit={save}>
            <h2>إعدادات المنصة</h2>
            <label className="row" style={{ gap: '0.4rem' }}>
              <input type="checkbox" checked={f.allowSelfSignup} onChange={(e) => setF({ ...f, allowSelfSignup: e.target.checked })} disabled={!editable} />
              السماح للمستخدمين بإنشاء مساحة عمل (سنتر أو مدرس) بأنفسهم
            </label>
            <p className="faint">عند الإيقاف لا تُنشأ مساحات عمل إلا من هذه اللوحة، ويرى المستخدم الجديد رسالة للتواصل معكم.</p>
            <div className="form-grid">
              <Field label="أيام الفترة التجريبية"><input className="input" type="number" min={1} max={365} value={f.defaultTrialDays} onChange={(e) => setF({ ...f, defaultTrialDays: e.target.value })} disabled={!editable} /></Field>
              <Field label="أيام السماح بعد انتهاء الاشتراك" hint="يعمل فيها السنتر كاملًا مع تنبيه"><input className="input" type="number" min={0} max={60} value={f.graceDays} onChange={(e) => setF({ ...f, graceDays: e.target.value })} disabled={!editable} /></Field>
              <Field label="أقصى مساحات يملكها مستخدم واحد"><input className="input" type="number" min={1} max={50} value={f.maxOwnedWorkspaces} onChange={(e) => setF({ ...f, maxOwnedWorkspaces: e.target.value })} disabled={!editable} /></Field>
              <Field label="رقم الدعم والتجديد" hint="يظهر للسناتر في تنبيهات الاشتراك"><input className="input" dir="ltr" value={f.supportPhone} onChange={(e) => setF({ ...f, supportPhone: e.target.value })} disabled={!editable} /></Field>
            </div>
            <Field label="رسالة صيانة (تظهر لكل المستخدمين أعلى الشاشة)" hint="اتركها فارغة لإخفائها">
              <input className="input" value={f.maintenanceMessage} onChange={(e) => setF({ ...f, maintenanceMessage: e.target.value })} maxLength={300} disabled={!editable} />
            </Field>
            {error ? <div className="note error">{error}</div> : null}
            {saved ? <div className="note info">حُفظت الإعدادات (تسري خلال دقيقة على كل الخوادم).</div> : null}
            {editable ? <div className="row"><button className="btn" disabled={busy}>احفظ الإعدادات</button></div> : <p className="faint">تعديل الإعدادات لمالك المنصة فقط.</p>}
          </form>
        ) : null}

        <ErrorNote error={system.error} onRetry={system.reload} />
        {sys ? (
          <>
            <section className="panel stack-sm">
              <div className="row-between"><h2>فحوص الأمان والتشغيل</h2><button className="btn ghost" onClick={() => void system.reload()}>إعادة الفحص</button></div>
              <Ledger head={<tr><th>الفحص</th><th>الحالة</th><th>المعنى</th></tr>}>
                <Check ok={sys.checks.rlsEnforced} label="عزل بيانات السناتر (RLS)" hint={sys.checks.rlsEnforced ? `التطبيق يعمل بالدور المقيد «${sys.database.db_user}».` : `التطبيق يعمل بدور «${sys.database.db_user}» الذي يتجاوز العزل! اضبط APP_DB_PASSWORD وأعد النشر.`} />
                <Check ok={sys.checks.cronSecret} label="المهمة اليومية" hint="CRON_SECRET لتذكيرات انتهاء الاشتراك وتنظيف الجلسات." />
                <Check ok={sys.checks.proxySecret} label="تمرير عنوان العميل" hint="PROXY_SHARED_SECRET بين الواجهة والخادم (حدود المعدل وسجل العناوين)." />
                <Check ok={sys.checks.cookieSecure} label="الكوكيز الآمنة" hint="COOKIE_SECURE=true في الإنتاج (HTTPS)." />
                <Check ok={sys.checks.requireProxy} label="منع الوصول المباشر للخادم" hint="REQUIRE_PROXY=true يرفض أي طلب لا يمر عبر الواجهة." />
              </Ledger>
            </section>
            <div className="split-even">
              <section className="panel stack-sm">
                <h2>التشغيل</h2>
                <dl className="dl">
                  <dt>البيئة</dt><dd>{sys.runtime.vercelEnv ?? sys.runtime.nodeEnv}</dd>
                  {sys.runtime.region ? <><dt>المنطقة</dt><dd dir="ltr">{sys.runtime.region}</dd></> : null}
                  {sys.runtime.commit ? <><dt>الإصدار</dt><dd className="num" dir="ltr">{sys.runtime.commit}</dd></> : null}
                  <dt>Node</dt><dd dir="ltr">{sys.runtime.node}</dd>
                  <dt>PostgreSQL</dt><dd dir="ltr">{sys.database.version}</dd>
                  <dt>حجم قاعدة البيانات</dt><dd dir="ltr">{sys.database.size}</dd>
                  <dt>آخر تشغيل يومي</dt><dd>{sys.cron.lastRunAt ? fmtDateTime(sys.cron.lastRunAt) : 'لم يعمل بعد'}</dd>
                  {sys.cron.lastResult ? (
                    <><dt>نتيجته</dt><dd className="faint">تذكيرات: {num(Number(sys.cron.lastResult.reminders ?? 0))}، جلسات منظفة: {num(Number(sys.cron.lastResult.sessionsCleaned ?? 0))}</dd></>
                  ) : null}
                </dl>
              </section>
              <section className="panel stack-sm">
                <h2>حجم البيانات (تقديري)</h2>
                <Ledger head={<tr><th>الجدول</th><th>الصفوف</th></tr>}>
                  {sys.tables.map((t) => (
                    <tr key={t.name}><td>{TABLE_LABEL[t.name] ?? t.name}</td><td className="num">{num(t.rows)}</td></tr>
                  ))}
                </Ledger>
              </section>
            </div>
          </>
        ) : system.loading ? <Loading what="فحص النظام" /> : null}
      </div>
    </>
  );
}
