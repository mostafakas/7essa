'use client';

import { useEffect, useRef, type ReactNode } from 'react';

export function PageHead({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {sub ? <p>{sub}</p> : null}
      </div>
      {children ? <div className="row">{children}</div> : null}
    </header>
  );
}

export function Loading({ what = 'البيانات' }: { what?: string }) {
  return <p className="skeleton" role="status">جارٍ تحميل {what}…</p>;
}

export function ErrorNote({ error, onRetry }: { error: string | null; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <div className="note error row-between" role="alert">
      <span>{error}</span>
      {onRetry ? <button className="btn ghost" onClick={onRetry}>أعد المحاولة</button> : null}
    </div>
  );
}

export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <p>{children}</p>
      {action}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'plain';
export function Chip({ tone = 'plain', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`chip ${tone === 'plain' ? '' : tone}`}>{children}</span>;
}

export function Modal({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="modal" onClose={onClose} aria-labelledby="modal-title">
      <div className="modal-head">
        <h2 id="modal-title">{title}</h2>
        <button className="btn ghost" onClick={onClose} aria-label="إغلاق">إغلاق</button>
      </div>
      <div className="modal-body">{open ? children : null}</div>
    </dialog>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { id: T; label: string; hidden?: boolean }[] }) {
  return (
    <div className="tabs" role="tablist">
      {items.filter((i) => !i.hidden).map((i) => (
        <button key={i.id} role="tab" aria-selected={value === i.id} onClick={() => onChange(i.id)} type="button">
          {i.label}
        </button>
      ))}
    </div>
  );
}

export function Ledger({ head, children, foot }: { head: ReactNode; children: ReactNode; foot?: ReactNode }) {
  return (
    <div className="ledger-wrap">
      <table className="ledger">
        <thead>{head}</thead>
        <tbody>{children}</tbody>
        {foot ? <tfoot>{foot}</tfoot> : null}
      </table>
    </div>
  );
}

export type StampTone = 'ok' | 'late' | 'dues' | 'bad' | 'neutral';

/** الختم: نتيجة المسح عند الباب وعلامة "مدفوع" على الإيصال */
export function Stamp({ tone, word, who, sub, pressKey }: { tone: StampTone; word: string; who?: string; sub?: string; pressKey?: string | number }) {
  return (
    <div key={pressKey} className={`stamp press ${tone === 'ok' ? '' : tone}`} role="status" aria-live="assertive">
      <div className="word">{word}</div>
      {who ? <div className="who">{who}</div> : null}
      {sub ? <div className="sub">{sub}</div> : null}
    </div>
  );
}

export function MonthInput({ value, onChange, label = 'الشهر' }: { value: string; onChange: (v: string) => void; label?: string }) {
  return (
    <Field label={label}>
      <input className="input" type="month" value={value} onChange={(e) => e.target.value && onChange(e.target.value)} />
    </Field>
  );
}
