import type { DomainConfig, ProjectItem } from '../types';
import { allocateDomainSubgroups, isAdvisorConflict, normalizeProfessorName } from './lottery';
import { LotteryAllocationError } from './groupCapacities';
import { domainCodeCollisionError, getDrawCodeNamespace } from './domainCodes';

export interface LotteryTestDomain {
  field: string;
  projectCount: number;
  groups: { group: number; count: number; target: number | null }[];
  issues: { level: 'error' | 'warning'; message: string }[];
  preview: { originalCode: string; drawCode: string; title: string; group: number }[];
}

export interface LotteryTestResult {
  success: true;
  version: number;
  testedAt: string;
  field: string;
  projectCount: number;
  errorCount: number;
  warningCount: number;
  domains: LotteryTestDomain[];
}

// Uses the real allocation function, but returns an explicit report without mutating input.
export function testLottery(projects: ProjectItem[], configs: DomainConfig[], field: string, version: number): LotteryTestResult {
  const pool = projects.filter(p => field === 'ALL' || p.field === field);
  const fields = [...new Set(pool.map(p => p.field))];
  const seenCodes = new Map<string, LotteryTestDomain>();
  const domains = fields.map(name => {
    const cfg = configs.find(c => c.field === name);
    const groupCount = cfg?.groupCount || 2;
    const items = pool.filter(p => p.field === name);
    const result: LotteryTestDomain = {
      field: name, projectCount: items.length,
      groups: Array.from({ length: groupCount }, (_, i) => ({ group: i + 1, count: 0, target: cfg?.groupCapacities?.[i + 1] ?? null })),
      issues: [], preview: [],
    };
    const relatedFields = [...configs.map(c => c.field), ...projects.map(p => p.field)]
      .filter(other => getDrawCodeNamespace(other, configs) === getDrawCodeNamespace(name, configs));
    const collision = domainCodeCollisionError([name, ...relatedFields], configs);
    if (collision) {
      result.issues.push({ level: 'error', message: collision });
      return result;
    }
    if (!cfg) result.issues.push({ level: 'warning', message: '未找到領域設定，正式抽籤會使用預設 2 組。' });
    for (let group = 1; group <= groupCount; group++) {
      if (cfg?.groupCapacities?.[group] === 0) continue;
      const names = cfg?.evaluatorsPerGroup?.[group] || [];
      if (!names.length) result.issues.push({ level: 'warning', message: `第 ${group} 組尚未設定評審，無法確認評審安排是否完整。` });
      else if (names.some(name => !normalizeProfessorName(name))) result.issues.push({ level: 'warning', message: `第 ${group} 組含空白或只有職稱的評審姓名，請修正設定。` });
    }
    try {
      const drawn = allocateDomainSubgroups(items, groupCount, name, cfg?.evaluatorsPerGroup || {}, cfg?.groupCapacities, cfg?.code);
      for (const p of drawn) {
        result.groups[p.assigned_group! - 1].count++;
        if (isAdvisorConflict(p.advisor, p.evaluators)) result.issues.push({ level: 'error', message: `${p.original_code}「${p.project_title}」在第 ${p.assigned_group} 組與指導老師有利益衝突。` });
        const previous = seenCodes.get(p.draw_code!);
        if (previous) {
          const message = `抽籤後編號 ${p.draw_code} 重複，涉及「${previous.field}」與「${name}」，請檢查領域名稱與代碼。`;
          result.issues.push({ level: 'error', message });
          if (previous !== result) previous.issues.push({ level: 'error', message });
        } else seenCodes.set(p.draw_code!, result);
        result.preview.push({ originalCode: p.original_code, drawCode: p.draw_code!, title: p.project_title, group: p.assigned_group! });
      }
      if (cfg?.groupCapacities) {
        if (result.groups.some(g => g.count !== g.target)) result.issues.push({ level: 'error', message: '試跑分配件數與各組指定件數不符。' });
      } else {
        const counts = result.groups.map(g => g.count);
        if (Math.max(...counts) - Math.min(...counts) > 1) result.issues.push({ level: 'warning', message: '本次自動分組件數差超過 1 件；需要固定件數時，請設定各組專題件數。' });
      }
    } catch (error) {
      if (!(error instanceof LotteryAllocationError)) throw error;
      result.issues.push({ level: 'error', message: error.message });
    }
    return result;
  });
  for (const domain of domains) domain.issues.sort((a, b) => Number(b.level === 'error') - Number(a.level === 'error'));
  const issues = domains.flatMap(d => d.issues);
  return {
    success: true, version, testedAt: new Date().toISOString(), field, projectCount: pool.length, domains,
    errorCount: issues.filter(i => i.level === 'error').length,
    warningCount: issues.filter(i => i.level === 'warning').length,
  };
}
