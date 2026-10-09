import type { ProjectItem, DomainConfig } from '../types';
import { getDomainCode } from './domainCodes';

// Keep valid identifiers stable; allocate unused numbers to legacy/new/duplicate entries.
// Group by the letter code so punctuation aliases cannot produce duplicate identifiers.
export function normalizeOriginalCodes<T extends ProjectItem>(projects: T[], configs: DomainConfig[] = []): T[] {
  const used = new Map<string, Set<number>>();
  const retained = new Map<number, string>();
  projects.forEach((project, index) => {
    const prefix = getDomainCode(project.field, configs);
    if (!prefix) return;
    const numbers = used.get(prefix) || new Set<number>();
    used.set(prefix, numbers);
    const match = project.original_code.match(/^([A-Z])(\d{2,})$/);
    const number = match ? Number(match[2]) : 0;
    if (match?.[1] === prefix && Number.isSafeInteger(number) && number > 0
      && project.original_code === `${prefix}${String(number).padStart(2, '0')}` && !numbers.has(number)) {
      numbers.add(number);
      retained.set(index, project.original_code);
    }
  });
  const next = new Map<string, number>();
  return projects.map((project, index) => {
    const prefix = getDomainCode(project.field, configs);
    if (!prefix) return project;
    let code = retained.get(index);
    if (!code) {
      const numbers = used.get(prefix)!;
      let number = next.get(prefix) || 1;
      while (numbers.has(number)) number++;
      numbers.add(number);
      next.set(prefix, number + 1);
      code = `${prefix}${String(number).padStart(2, '0')}`;
    }
    return { ...project, original_code: code };
  });
}
