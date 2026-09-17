'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { fmtDate, num } from '@/lib/format';
import { logout, useSession } from '@/lib/session';
import { useAction } from '@/lib/use-load';
import { Chip, Field, PageHead } from '@/components/ui';

export default function SettingsPage() {
  const { current, me, can, reload } = useSession();
  const [welcome, setWelcome] = useState(false);
  const [f, setF] = useState({ name: '', receptionMaxDiscountPct: 10, lateAfterMinutes: 15 });
  const [myName, setMyName] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const ws = useAction();
  const account = useAction();

  useEffect(() => {
    setWelcome(new URLSearchParams(window.location.search).get('welcome') === '1');
  }, []);
  useEffect(() => {
    if (current) {
      setF({
        name: current.workspace.name,
        receptionMaxDiscountPct: current.workspace.receptionMaxDiscountPct,
        lateAfterMinutes: current.workspace.lateAfterMinutes,
      });
    }
  }, [current]);
  useEffect(() => {
    if (me) setMyName(me.user.name);
  }, [me]);

  if (!current || !me) return null;

  const saveWorkspace = (e: FormEvent) => {
    e.preventDefault();
    void ws.run(async () => {
      await api('/workspaces/current', { method: 'PATCH', body: f });
      setSaved('حُفظت إعدادات مساحة العمل.');
      await reload();
    });
  };

  const saveName = (e: FormEvent) => {
    e.preventDefault();
    void account.run(async () => {
      await api('/auth/me', { method: 'PATCH', body: { name: myName }, workspace: false });
      setSaved('حُفظ اسمك.');
      await reload();
    });
  };

  const logoutAll = () =>
    window.confirm('سيتم تسجيل خروجك من كل الأجهزة، بما فيها هذا الجهاز. متابعة؟') &&
    void account.run(async () => {
      await api('/auth/logout-all', { method: 'POST', workspace: false });
      await logout();
    });

  const isCenter = current.workspace.type === 'CENTER';

  return (
    <>
      <PageHead title="الإعدادات" sub={current.workspace.name} />
      {welcome ? (
        <section className="panel stack-sm" style={{ marginBottom: '1.25rem' }}>
          <h2>أهلًا بك في حصّة</h2>
          <p>ابدأ بهذه الخطوات بالترتيب، وكل خطوة تأخذ دقائق:</p>
          <ol style={{ margin: 0, paddingInlineStart: '1.2rem', display: 'grid', gap: '0.35rem' }}>
            {isCenter ? <li><Link href="/app/schedule">أضف القاعات</Link> بسعة كل منها.</li> : null}
            {isCenter ? <li><Link href="/app/staff">أضف الفريق</Link>: المدرسين والاستقبال والمحاسب.</li> : null}
            <li><Link href="/app/schedule">أنشئ المجموعات</Link> وولّد مواعيدها الأسبوعية.</li>
            {isCenter ? <li><Link href="/app/settlements">سجّل عقود المدرسين</Link> لتُحسب التسويات آخر الشهر.</li> : null}
            <li><Link href="/app/students?new=1">سجّل الطلاب</Link> برقم ولي الأمر، ثم اطبع الكارنيهات.</li>
          </ol>
        </section>
      ) : null}
      {saved ? <div className="note info" role="status" style={{ marginBottom: '1rem' }}>{saved}</div> : null}

      <div className="split-even">
        {can('workspace.manage') ? (
          <form className="panel stack" onSubmit={saveWorkspace}>
            <h2>مساحة العمل</h2>
            <div className="row">
              <Chip tone={current.workspace.status === 'ACTIVE' ? 'ok' : current.workspace.status === 'TRIAL' ? 'warn' : 'bad'}>
                {current.workspace.status === 'TRIAL' ? 'فترة تجريبية' : current.workspace.status === 'ACTIVE' ? 'مفعّل' : 'موقوف'}
              </Chip>
              <Chip>{isCenter ? 'سنتر' : 'مدرس خاص'}</Chip>
              {current.workspace.trialEndsAt ? <span className="faint">تنتهي التجربة {fmtDate(current.workspace.trialEndsAt)}</span> : null}
            </div>
            <Field label="الاسم الظاهر لأولياء الأمور">
              <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required minLength={2} maxLength={80} />
            </Field>
            {isCenter ? (
              <Field label="أقصى خصم يمنحه الاستقبال دون موافقة (%)" hint="أي خصم أكبر يحتاج المدير، وكل خصم يصل تنبيه به للإدارة">
                <input className="input" type="number" min={0} max={100} value={f.receptionMaxDiscountPct} onChange={(e) => setF({ ...f, receptionMaxDiscountPct: Number(e.target.value) })} />
              </Field>
            ) : null}
            <Field label="يُحسب الطالب متأخرًا بعد (دقيقة من بداية الحصة)">
              <input className="input" type="number" min={0} max={120} value={f.lateAfterMinutes} onChange={(e) => setF({ ...f, lateAfterMinutes: Number(e.target.value) })} />
            </Field>
            {ws.error ? <div className="note error">{ws.error}</div> : null}
            <div className="row"><button className="btn" disabled={ws.busy}>احفظ الإعدادات</button></div>
          </form>
        ) : null}

        <section className="panel stack">
          <h2>حسابي</h2>
          <form className="stack-sm" onSubmit={saveName}>
            <Field label="اسمك">
              <input className="input" value={myName} onChange={(e) => setMyName(e.target.value)} required minLength={2} maxLength={80} />
            </Field>
            <div className="row"><button className="btn quiet" disabled={account.busy || myName.trim() === me.user.name}>احفظ الاسم</button></div>
          </form>
          <p className="muted">
            تدخل برقم <span className="num">{me.user.phone.replace(/^\+20/, '0')}</span>، وأنت عضو في {num(me.memberships.length)} مساحة عمل.
          </p>
          <div className="row">
            <button className="btn quiet" onClick={() => void logout()}>تسجيل الخروج</button>
            <button className="btn danger" onClick={logoutAll} disabled={account.busy}>الخروج من كل الأجهزة</button>
          </div>
          {account.error ? <div className="note error">{account.error}</div> : null}
        </section>
      </div>
    </>
  );
}
