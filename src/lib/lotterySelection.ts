import type { ProjectItem } from '../types';

export function getDrawableFields(fields: string[], projects: Pick<ProjectItem, 'field' | 'draw_order'>[]) {
  const completed = new Set(projects.filter(project => !!project.draw_order).map(project => project.field));
  return fields.filter(field => !completed.has(field));
}
