import type { ProjectItem } from '../types';

export function isCompleteDrawResult(project: ProjectItem): boolean {
  return Number.isSafeInteger(project.assigned_group) && project.assigned_group! > 0
    && typeof project.draw_code === 'string' && project.draw_code.trim().length > 0;
}

export function hasDrawData(project: ProjectItem): boolean {
  return [project.assigned_group, project.draw_code, project.draw_time].some(value => value != null && value !== '');
}

export function projectFieldChangeError(previous: ProjectItem, nextField: string): string | null {
  return previous.field !== nextField && hasDrawData(previous)
    ? `「${previous.project_title}」已有抽籤資料，請先重設「${previous.field}」領域的抽籤結果，再修改專題領域。`
    : null;
}

export function compareDrawCodes(a: Pick<ProjectItem, 'draw_code' | 'id'>, b: Pick<ProjectItem, 'draw_code' | 'id'>): number {
  return drawCodeCollator.compare(a.draw_code || '', b.draw_code || '') || a.id.localeCompare(b.id);
}
const drawCodeCollator = new Intl.Collator('zh-TW', { numeric: true });

/** Codes are unique across the complete roster, including partial results. */
export function duplicateDrawCodeError(projects: Pick<ProjectItem, 'draw_code'>[]): string | null {
  const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
  const codes = projects.map(project => project.draw_code?.trim() || '').filter(Boolean);
  codes.sort(collator.compare);
  for (let index = 1; index < codes.length; index++) {
    if (collator.compare(codes[index - 1], codes[index]) === 0) {
      return `抽籤編號「${codes[index]}」重複，請確認名冊，各領域與場次的抽籤編號不可重複。`;
    }
  }
  return null;
}

function fieldsWithDrawData(projects: ProjectItem[]): Set<string> {
  return new Set(projects.filter(hasDrawData).map(p => p.field));
}

/** A domain with any draw data is incomplete unless every project has a full result. */
export function getIncompleteDrawFields(fields: string[], projects: ProjectItem[]): string[] {
  const started = fieldsWithDrawData(projects);
  return fields.filter(field => started.has(field) && projects.some(p => p.field === field && !isCompleteDrawResult(p)));
}

/** A partial result also blocks drawing the domain again until it is reset. */
export function getAvailableDrawFields(fields: string[], projects: ProjectItem[]): string[] {
  const blocked = fieldsWithDrawData(projects);
  return fields.filter(field => !blocked.has(field));
}

export function getSelectedDrawFields(fields: string[], projects: ProjectItem[], selected: string[] | null): string[] {
  const available = getAvailableDrawFields(fields, projects);
  return selected === null ? available : available.filter(field => selected.includes(field));
}

export function getResettableFields(fields: string[], projects: ProjectItem[]): string[] {
  const completed = fieldsWithDrawData(projects);
  return fields.filter(field => completed.has(field));
}
