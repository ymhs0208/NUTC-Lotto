import type { DomainConfig } from '../types';

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

/** Match the presentation order without modifying the stored configuration. */
export function sortDomainConfigs(configs: DomainConfig[]): DomainConfig[] {
  return [...configs].sort((a, b) => {
    const left = getDomainCode(a.field, a.drawPrefix) ?? a.field.slice(0, 4);
    const right = getDomainCode(b.field, b.drawPrefix) ?? b.field.slice(0, 4);
    return Number(!/^[A-Z]$/.test(left)) - Number(!/^[A-Z]$/.test(right))
      || left.localeCompare(right, 'en', { numeric: true })
      || a.field.localeCompare(b.field, 'zh-Hant-TW') || a.id.localeCompare(b.id, 'en');
  });
}
