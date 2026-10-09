import { ProjectItem, DomainConfig } from '../types';
import { secureFisherYatesShuffle } from './cryptoRandom';

import { getDomainCode, getDrawCodeNamespace, domainCodeCollisionError } from './domainCodes';
import { LotteryAllocationError, validateGroupCapacities } from './groupCapacities';
export { getDomainCode } from './domainCodes';

/**
 * Normalize professor names to compare without titles (e.g. "林建宏教授" -> "林建宏")
 */
export function normalizeProfessorName(name: string): string {
  if (!name) return '';
  return name
    .trim()
    .replace(/(特聘|講座|終身)?(教授|副教授|助理教授|講師|老師|博士|院長|主任|委員)/g, '')
    .replace(/\s+/g, '');
}

/**
 * Check if a project's advisor conflicts with any of the group's evaluators
 */
export function isAdvisorConflict(advisor: string, evaluators: string[] = []): boolean {
  if (!advisor || evaluators.length === 0) return false;
  const normAdvisor = normalizeProfessorName(advisor);
  if (!normAdvisor) return false;
  return evaluators.some((ev) => {
    const normEv = normalizeProfessorName(ev);
    if (!normEv) return false;
    return normAdvisor === normEv || normAdvisor.includes(normEv) || normEv.includes(normAdvisor);
  });
}

/**
 * Allocate a domain using exact capacity matching when counts are configured;
 * otherwise retain legacy automatic grouping. CSPRNG shuffles presentation order.
 */
export function allocateDomainSubgroups(
  domainProjects: ProjectItem[],
  groupCount: number,
  domainField: string,
  evaluatorsPerGroup: Record<number, string[]> = {},
  groupCapacities?: Record<number, number>,
  code?: string
): ProjectItem[] {
  const k = Math.max(1, groupCount);
  const now = new Date().toISOString();
  const domainPrefix = getDrawCodeNamespace(domainField);
  const domainCode = code ?? getDomainCode(domainField);
  if (groupCapacities !== undefined) {
    validateGroupCapacities(groupCapacities, k, domainField);
    const total = Object.values(groupCapacities).reduce((sum, count) => sum + count, 0);
    if (total !== domainProjects.length) {
      throw new LotteryAllocationError(`「${domainField}」各組設定共 ${total} 件，但名冊有 ${domainProjects.length} 件；請調整每組件數後再抽籤。`);
    }
  }

  // Group buckets
  const buckets: Record<number, ProjectItem[]> = {};
  for (let g = 1; g <= k; g++) {
    buckets[g] = [];
  }

  // Cryptographically secure uniform Fisher-Yates shuffle before assignment
  const shuffledProjects = secureFisherYatesShuffle(domainProjects);

  // Calculate constraint scores: how many groups are valid for each project
  const analyzedProjects = shuffledProjects.map((p) => {
    const validGroups: number[] = [];
    for (let g = 1; g <= k; g++) {
      const evaluators = evaluatorsPerGroup[g] || [];
      if (!isAdvisorConflict(p.advisor, evaluators)) {
        validGroups.push(g);
      }
    }
    return {
      project: p,
      validGroups: groupCapacities !== undefined ? validGroups : validGroups.length > 0 ? validGroups : Array.from({ length: k }, (_, i) => i + 1),
    };
  });

  // Sort most-constrained projects first (projects with fewer valid groups get prioritized)
  analyzedProjects.sort((a, b) => a.validGroups.length - b.validGroups.length);

  if (groupCapacities !== undefined) {
    // Capacitated bipartite matching: move earlier assignments along augmenting paths
    // so a greedy choice cannot block an otherwise feasible exact allocation.
    const members: Record<number, number[]> = {};
    for (let g = 1; g <= k; g++) members[g] = [];
    const assign = (index: number, visitedGroups: Set<number>): boolean => {
      for (const group of secureFisherYatesShuffle(analyzedProjects[index].validGroups)) {
        if (visitedGroups.has(group) || groupCapacities[group] === 0) continue;
        visitedGroups.add(group);
        if (members[group].length < groupCapacities[group]) {
          members[group].push(index);
          return true;
        }
        for (const previous of secureFisherYatesShuffle(members[group])) {
          if (assign(previous, visitedGroups)) {
            members[group].splice(members[group].indexOf(previous), 1, index);
            return true;
          }
        }
      }
      return false;
    };
    for (let index = 0; index < analyzedProjects.length; index++) {
      if (!assign(index, new Set())) {
        throw new LotteryAllocationError(`「${domainField}」無法同時滿足各組件數與指導老師迴避，請調整各組件數或評審名單後再抽籤。`);
      }
    }
    for (let g = 1; g <= k; g++) buckets[g] = members[g].map(index => analyzedProjects[index].project);
  } else {
    // Legacy automatic allocation, retained for domains without explicit counts.
    analyzedProjects.forEach(({ project, validGroups }) => {
      // Randomize validGroups order first with Fisher-Yates, then pick group with fewest members
      const shuffledValidGroups = secureFisherYatesShuffle(validGroups);
      shuffledValidGroups.sort((gA, gB) => buckets[gA].length - buckets[gB].length);
      const chosenGroup = shuffledValidGroups[0] || 1;
      buckets[chosenGroup].push(project);
    });
  }

  // For each bucket, cryptographically Fisher-Yates shuffle within group to assign draw codes
  const results: ProjectItem[] = [];

  for (let g = 1; g <= k; g++) {
    const groupItems = buckets[g] || [];
    // Strict Fisher-Yates uniform shuffle inside the subgroup
    const internalShuffled = secureFisherYatesShuffle(groupItems);
    const groupEvaluators = evaluatorsPerGroup[g] || [];

    internalShuffled.forEach((item, idx) => {
      const codeNumber = idx + 1;
      // One sequence per domain, continuing across groups to keep codes unique.
      const drawCode = domainCode
        ? `${domainCode}${String(results.length + 1).padStart(2, '0')}`
        : `${domainPrefix}-第${g}組-序號${String(codeNumber).padStart(2, '0')}`;

      results.push({
        ...item,
        assigned_group: g,
        draw_code: drawCode,
        draw_time: now,
        evaluators: groupEvaluators,
      });
    });
  }

  return results;
}

