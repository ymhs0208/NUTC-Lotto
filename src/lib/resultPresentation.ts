import { isCompleteDrawResult, compareDrawCodes } from './drawScope';
import type { DomainConfig, ProjectItem } from '../types';

export interface ResultSlide {
  key: string;
  field: string;
  group: number;
  page: number;
  pages: number;
  groupTotal: number;
  items: ProjectItem[];
}

/** Only saved assignments; domain display order, then session and numeric draw code. */
export function buildResultSlides(projects: ProjectItem[], domains: DomainConfig[], scope: string | string[] = 'ALL', pageSize = 6): ResultSlide[] {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) throw new Error('Invalid presentation page size');
  const grouped = new Map<string, Map<number, ProjectItem[]>>();
  for (const item of projects) {
    if (Array.isArray(scope) ? !scope.includes(item.field) : scope !== 'ALL' && item.field !== scope) continue;
    if (!isCompleteDrawResult(item)) continue;
    if (!grouped.has(item.field)) grouped.set(item.field, new Map());
    const groups = grouped.get(item.field)!;
    if (!groups.has(item.assigned_group!)) groups.set(item.assigned_group!, []);
    groups.get(item.assigned_group!)!.push(item);
  }
  const fields = [...new Set([...domains.map((domain) => domain.field), ...grouped.keys()])];
  return fields.flatMap((field) => [...(grouped.get(field)?.entries() ?? [])]
    .sort(([a], [b]) => a - b)
    .flatMap(([group, items]) => {
      const sorted = [...items].sort(compareDrawCodes);
      const pages = Math.ceil(sorted.length / pageSize);
      return Array.from({ length: pages }, (_, page) => ({
        key: JSON.stringify([field, group, page]), field, group, page, pages,
        groupTotal: sorted.length, items: sorted.slice(page * pageSize, (page + 1) * pageSize),
      }));
    }));
}
