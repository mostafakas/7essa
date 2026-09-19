'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { downloadCsv } from '@/lib/csv';
import { fmtDateTime } from '@/lib/format';
import { ACTION_LABEL, actionLabel, metaText, type AuditItem } from '@/lib/platform';
import { useAction, useLoad } from '@/lib/use-load';
import { Empty, ErrorNote, Field, Ledger, Loading, PageHead } from '@/components/ui';

interface AuditPage {
  page: number;
  hasMore: boolean;
  items: AuditItem[];
}

const SCOPE_LABEL: Record<string, string> = { all: 'كل العمليات', platform: 'إجراءات فريق المنصة', auth: 'الدخول والأمان' };

export default function AuditPage() {
  const [scope, setScope] = useState('all');
  const [action, setAction] = useState('');
  const [workspaceId, setWorkspaceId] = useState('');
  const [actorId, setActorId] = useState('');
  const [page, setPage] = useState(1);
  const exporter = useAction();

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    setScope(sp.get('scope') ?? 'all');
    setWorkspaceId(sp.get('workspaceId') ?? '');
    setActorId(sp.get('actorId') ?? '');
  }, []);

  const query = { scope: scope === 'all' ? undefined : scope, action: action || undefined, workspaceId: workspaceId || undefined, actorId: actorId || undefined };
  const log = useLoad(() => api<AuditPage>('/platform/audit', { workspace: false, query: { ...query, page } }), [scope, action, workspaceId, actorId, page]);
  const reset = (fn: () => void) => {
    fn();
    setPage(1);
  };

  const exportCsv = () =>
    void exporter.run(async () => {
      const rows: AuditItem[] = [];
      for (let p = 1; p <= 20; p++) {
        const r = await api<AuditPage>('/platform/audit', { workspace: false, query: { ...query, page: p, pageSize: 200 } });
        rows.push(...r.items);
        if (!r.hasMore) break;
      }
      downloadCsv(
        `سجل-العمليات-${new Date().toISOString().slice(0, 10)}`,
        ['الوقت', 'العملية', 'الرمز', 'بواسطة', 'المساحة', 'الكيان', 'المعرف', 'العنوان', 'تفاصيل'],
        rows.map((a) => [a.createdAt.replace('T', ' ').slice(0, 19), actionLabel(a.action), a.action, a.actor?.name ?? 'النظام', a.workspace?.name, a.entity, a.entityId, a.ip, metaText(a.meta)]),
      );
    });

  return (
    <>
      <PageHead title="سجل العمليات" sub="كل العمليات المسجلة على المنصة. السجل لا يُعدل ولا يُحذف.">
        <button className="btn quiet" onClick={exportCsv} disabled={exporter.busy}>{exporter.busy ? 'جارٍ التصدير…' : 'تصدير Excel'}</button>
      </PageHead>
      <div className="form-grid" style={{ marginBottom: '1rem' }}>
        <Field label="النطاق">
          <select className="select" value={scope} onChange={(e) => reset(() => setScope(e.target.value))}>
            {Object.entries(SCOPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="العملية">
          <select className="select" value={action} onChange={(e) => reset(() => setAction(e.target.value))}>
            <option value="">الكل</option>
            {Object.entries(ACTION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
      </div>
      {workspaceId || actorId ? (
        <div className="note info row-between" style={{ marginBottom: '1rem' }}>
          <span>{workspaceId ? 'مفلتر على مساحة عمل واحدة. ' : ''}{actorId ? 'مفلتر على مستخدم واحد.' : ''}</span>
          <button className="btn ghost" onClick={() => reset(() => { setWorkspaceId(''); setActorId(''); })}>إزالة الفلتر</button>
        </div>
      ) : null}
      <ErrorNote error={log.error ?? exporter.error} onRetry={log.reload} />
      {log.loading && !log.data ? <Loading what="السجل" /> : null}
      {log.data && !log.data.items.length ? <Empty>لا توجد عمليات مطابقة.</Empty> : null}
      {log.data?.items.length ? (
        <Ledger head={<tr><th>الوقت</th><th>العملية</th><th>بواسطة</th><th>المساحة</th><th>العنوان</th><th>تفاصيل</th></tr>}>
          {log.data.items.map((a) => (
            <tr key={a.id}>
              <td className="faint nowrap">{fmtDateTime(a.createdAt)}</td>
              <td>{actionLabel(a.action)}</td>
              <td>
                {a.actor ? (
                  <>
                    <Link href={`/platform/users/${a.actor.id}`}>{a.actor.name}</Link>{' '}
                    <button className="btn ghost" style={{ padding: '0 0.3rem' }} title="كل عملياته" onClick={() => reset(() => setActorId(a.actor!.id))}>⌕</button>
                  </>
                ) : 'النظام'}
              </td>
              <td>
                {a.workspace ? (
                  <>
                    <Link href={`/platform/workspaces/${a.workspace.id}`}>{a.workspace.name}</Link>{' '}
                    <button className="btn ghost" style={{ padding: '0 0.3rem' }} title="كل عمليات المساحة" onClick={() => reset(() => setWorkspaceId(a.workspace!.id))}>⌕</button>
                  </>
                ) : '—'}
              </td>
              <td className="num faint">{a.ip ?? ''}</td>
              <td className="faint" style={{ maxWidth: 340, overflowWrap: 'anywhere' }}>{metaText(a.meta)}</td>
            </tr>
          ))}
        </Ledger>
      ) : null}
      <div className="row" style={{ marginTop: '1rem' }}>
        <button className="btn quiet" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>الأحدث</button>
        <button className="btn quiet" disabled={!log.data?.hasMore} onClick={() => setPage((p) => p + 1)}>الأقدم</button>
      </div>
    </>
  );
}
