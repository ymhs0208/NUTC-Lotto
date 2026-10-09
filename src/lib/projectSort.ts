import type { ProjectItem } from '../types';

export type ProjectSortKey =
  | 'seq_no' | 'draw_code' | 'assigned_group' | 'evaluators' | 'field'
  | 'original_code' | 'project_title' | 'leader_id' | 'leader_name' | 'password_set' | 'advisor';
export type ProjectSortDirection = 'ascending' | 'descending';

const collator = new Intl.Collator('zh-TW', { numeric: true, sensitivity: 'base' });

function sortValue(project: ProjectItem, key: ProjectSortKey): string | number | null {
  if (key === 'evaluators') return project.evaluators?.join('、') || null;
  if (key === 'password_set') return project.password_set ? 1 : 0;
  const value = project[key];
  return value === undefined || value === '' ? null : value;
}

export function sortProjects(projects: ProjectItem[], key: ProjectSortKey, direction: ProjectSortDirection): ProjectItem[] {
  const multiplier = direction === 'ascending' ? 1 : -1;
  return projects.map((project, index) => ({ project, index })).sort((a, b) => {
    const left = sortValue(a.project, key);
    const right = sortValue(b.project, key);
    // Unassigned groups and undrawn codes stay at the end in both directions.
    if (left === null || right === null) return left === right ? a.index - b.index : left === null ? 1 : -1;
    const compared = typeof left === 'number' && typeof right === 'number'
      ? left - right : collator.compare(String(left), String(right));
    return compared * multiplier || a.index - b.index;
  }).map(({ project }) => project);
}
