/** تصدير جدول كملف CSV يفتحه Excel بالعربية مباشرة (BOM + فاصلة) */
export type Cell = string | number | boolean | null | undefined;

function escape(v: Cell): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  // منع حقن الصيغ في Excel
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function downloadCsv(filename: string, header: string[], rows: Cell[][]) {
  const text = [header, ...rows].map((r) => r.map(escape).join(',')).join('\r\n');
  const blob = new Blob(['\uFEFF', text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** يجلب كل الصفحات من مسار مقسم لصفحات ثم يعيد العناصر مجمعة */
export async function fetchAllPages<T>(load: (page: number) => Promise<{ items: T[]; total?: number; hasMore?: boolean }>, max = 40): Promise<T[]> {
  const all: T[] = [];
  for (let page = 1; page <= max; page++) {
    const r = await load(page);
    all.push(...r.items);
    const more = r.hasMore ?? (r.total !== undefined ? all.length < r.total : r.items.length > 0);
    if (!more || !r.items.length) break;
  }
  return all;
}
