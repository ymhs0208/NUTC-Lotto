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

export function getDomainCode(field: string, configs: DomainConfig[] = []): string | undefined {
  const configured = configs.find(c => c.field === field)?.code;
  if (configured !== undefined) return configured;
  const name = field.trim().replace(/^[A-G][.．]\s*/, '').replace(/[、，,]+$/, '').trim();
  return DOMAIN_CODES.get(name);
}

// The same namespace must be used for allocation and validation, including
// legacy custom-domain prefixes. Do not merge distinct group configurations.
export function getDrawCodeNamespace(field: string, configs: DomainConfig[] = []): string {
  return getDomainCode(field, configs) ?? field.slice(0, 4);
}

export function domainCodeCollisionError(fields: Iterable<string>, configs: DomainConfig[] = []): string | null {
  const owners = new Map<string, string>();
  for (const field of fields) {
    const prefix = getDrawCodeNamespace(field, configs);
    const previous = owners.get(prefix);
    if (previous !== undefined && previous !== field) {
      return `「${previous}」與「${field}」使用相同抽籤編號前綴「${prefix}」，會產生重複編號。請編輯領域，設定不同的對應字母，再儲存或抽籤。`;
    }
    owners.set(prefix, field);
  }
  return null;
}

/** Letter domains first (A-Z), then legacy custom prefixes; never mutate input. */
export function sortDomainConfigs(configs: DomainConfig[]): DomainConfig[] {
  return [...configs].sort((a, b) => {
    const left = getDrawCodeNamespace(a.field, configs);
    const right = getDrawCodeNamespace(b.field, configs);
    const letterOrder = Number(!/^[A-Z]$/.test(left)) - Number(!/^[A-Z]$/.test(right));
    return letterOrder || left.localeCompare(right, 'en', { numeric: true })
      || a.field.localeCompare(b.field, 'zh-Hant-TW') || a.id.localeCompare(b.id, 'en');
  });
}
