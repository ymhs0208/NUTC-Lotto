import type { DomainConfig, ProjectItem } from '../types';

/** Check the original snapshot before a deleted domain's projects can be moved. */
export function domainDeletionError(projects: ProjectItem[], current: DomainConfig[], next: DomainConfig[]): string | null {
  const retainedIds = new Set(next.map(config => config.id));
  for (const config of current) {
    if (retainedIds.has(config.id)) continue;
    const hasResults = projects.some(project => project.field === config.field &&
      [project.assigned_group, project.draw_code, project.draw_time].some(value => value != null && value !== ''));
    if (hasResults) return `「${config.field}」已有抽籤結果，請先重設此領域的抽籤結果後再刪除。`;
  }
  return null;
}