/**
 * Execute whole-school lottery:
 * Loops through EACH domain independently, respects each domain's groupCount,
 * and enforces advisor conflict of interest.
 */
export function executeAllDomainsIndependentLottery(
  allProjects: ProjectItem[],
  domainConfigs: DomainConfig[]
): {
  updatedProjects: ProjectItem[];
  conflictCount: number;
  domainSummaries: { field: string; count: number; groupCount: number }[];
} {
  const collision = domainCodeCollisionError([...domainConfigs.map(c => c.field), ...allProjects.map(p => p.field)], domainConfigs);
  if (collision) throw new LotteryAllocationError(collision);
  const domainMap = new Map(domainConfigs.map(c => [c.field, c]));

  // Group projects by field
  const projectsByField = new Map<string, ProjectItem[]>();
  allProjects.forEach((p) => {
    const items = projectsByField.get(p.field) || [];
    items.push(p);
    projectsByField.set(p.field, items);
  });

  let allUpdated: ProjectItem[] = [];
  let totalConflicts = 0;
  const summaries: { field: string; count: number; groupCount: number }[] = [];

  projectsByField.forEach((domainItems, fieldName) => {
    const cfg = domainMap.get(fieldName);
    const groupCount = cfg?.groupCount || 2;
    const evaluatorsPerGroup = cfg?.evaluatorsPerGroup || {};

    const allocated = allocateDomainSubgroups(
      domainItems,
      groupCount,
      fieldName,
      evaluatorsPerGroup,
      cfg?.groupCapacities,
      cfg?.code
    );

    // Verify conflict of interest
    allocated.forEach((p) => {
      if (p.assigned_group && isAdvisorConflict(p.advisor, evaluatorsPerGroup[p.assigned_group] || [])) {
        totalConflicts++;
      }
    });

    allUpdated = [...allUpdated, ...allocated];
    summaries.push({
      field: fieldName,
      count: domainItems.length,
      groupCount,
    });
  });

  // Preserve original ordering or sort by sequence
  const finalSorted = allUpdated.sort(
    (a, b) => parseInt(a.seq_no, 10) - parseInt(b.seq_no, 10)
  );

  return {
    updatedProjects: finalSorted,
    conflictCount: totalConflicts,
    domainSummaries: summaries,
  };
}
