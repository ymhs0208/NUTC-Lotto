/** Display report sessions using Chinese ordinals (configured session counts are 1–50). */
export function formatSessionLabel(session: number): string {
  const digits = '零一二三四五六七八九';
  let ordinal = String(session);
  if (Number.isInteger(session) && session > 0 && session < 100) {
    const tens = Math.floor(session / 10);
    const ones = session % 10;
    ordinal = tens === 0 ? digits[ones] : `${tens > 1 ? digits[tens] : ''}十${ones ? digits[ones] : ''}`;
  }
  return `第${ordinal}場次`;
}
