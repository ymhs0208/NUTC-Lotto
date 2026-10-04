const colors = ['#28518a', '#356a32', '#0f766e', '#7c3aed', '#b45309', '#b91c1c', '#93466e'];
const domainColors: Record<string, string> = {
  '企業智慧化': colors[0],
  '嵌入式系統與行動計算': colors[1],
  '智慧流通應用與研究': colors[2],
  '智慧運算創新應用': colors[3],
  '進修部': colors[4],
  '網路應用與資通安全': colors[5],
  '數位內容與多媒體應用': colors[6],
};

export function getDomainColor(field?: string): string {
  if (!field) return '#d9e3ed';
  if (Object.hasOwn(domainColors, field)) return domainColors[field];
  let hash = 0;
  for (const character of field) hash = (Math.imul(hash, 31) + character.codePointAt(0)!) >>> 0;
  return colors[hash % colors.length];
}
