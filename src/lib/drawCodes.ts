import type { ProjectItem } from '../types';
import { getDomainCode } from './domainCodes';

// Relabel existing results without re-running the draw or changing presentation order.
export function relabelDomainResults<T extends ProjectItem>(projects: T[], field: string, drawPrefix?: string): T[] {
  const prefix = getDomainCode(field, drawPrefix);
  const drawn = projects.filter(p => p.field === field && p.assigned_group && p.draw_order)
    .sort((a, b) => a.assigned_group! - b.assigned_group! || a.draw_order! - b.draw_order!);
  const codes = new Map(drawn.map((p, index) => [p.id, prefix
    ? `${prefix}${String(index + 1).padStart(2, '0')}`
    : `${field.slice(0, 4)}-第${p.assigned_group}組-序號${String(p.draw_order).padStart(2, '0')}`]));
  return projects.map(p => codes.has(p.id) ? { ...p, draw_code: codes.get(p.id)! } : p);
}
