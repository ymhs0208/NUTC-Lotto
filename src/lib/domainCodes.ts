const DOMAIN_CODES = new Map([
  ['企業智慧化', 'A'],
  ['數位內容與多媒體應用', 'B'],
  ['網路應用與資通安全', 'C'],
  ['嵌入式系統與行動計算', 'D'],
  ['智慧運算創新應用', 'E'],
  ['智慧流通應用與研究', 'F'],
  ['進修部', 'G'],
]);

export function getDomainCode(field: string, drawPrefix?: string): string | undefined {
  if (drawPrefix) return drawPrefix;
  const name = field.trim().replace(/^[A-G][.．]\s*/, '').replace(/[、，,]+$/, '').trim();
  return DOMAIN_CODES.get(name);
}
