const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/**
 * يحول أي صيغة شائعة لرقم موبايل مصري إلى E.164 (+201XXXXXXXXX)
 * ويرجع null إن لم يكن رقمًا صالحًا (010 / 011 / 012 / 015).
 */
export function normalizeEgyptPhone(input: string): string | null {
  if (typeof input !== 'string' || input.length > 32) return null;
  const digits = input
    .replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)))
    .replace(/[\s\-().]/g, '');
  const m = /^(?:\+20|0020|20)?0?(1[0125]\d{8})$/.exec(digits);
  return m ? `+20${m[1]}` : null;
}

/** يخفي منتصف الرقم عند العرض لأدوار لا تحتاج الرقم كاملًا */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return '—';
  return phone.length < 8 ? '***' : `${phone.slice(0, 5)}*****${phone.slice(-3)}`;
}

/** الصيغة المحلية للعرض: 01XXXXXXXXX */
export function localPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  return phone.startsWith('+20') ? `0${phone.slice(3)}` : phone;
}
