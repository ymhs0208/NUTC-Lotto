import { isCompleteDrawResult, compareDrawCodes } from '../src/lib/drawScope';
import type { DomainConfig, ProjectItem, PublicResultsResponse } from '../src/types';
import { sortDomainConfigs } from '../src/lib/domainCodes';

/** Explicit public allowlist; roster identifiers and credentials stay on the server. */
export function publicResults(projects: ProjectItem[], configs: DomainConfig[], field?: string): PublicResultsResponse {
  const domains = [...new Set([...sortDomainConfigs(configs).map(config => config.field), ...projects.map(project => project.field)])];
  const results = !field ? [] : projects
    .filter(project => project.field === field && isCompleteDrawResult(project))
    .sort((a, b) => (a.assigned_group ?? Infinity) - (b.assigned_group ?? Infinity)
      || compareDrawCodes(a, b))
    .map(project => ({
      draw_code: project.draw_code!, assigned_group: project.assigned_group ?? null,
      project_title: project.project_title, leader_name: project.leader_name?.trim() || '',
    }));
  return { domains, results };
}
