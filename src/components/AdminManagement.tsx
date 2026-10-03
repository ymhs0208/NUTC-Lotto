import React, { useState, useRef } from 'react';
import { ProjectItem, DomainStats, DomainConfig } from '../types';
import { preserveImportedProjectIds } from '../lib/importProjects';
import { isAdvisorConflict, normalizeProfessorName } from '../lib/lottery';
import { sortProjects, type ProjectSortKey, type ProjectSortDirection } from '../lib/projectSort';
import { useModalFocus } from '../lib/useModalFocus';
import { FloatingNotice } from './FloatingNotice';
import { ProjectRosterCard } from './ProjectRosterCard';
import { LotteryTestPanel } from './LotteryTestPanel';
import { getDomainCode } from '../lib/domainCodes';
import { normalizeOriginalCodes } from '../lib/originalCodes';
import { domainDeletionError } from '../lib/domainDeletion';
import {
  Upload,
  Download,
  FileSpreadsheet,
  Plus,
  Trash2,
  Edit,
  Search,
  Filter,
  CheckCircle2,
  AlertTriangle,
  Layers,
  Info,
  X,
  Settings2,
  FolderPlus,
  UserCheck,
  ShieldCheck,
  Users,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  LoaderCircle,
  Copy,
  KeyRound
} from 'lucide-react';

interface AdminManagementProps {
  projects: ProjectItem[];
  dataVersion: number | null;
  onSaveProjects: (updated: ProjectItem[]) => Promise<void>;
  sharedPasswordEnabled: boolean;
  onSharedPassword: (action: 'generate' | 'clear') => Promise<string | undefined>;
  domainList: string[];
  domainConfigs: DomainConfig[];
  onUpdateDomainConfigs: (configs: DomainConfig[], renamedField?: { oldName: string; newName: string }) => Promise<void>;
}

export const AdminManagement: React.FC<AdminManagementProps> = ({
  projects,
  dataVersion,
  onSaveProjects,
  sharedPasswordEnabled,
  onSharedPassword,
  domainList,
  domainConfigs,
  onUpdateDomainConfigs,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedFieldFilter, setSelectedFieldFilter] = useState<string>('ALL');
  const [excelAction, setExcelAction] = useState<'import' | 'export' | 'template' | null>(null);
  const excelActionRef = useRef<'import' | 'export' | 'template' | null>(null);
  const [isPreparingExcel, setIsPreparingExcel] = useState(false);
  const [uploadFeedback, setUploadFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [adminProjectDisplayMode, setAdminProjectDisplayMode] = useState<'table' | 'cards'>('table');
  const [domainDisplayMode, setDomainDisplayMode] = useState<'table' | 'cards'>('table');
  const [projectSort, setProjectSort] = useState<{ key: ProjectSortKey; direction: ProjectSortDirection } | null>(null);
  const [sharedAction, setSharedAction] = useState<'generate' | 'clear' | null>(null);
  const [generatedPassword, setGeneratedPassword] = useState<string | null>(null);
  const [sharedSaving, setSharedSaving] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const pendingActionRef = useRef<string | null>(null);
  const [passwordCopied, setPasswordCopied] = useState(false);
  const [passwordCopyError, setPasswordCopyError] = useState(false);
  const draftVersionRef = useRef<number | null>(dataVersion);

  const submitSharedAction = async () => {
    if (!sharedAction || sharedSaving) return;
    setSharedSaving(true);
    try {
      const password = await onSharedPassword(sharedAction);
      setSharedAction(null);
      setGeneratedPassword(password || null);
      setPasswordCopied(false);
      setPasswordCopyError(false);
      setUploadFeedback(password ? null : { type: 'success', message: '共用密碼已停用，請為學生重新設定個別密碼。' });
    } catch (error) {
      setUploadFeedback({ type: 'error', message: error instanceof Error ? error.message : '共用密碼設定失敗' });
    } finally { setSharedSaving(false); }
  };

  const copyGeneratedPassword = async () => {
    if (!generatedPassword) return;
    try {
      await navigator.clipboard.writeText(generatedPassword);
      setPasswordCopied(true);
      setPasswordCopyError(false);
    } catch {
      setPasswordCopyError(true);
    }
  };

  const withSaveFeedback = <Args extends unknown[]>(key: string | ((...args: Args) => string), action: (...args: Args) => Promise<void>) =>
    async (...args: Args) => {
      if (pendingActionRef.current) {
        (args[0] as { preventDefault?: () => void } | undefined)?.preventDefault?.();
        return;
      }
      if (draftIsStale) {
        (args[0] as { preventDefault?: () => void } | undefined)?.preventDefault?.();
        setUploadFeedback({ type: 'error', message: '其他裝置或操作已更新資料。請先關閉舊編輯視窗，再從最新資料重新開啟。' });
        return;
      }
      const actionKey = typeof key === 'function' ? key(...args) : key;
      pendingActionRef.current = actionKey;
      setPendingAction(actionKey);
      try { await action(...args); }
      catch (error) {
        setUploadFeedback({ type: 'error', message: error instanceof Error ? error.message : '儲存失敗' });
      } finally {
        pendingActionRef.current = null;
        setPendingAction(null);
      }
    };

  // In-app modals for file import & delete confirmation
  const [pendingImportProjects, setPendingImportProjects] = useState<ProjectItem[] | null>(null);
  const [overwriteAcknowledged, setOverwriteAcknowledged] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<{ id: string; title: string } | null>(null);

  // Edit / Add Project modal state
  const [editingProject, setEditingProject] = useState<ProjectItem | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState<boolean>(false);
  const [formValidationNotice, setFormValidationNotice] = useState<string | null>(null);
  const [projectSaving, setProjectSaving] = useState(false);

  // Edit / Add Domain modal state
  const [isDomainModalOpen, setIsDomainModalOpen] = useState<boolean>(false);
  const [editingDomain, setEditingDomain] = useState<DomainConfig | null>(null);
  const [domainToDelete, setDomainToDelete] = useState<DomainConfig | null>(null);
  const domainDeleteBlockedMessage = domainToDelete
    ? domainDeletionError(projects, domainConfigs, domainConfigs.filter(config => config.id !== domainToDelete.id))
    : null;
  const [domainFormName, setDomainFormName] = useState<string>('');
  const [domainFormPrefix, setDomainFormPrefix] = useState('');
  const [domainFormGroupCount, setDomainFormGroupCount] = useState<number>(2);
  const [domainManualCounts, setDomainManualCounts] = useState(false);
  const [domainCapacityDrafts, setDomainCapacityDrafts] = useState<Record<number, string>>({});
  const [domainFormError, setDomainFormError] = useState<string | null>(null);

  // Evaluators (Reviewer Professors) Modal State
  const [isEvaluatorModalOpen, setIsEvaluatorModalOpen] = useState<boolean>(false);
  const [domainForEvaluators, setDomainForEvaluators] = useState<DomainConfig | null>(null);
  const [evaluatorDrafts, setEvaluatorDrafts] = useState<Record<number, string>>({});

  const draftOpen = !!(pendingImportProjects || projectToDelete || editingProject || isAddModalOpen || isDomainModalOpen || domainToDelete || isEvaluatorModalOpen);
  const draftIsStale = draftOpen && draftVersionRef.current !== dataVersion;
  const beginDraft = () => { draftVersionRef.current = dataVersion; };

  // Form state for project add/edit
  const [formData, setFormData] = useState<Partial<ProjectItem>>({
    education_system: '日間部四技',
    department: '資訊管理系',
    class_name: '資管四甲',
    advisor: '',
    field: domainList[0] || '企業智慧化',
    original_code: '',
    project_title: '',
    leader_id: '',
    password: '',
    draw_code: '',
  });

  // Calculate live domain statistics dynamically
  const automaticOriginalCode = React.useMemo(() => {
    if (!getDomainCode(formData.field || '')) return undefined;
    const candidate = { ...formData, original_code: formData.original_code || '', id: editingProject?.id || '__code_preview__' } as ProjectItem;
    const roster = editingProject
      ? projects.map(p => p.id === editingProject.id ? candidate : p)
      : [...projects, candidate];
    return normalizeOriginalCodes(roster).find(p => p.id === candidate.id)?.original_code;
  }, [formData, editingProject, projects]);

  const statsMap: Record<string, number> = Object.create(null);
  projects.forEach((p) => {
    statsMap[p.field] = (statsMap[p.field] || 0) + 1;
  });

  // Derived statistics linked directly with customizable domainConfigs
  const domainStats: (DomainStats & { id: string; evaluatorsPerGroup?: Record<number, string[]>; groupCapacities?: Record<number, number> })[] = domainConfigs.map((cfg) => {
    return {
      id: cfg.id,
      field: cfg.field,
      count: statsMap[cfg.field] || 0,
      groupCount: cfg.groupCount,
      evaluatorsPerGroup: cfg.evaluatorsPerGroup,
      groupCapacities: cfg.groupCapacities,
    };
  });

  const totalProjectsCount = projects.length;
  const totalGroupCount = domainStats.reduce((acc, curr) => acc + curr.groupCount, 0);

  // Filtered projects
  const filteredProjects = projects.filter((p) => {
    const matchesField = selectedFieldFilter === 'ALL' || p.field === selectedFieldFilter;
    const q = searchQuery.trim().toLowerCase();
    if (!q) return matchesField;
    const matchesSearch =
      p.project_title.toLowerCase().includes(q) ||
      p.leader_id.toLowerCase().includes(q) ||
      p.original_code.toLowerCase().includes(q) ||
      p.advisor.toLowerCase().includes(q) ||
      p.class_name.toLowerCase().includes(q) ||
      (p.draw_code && p.draw_code.toLowerCase().includes(q));
    return matchesField && matchesSearch;
  });
  const displayedProjects = projectSort
    ? sortProjects(filteredProjects, projectSort.key, projectSort.direction)
    : filteredProjects;
  const sortableHeader = (key: ProjectSortKey, label: string) => {
    const direction = projectSort?.key === key ? projectSort.direction : null;
    return (
      <th scope="col" aria-sort={direction || 'none'} className="px-3 py-2.5">
        <button
          type="button"
          onClick={() => setProjectSort((current) => ({
            key, direction: current?.key === key && current.direction === 'ascending' ? 'descending' : 'ascending',
          }))}
          className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-1 py-1 text-left transition-colors hover:bg-slate-200 focus-visible:outline-2 focus-visible:outline-blue-600 cursor-pointer ${direction ? 'font-bold text-blue-800' : ''}`}
          title={`${label}：${direction === 'ascending' ? '升冪，點擊改為降冪' : direction === 'descending' ? '降冪，點擊改為升冪' : '點擊以升冪排序'}`}
        >
          <span>{label}</span>
          {direction === 'ascending' ? <ArrowUp aria-hidden="true" className="h-3.5 w-3.5" />
            : direction === 'descending' ? <ArrowDown aria-hidden="true" className="h-3.5 w-3.5" />
            : <ArrowUpDown aria-hidden="true" className="h-3.5 w-3.5 text-slate-400" />}
        </button>
      </th>
    );
  };

  // Open modal to Add Domain
  const handleOpenAddDomain = () => {
    beginDraft();
    setEditingDomain(null);
    setDomainFormName('');
    setDomainFormPrefix('');
    setDomainFormGroupCount(2);
    setDomainManualCounts(false);
    setDomainCapacityDrafts({});
    setDomainFormError(null);
    setIsDomainModalOpen(true);
  };

  // Open modal to Edit Domain
  const handleOpenEditDomain = (cfg: DomainConfig) => {
    beginDraft();
    setEditingDomain(cfg);
    setDomainFormName(cfg.field);
    setDomainFormPrefix(cfg.drawPrefix || getDomainCode(cfg.field) || '');
    setDomainFormGroupCount(cfg.groupCount);
    setDomainManualCounts(!!cfg.groupCapacities);
    setDomainCapacityDrafts(Object.fromEntries(Object.entries(cfg.groupCapacities || {}).map(([group, count]) => [group, String(count)])));
    setDomainFormError(null);
    setIsDomainModalOpen(true);
  };

  // Open Evaluator modal for a specific domain
  const handleOpenEvaluatorModal = (cfg: DomainConfig) => {
    beginDraft();
    setDomainForEvaluators(cfg);
    const drafts: Record<number, string> = {};
    for (let g = 1; g <= cfg.groupCount; g++) {
      const list = cfg.evaluatorsPerGroup?.[g] || [];
      drafts[g] = list.join('、');
    }
    setEvaluatorDrafts(drafts);
    setIsEvaluatorModalOpen(true);
  };

  // Save Evaluators for Domain
  const handleSaveEvaluators = withSaveFeedback('evaluators', async (e: React.FormEvent) => {
    e.preventDefault();
    if (!domainForEvaluators) return;

    const parsedEvaluators: Record<number, string[]> = {};
    for (let g = 1; g <= domainForEvaluators.groupCount; g++) {
      const raw = evaluatorDrafts[g] || '';
      const list = raw
        .split(/[、,，\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (list.some(name => !normalizeProfessorName(name))) {
        throw new Error(`「${domainForEvaluators.field}」第 ${g} 組的評審姓名不可僅有職稱，請填寫完整姓名。`);
      }
      parsedEvaluators[g] = list;
    }

    const updatedConfigs = domainConfigs.map((c) =>
      c.id === domainForEvaluators.id
        ? { ...c, evaluatorsPerGroup: parsedEvaluators }
        : c
    );

    await onUpdateDomainConfigs(updatedConfigs);

    setUploadFeedback({
      type: 'success',
      message: `成功更新「${domainForEvaluators.field}」之各組評審委員名冊！`,
    });

    setIsEvaluatorModalOpen(false);
  });

  // Save Domain (Add or Edit)
  const handleSaveDomain = withSaveFeedback('domain', async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = domainFormName.trim();
    if (!cleanName) {
      setDomainFormError('請輸入領域名稱！');
      return;
    }
    const drawPrefix = domainFormPrefix || undefined;
    const effectivePrefix = getDomainCode(cleanName, drawPrefix);
    if (effectivePrefix && domainConfigs.some(c => c.id !== editingDomain?.id && getDomainCode(c.field, c.drawPrefix) === effectivePrefix)) {
      setDomainFormError(`抽籤結果字母 ${effectivePrefix} 已被其他領域使用，請選擇不同字母。`);
      return;
    }
    if (!Number.isInteger(domainFormGroupCount) || domainFormGroupCount < 1 || domainFormGroupCount > 50) {
      setDomainFormError('分組組數須為 1 至 50 組的整數！');
      return;
    }

    let groupCapacities: Record<number, number> | undefined;
    if (domainManualCounts) {
      groupCapacities = {};
      for (let group = 1; group <= domainFormGroupCount; group++) {
        const value = domainCapacityDrafts[group] ?? '';
        const count = Number(value);
        if (!value.trim() || !Number.isInteger(count) || count < 0 || count > 2000) {
          setDomainFormError(`第 ${group} 組請填寫 0 至 2000 件的整數。`);
          return;
        }
        groupCapacities[group] = count;
      }
    }

    if (editingDomain) {
      const duplicate = domainConfigs.find(
        (c) => c.id !== editingDomain.id && c.field.toLowerCase() === cleanName.toLowerCase()
      );
      if (duplicate) {
        setDomainFormError(`已存在相同名稱的領域「${cleanName}」！`);
        return;
      }

      const isRenamed = editingDomain.field !== cleanName;
      const oldName = editingDomain.field;

      const current = domainConfigs.find(c => c.id === editingDomain.id);
      if (!current) throw new Error('此領域已不存在，請重新整理後再操作。');
      const updatedConfigs = domainConfigs.filter(c => c.id !== editingDomain.id);
      updatedConfigs.splice(domainConfigs.findIndex(c => c.id === editingDomain.id), 0, {
        ...current, field: cleanName, drawPrefix, groupCount: Number(domainFormGroupCount), groupCapacities,
        evaluatorsPerGroup: Object.fromEntries(Object.entries(current.evaluatorsPerGroup || {})
          .filter(([group]) => /^[1-9]\d*$/.test(group) && Number(group) <= domainFormGroupCount)),
      });

      await onUpdateDomainConfigs(
        updatedConfigs,
        isRenamed ? { oldName, newName: cleanName } : undefined
      );

      setUploadFeedback({
        type: 'success',
        message: `成功更新領域「${cleanName}」（顯示代碼：${effectivePrefix || '領域名稱'}，組數：${domainFormGroupCount} 組）${
          isRenamed ? `，並同步更新原「${oldName}」之專題資料` : ''
        }！`,
      });
    } else {
      const duplicate = domainConfigs.find(
        (c) => c.field.toLowerCase() === cleanName.toLowerCase()
      );
      if (duplicate) {
        setDomainFormError(`已存在相同名稱的領域「${cleanName}」！`);
        return;
      }

      const newDomain: DomainConfig = {
        id: `domain-${Date.now()}`,
        field: cleanName,
        drawPrefix,
        groupCount: Number(domainFormGroupCount),
        evaluatorsPerGroup: {},
        groupCapacities,
      };

      const updatedConfigs = [...domainConfigs];
      updatedConfigs.push(newDomain);
      await onUpdateDomainConfigs(updatedConfigs);

      setUploadFeedback({
        type: 'success',
        message: `成功新增專題展覽領域「${cleanName}」（顯示代碼：${effectivePrefix || '領域名稱'}，分組數：${domainFormGroupCount} 組）！`,
      });
    }

    setIsDomainModalOpen(false);
  });

  // Delete Domain
  const handleConfirmDeleteDomain = withSaveFeedback('delete-domain', async () => {
    if (!domainToDelete) return;

    const remainingConfigs = domainConfigs.filter((c) => c.id !== domainToDelete.id);
    const deletionError = domainDeletionError(projects, domainConfigs, remainingConfigs);
    if (deletionError) throw new Error(deletionError);
    const affectedCount = statsMap[domainToDelete.field] || 0;

    await onUpdateDomainConfigs(remainingConfigs);

    setUploadFeedback({
      type: 'success',
      message: `已刪除領域「${domainToDelete.field}」${
        affectedCount > 0 ? `，原 ${affectedCount} 筆專題已移至「${remainingConfigs[0]?.field || '未分類領域'}」` : ''
      }。`,
    });

    setDomainToDelete(null);
  });

  const withExcelTools = async (action: 'import' | 'export' | 'template', work: (tools: typeof import('../lib/excel')) => Promise<void> | void) => {
    if (excelActionRef.current) return;
    excelActionRef.current = action;
    setExcelAction(action);
    setIsPreparingExcel(true);
    setUploadFeedback(null);
    let loaded = false;
    try {
      const tools = await import('../lib/excel');
      loaded = true;
      setIsPreparingExcel(false);
      await work(tools);
    } catch {
      setUploadFeedback({ type: 'error', message: loaded
        ? 'Excel 操作失敗，請確認檔案內容與瀏覽器下載設定後再試。'
        : 'Excel 工具載入失敗，請檢查網路後再試；若網站已更新版本，請重新載入頁面。' });
    } finally {
      excelActionRef.current = null;
      setExcelAction(null);
      setIsPreparingExcel(false);
    }
  };

  // Load the parser only after the user selects a file.
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || excelActionRef.current) return;
    try {
      await withExcelTools('import', async ({ parseExcelFile }) => {
        const result = await parseExcelFile(file);
        if (result.success && result.projects) {
          beginDraft();
          setPendingImportProjects(result.projects);
          setOverwriteAcknowledged(false);
        } else {
          setUploadFeedback({ type: 'error', message: result.error || '讀取 Excel 失敗，請確認檔案格式' });
        }
      });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Confirm import mode (Overwrite or Append)
  const handleApplyImport = withSaveFeedback((mode: 'overwrite' | 'append') => `import-${mode}`, async (mode: 'overwrite' | 'append') => {
    if (!pendingImportProjects) return;

    let finalProjects: ProjectItem[] = [];
    if (mode === 'overwrite') {
      if (projects.some(p => p.draw_order) && !overwriteAcknowledged) {
        setUploadFeedback({ type: 'error', message: '名冊已有抽籤結果，請先勾選確認覆蓋風險。' });
        return;
      }
      finalProjects = preserveImportedProjectIds(pendingImportProjects, projects);
    } else {
      const existingLeaderIds = new Set(projects.map((p) => p.leader_id.trim().toLowerCase()));
      const newAdditions = pendingImportProjects.filter(
        (p) => !existingLeaderIds.has(p.leader_id.trim().toLowerCase())
      );
      finalProjects = [...projects, ...newAdditions];
    }

    if (sharedPasswordEnabled) finalProjects = finalProjects.map(({ password: _password, ...p }) => p as ProjectItem);
    await onSaveProjects(finalProjects);
    setUploadFeedback({
      type: 'success',
      message: `成功更新專題名冊！目前名冊共計 ${finalProjects.length} 筆，資料已即時寫入系統。`,
    });
    setPendingImportProjects(null);
    setOverwriteAcknowledged(false);
  });

  // Export Excel
  const handleExport = () => withExcelTools('export', ({ exportToExcel }) => exportToExcel(projects, '台中科技大學專題展報告抽籤結果'));
  const handleDownloadTemplate = () => withExcelTools('template', ({ downloadInputTemplate }) => downloadInputTemplate());

  // Confirm project deletion
  const handleConfirmDelete = withSaveFeedback('delete-project', async () => {
    if (!projectToDelete) return;
    const updated = projects.filter((p) => p.id !== projectToDelete.id);
    await onSaveProjects(updated);
    setProjectToDelete(null);
  });

  // Open edit modal for project
  const handleStartEdit = (p: ProjectItem) => {
    beginDraft();
    setEditingProject(p);
    setFormData({
      ...p,
      password: '',
    });
    setFormValidationNotice(null);
  };

  // Open add project modal
  const handleOpenAddProject = () => {
    beginDraft();
    setEditingProject(null);
    setFormData({
      education_system: '日間部四技',
      department: '資訊管理系',
      class_name: '資管四甲',
      advisor: '',
      field: domainList[0] || '企業智慧化',
      original_code: '',
      project_title: '',
      leader_id: '',
      draw_code: '',
    });
    setFormValidationNotice(null);
    setIsAddModalOpen(true);
  };

  const closeProjectModal = () => {
    if (projectSaving) return;
    setEditingProject(null);
    setIsAddModalOpen(false);
    setFormValidationNotice(null);
  };

  // Submit edit or add project
  const handleSaveModal = withSaveFeedback('project', async (e: React.FormEvent) => {
    e.preventDefault();
    if (projectSaving) return;
    if (!formData.project_title?.trim() || !formData.leader_id?.trim()) {
      setFormValidationNotice('請填寫專題名稱與組長學號！');
      return;
    }

    const cleanLeaderId = formData.leader_id.trim();
    const finalPassword = sharedPasswordEnabled ? '' : formData.password || '';
    if (finalPassword && (finalPassword.trim().length < 8 || finalPassword.length > 128 || finalPassword === cleanLeaderId)) {
      setFormValidationNotice('新密碼須為 8 至 128 字元，且不可使用學號。');
      return;
    }

    let updatedList: ProjectItem[];

    if (editingProject) {
      updatedList = projects.map((p) => {
        if (p.id === editingProject.id) {
          return {
            ...p,
            ...formData,
            leader_id: cleanLeaderId,
            password: finalPassword,
            draw_order: formData.draw_code === p.draw_code ? p.draw_order : formData.draw_code ? parseInt(String(formData.draw_code).replace(/\D/g, ''), 10) || p.draw_order : p.draw_order,
          } as ProjectItem;
        }
        return p;
      });
    } else {
      const nextSeq = String(projects.length + 1);
      const newProj: ProjectItem = {
        id: `manual-${Date.now()}`,
        seq_no: formData.seq_no || nextSeq,
        education_system: formData.education_system || '日間部四技',
        department: formData.department || '資訊管理系',
        class_name: formData.class_name || '資管四甲',
        advisor: formData.advisor || '專題指導老師',
        field: formData.field || domainList[0] || '企業智慧化',
        original_code: formData.original_code || `P-${nextSeq}`,
        project_title: formData.project_title,
        leader_id: cleanLeaderId,
        password: finalPassword,
        draw_order: formData.draw_code ? parseInt(String(formData.draw_code).replace(/\D/g, ''), 10) || null : null,
        draw_code: formData.draw_code || null,
        draw_time: formData.draw_code ? new Date().toISOString() : null,
      };
      updatedList = [...projects, newProj];
    }

    setProjectSaving(true);
    try {
      await onSaveProjects(updatedList);
      setEditingProject(null);
      setIsAddModalOpen(false);
      setFormValidationNotice(null);
    } finally {
      setProjectSaving(false);
    }
  });

  const activeModalKey = sharedAction ? 'shared-action' : generatedPassword ? 'shared-password'
    : isEvaluatorModalOpen ? 'evaluators' : isDomainModalOpen ? 'domain'
    : domainToDelete ? 'delete-domain' : pendingImportProjects ? 'import'
    : projectToDelete ? 'delete-project' : (isAddModalOpen || editingProject) ? 'project' : null;
  useModalFocus(activeModalKey, () => {
    if (pendingAction) return;
    if (sharedAction) { if (!sharedSaving) setSharedAction(null); }
    else if (generatedPassword) { setGeneratedPassword(null); setPasswordCopied(false); setPasswordCopyError(false); }
    else if (isEvaluatorModalOpen) setIsEvaluatorModalOpen(false);
    else if (isDomainModalOpen) setIsDomainModalOpen(false);
    else if (domainToDelete) setDomainToDelete(null);
    else if (pendingImportProjects) setPendingImportProjects(null);
    else if (projectToDelete) setProjectToDelete(null);
    else closeProjectModal();
  });

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 sm:px-6 space-y-6">
      {draftIsStale && <div role="alert" className="fixed top-3 left-3 right-3 z-[60] mx-auto max-w-xl rounded-xl border border-amber-400 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950 shadow-lg">
        資料已在其他裝置或操作中更新。這份草稿已過期，無法儲存；可先複製已輸入內容，再關閉視窗並以最新資料重新編輯。
      </div>}
      {/* Page title */}
      <div className="flex items-center gap-3 pb-1">
        <img
          src="/android-chrome-512x512.png"
          alt="國立臺中科技大學 資訊與流通學院"
          className="h-10 sm:h-11 w-auto object-contain shrink-0"
        />
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900">
            專題抽籤管理員後台
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            各領域獨立分組 · 各組評審委員名冊 · Excel 匯入/匯出
          </p>
        </div>
      </div>

      {/* Main admin actions */}
      <div className="space-y-4">
        <section aria-labelledby="roster-actions-heading" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs sm:rounded-3xl sm:p-5">
          <div className="mb-4">
            <h2 id="roster-actions-heading" className="flex items-center gap-2 text-sm font-bold text-slate-900 sm:text-base">
              <FileSpreadsheet className="h-4 w-4 text-blue-600" />專題名冊操作
            </h2>
            <p className="mt-1 text-xs text-slate-500">匯入或新增專題，也可下載範本及匯出結果。</p>
          </div>
          <input
            type="file"
            aria-label="選擇專題名冊檔案"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept=".xlsx, .xls, .csv"
            className="hidden"
          />
          <div aria-busy={!!excelAction} className="grid grid-cols-2 gap-2 lg:grid-cols-4 lg:gap-3 [&_button:disabled]:cursor-not-allowed [&_button:disabled]:opacity-50">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={!!excelAction}
              className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-2 py-2.5 text-xs sm:px-4 sm:text-sm font-bold text-white shadow-xs transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
              title="匯入專題名冊"
            >
              <Upload className="h-4 w-4 shrink-0" />
              <span>{excelAction === 'import' ? '讀取中…' : '匯入 Excel 名冊'}</span>
            </button>
            <button
              type="button"
              onClick={handleDownloadTemplate}
              disabled={!!excelAction}
              className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-2 py-2.5 text-xs sm:px-4 sm:text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 cursor-pointer"
              title="下載標準 Excel 名冊匯入範本"
            >
              <Download className="h-4 w-4 shrink-0" />
              <span>{excelAction === 'template' ? '準備中…' : '下載匯入範本'}</span>
            </button>
            <button
              type="button"
              onClick={handleExport}
              disabled={!!excelAction}
              className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-2 py-2.5 text-xs sm:px-4 sm:text-sm font-semibold text-emerald-800 transition-colors hover:bg-emerald-100 cursor-pointer"
              title="匯出含抽籤結果的 Excel 名冊"
            >
              <FileSpreadsheet className="h-4 w-4 shrink-0" />
              <span>{excelAction === 'export' ? '準備中…' : '匯出結果 Excel'}</span>
            </button>
            <button
              type="button"
              onClick={handleOpenAddProject}
              disabled={!!excelAction}
              className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-2 py-2.5 text-xs sm:px-4 sm:text-sm font-bold text-white shadow-xs transition-colors hover:bg-slate-800 cursor-pointer"
              title="手動新增單一專題"
            >
              <Plus className="h-4 w-4 shrink-0" />
              <span className="sm:hidden">新增專題</span><span className="hidden sm:inline">手動新增專題</span>
            </button>
          </div>
          {excelAction && <p role="status" className="mt-3 flex items-center gap-2 text-xs font-medium text-blue-800">
            <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            {isPreparingExcel ? '正在準備 Excel 工具…' : excelAction === 'import' ? '正在讀取 Excel 名冊…' : '正在產生 Excel 檔案…'}
          </p>}
        </section>

        <section aria-labelledby="password-actions-heading" className="flex flex-col gap-4 rounded-2xl border border-indigo-100 bg-indigo-50/40 p-4 shadow-xs sm:rounded-3xl sm:p-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-2 lg:justify-start lg:gap-4">
            <div>
              <h2 id="password-actions-heading" className="flex items-center gap-2 text-sm font-bold text-slate-900 sm:text-base">
                <ShieldCheck className="h-4 w-4 text-indigo-600" />學生共用密碼
              </h2>
              <p className="mt-1 text-xs text-slate-500">管理所有學生登入使用的共用密碼。</p>
            </div>
          </div>
          <div className={`grid gap-2 lg:w-auto lg:shrink-0 lg:gap-3 ${sharedPasswordEnabled ? 'grid-cols-2' : 'grid-cols-1'}`}>
            <button
              type="button"
              onClick={() => setSharedAction('generate')}
              disabled={!projects.length || sharedSaving}
              className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-2 py-2.5 text-xs sm:px-4 sm:text-sm font-bold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
            >
              <ShieldCheck className="h-4 w-4 shrink-0" />
              <span className="sm:hidden">{sharedPasswordEnabled ? '重新產生密碼' : '產生共用密碼'}</span><span className="hidden sm:inline">{sharedPasswordEnabled ? '重新產生共用密碼' : '產生全體共用密碼'}</span>
            </button>
            {sharedPasswordEnabled && (
              <button
                type="button"
                onClick={() => setSharedAction('clear')}
                disabled={sharedSaving}
                className="flex min-h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-2 py-2.5 text-xs sm:px-4 sm:text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
              >
                停用共用密碼
              </button>
            )}
          </div>
        </section>
      </div>

      {sharedAction && <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="確認共用密碼操作">
        <div className="bg-white rounded-2xl p-6 max-w-md w-full space-y-4 shadow-xl">
          <h2 className="text-lg font-bold">{sharedAction === 'generate' ? '產生全體共用密碼？' : '停用全體共用密碼？'}</h2>
          <p className="text-sm text-slate-700">{sharedAction === 'generate' ? '系統會產生一組 8 碼隨機英數密碼，取代所有學生目前的密碼並讓現有登入失效。新密碼只會顯示一次。知道其他組長學號的人也能用共用密碼查詢該組的專題名稱與抽籤結果；班級、指導老師等其他名冊資料不會顯示。' : '停用後所有學生都無法登入，直到管理員分別設定個別密碼。'}</p>
          <div className="flex justify-end gap-2"><button onClick={() => setSharedAction(null)} disabled={sharedSaving} className="px-4 py-2 rounded-lg border">取消</button><button onClick={() => void submitSharedAction()} disabled={sharedSaving} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 font-semibold text-white disabled:opacity-50">{sharedSaving && <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}{sharedSaving ? '處理中…' : '確認'}</button></div>
        </div>
      </div>}
      {generatedPassword && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs" role="dialog" aria-modal="true" aria-labelledby="shared-password-title" aria-describedby="shared-password-description">
          <div className="max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-3xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-start gap-4 border-b border-emerald-100 bg-emerald-50 px-5 py-6 sm:px-7">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-600 text-white" aria-hidden="true">
                <KeyRound className="h-6 w-6" />
              </span>
              <div>
                <p className="text-xs font-bold tracking-wide text-emerald-800">設定完成</p>
                <h2 id="shared-password-title" className="mt-1 text-xl font-black text-slate-900 sm:text-2xl">全體共用密碼已產生</h2>
                <p id="shared-password-description" className="mt-2 text-sm leading-relaxed text-slate-600">請立即複製並妥善提供給學生。</p>
              </div>
            </div>

            <div className="space-y-5 px-5 py-6 sm:px-7">
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-sm font-bold text-slate-700">學生共用密碼</span>
                  <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-900">僅顯示這一次</span>
                </div>
                <output className="block select-all break-all rounded-2xl border border-slate-700 bg-slate-900 px-4 py-5 text-center font-mono text-3xl font-bold tracking-[0.15em] text-white sm:text-4xl" aria-label="新產生的學生共用密碼">
                  {generatedPassword}
                </output>
              </div>

              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-950">
                關閉後無法再次查看；若重新產生，這組密碼會立即失效。
              </div>

              {passwordCopyError && <p role="alert" className="text-sm font-semibold text-rose-700">無法自動複製。請選取上方密碼手動複製。</p>}
              <div className="flex flex-col gap-2 sm:flex-row-reverse">
                <button
                  type="button"
                  onClick={() => void copyGeneratedPassword()}
                  className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
                >
                  {passwordCopied ? <CheckCircle2 className="h-5 w-5" aria-hidden="true" /> : <Copy className="h-5 w-5" aria-hidden="true" />}
                  {passwordCopied ? '已複製密碼' : '複製密碼'}
                </button>
                <button
                  type="button"
                  onClick={() => { setGeneratedPassword(null); setPasswordCopied(false); setPasswordCopyError(false); }}
                  className="min-h-12 rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500"
                >
                  關閉視窗
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Non-blocking feedback */}
      {uploadFeedback && (
        <FloatingNotice
          message={uploadFeedback.message}
          type={uploadFeedback.type}
          onClose={() => setUploadFeedback(null)}
        />
      )}

      {/* Domain & Group Count Pivot Table */}
      <div
        className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200 p-4 sm:p-6 shadow-xs"
      >
        <div className="mb-4 space-y-4 sm:mb-6">
          <div>
            <h2 className="text-sm sm:text-base font-bold text-slate-900 flex items-center gap-2">
              <Layers className="w-4 h-4 text-rose-600 shrink-0" />
              <span>專題展領域、分組數與評審委員設定</span>
            </h2>
          </div>

          <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
            <div className="flex items-center gap-3 text-sm text-slate-600" aria-label="領域與分組統計">
              <span className="text-xs font-medium text-slate-500">總計</span>
              <span><strong className="mr-1 text-xl font-bold tabular-nums text-[#28518a]">{totalProjectsCount}</strong>件</span>
              <span className="h-5 w-px bg-slate-300" aria-hidden="true" />
              <span><strong className="mr-1 text-xl font-bold tabular-nums text-[#356a32]">{totalGroupCount}</strong>組</span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
              <LotteryTestPanel version={dataVersion} configs={domainConfigs} disabled={!!pendingAction || draftOpen || !projects.length} />
              <button
                type="button"
                onClick={handleOpenAddDomain}
                className="flex h-10 items-center justify-center gap-1 whitespace-nowrap rounded-xl bg-slate-900 px-2 text-xs font-semibold text-white shadow-2xs transition-colors hover:bg-slate-800 active:bg-black cursor-pointer sm:gap-1.5 sm:px-3"
              >
                <FolderPlus className="h-3.5 w-3.5 shrink-0 text-amber-300 sm:h-4 sm:w-4" />
                <span>新增展覽領域</span>
              </button>
            </div>
          </div>
        </div>

        <div className="mb-4 flex items-center justify-between gap-3 md:justify-end">
          <div className="text-xs text-slate-500">共 {domainStats.length} 個領域</div>
          <div role="group" aria-label="展覽領域顯示方式" className="inline-flex shrink-0 items-center p-0.5 rounded-lg bg-slate-100 border border-slate-200 text-xs">
            {(['table', 'cards'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setDomainDisplayMode(mode)}
                aria-pressed={domainDisplayMode === mode}
                className={`px-2.5 py-1 rounded-md transition-all cursor-pointer font-medium ${domainDisplayMode === mode ? 'bg-white text-emerald-800 shadow-xs font-semibold' : 'text-slate-600 hover:text-slate-900'}`}
              >
                {mode === 'table' ? '表格檢視' : '卡片檢視'}
              </button>
            ))}
          </div>
        </div>

        {domainDisplayMode === 'cards' ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {domainStats.map(stat => {
            const drawnCount = projects.filter((p) => p.field === stat.field && p.draw_order).length;
            const isSelected = selectedFieldFilter === stat.field;
            const cfgObj = domainConfigs.find((c) => c.id === stat.id) || {
              id: stat.id,
              field: stat.field,
              groupCount: stat.groupCount,
              evaluatorsPerGroup: stat.evaluatorsPerGroup,
            };

            return (
              <div
                key={stat.id}
                className={`p-3.5 rounded-2xl border transition-colors ${
                  isSelected
                    ? 'bg-blue-50/60 border-blue-300 shadow-xs'
                    : 'bg-white border-slate-200 shadow-2xs'
                }`}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-slate-500">顯示代碼</span>
                  <span className="text-xs font-bold font-mono text-slate-600">{getDomainCode(cfgObj.field, cfgObj.drawPrefix) || '領域名稱'}</span>
                </div>
                {/* Header: Title & Group Count */}
                <div className="flex items-start justify-between gap-2 pb-2.5 border-b border-slate-100">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-bold text-slate-900 truncate">
                      {stat.field}
                    </h3>
                    <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px] text-slate-500 font-mono">
                      <span>專題: <strong className="text-slate-800 font-bold">{stat.count}</strong> 件</span>
                      <span className="text-slate-300">·</span>
                      <span className={drawnCount === stat.count && stat.count > 0 ? 'text-emerald-700 font-semibold' : 'text-slate-600'}>
                        抽籤進度: {drawnCount}/{stat.count}
                      </span>
                    </div>
                  </div>

                  {/* Group count is changed in the edit dialog. */}
                  <div className="shrink-0 flex flex-col items-end gap-1">
                    <span className="text-[10px] text-slate-400 font-medium">分組組數</span>
                    <span className="inline-flex items-center rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-bold text-slate-800" aria-label={`${stat.field}分組組數 ${stat.groupCount} 組`}>
                      {stat.groupCount} 組
                    </span>
                  </div>
                </div>

                {/* Body: Evaluators List */}
                <div className="py-2.5 text-xs border-b border-slate-100">
                  <div className="text-[11px] font-semibold text-slate-500 mb-1 flex items-center justify-between">
                    <span>各組評審名單：</span>
                    <span className="text-[10px] text-slate-400 font-mono">共 {stat.groupCount} 組</span>
                  </div>
                  <div className="space-y-1 bg-slate-50/70 p-2 rounded-xl border border-slate-100">
                    {Array.from({ length: stat.groupCount }, (_, i) => i + 1).map((g) => {
                      const evs = stat.evaluatorsPerGroup?.[g] || [];
                      return (
                        <div key={g} className="flex items-center text-[11px] gap-1.5">
                          <span className="w-4 h-4 rounded-full bg-slate-200 text-slate-700 text-[10px] font-mono font-bold flex items-center justify-center shrink-0">
                            {g}
                          </span>
                          {stat.groupCapacities && <span className="shrink-0 font-semibold text-blue-700">{stat.groupCapacities[g]} 件</span>}
                          <span className="text-slate-700 truncate">
                            {evs.length > 0 ? (
                              <span className="font-medium text-slate-900">{evs.join('、')}</span>
                            ) : (
                              <span className="text-slate-400 italic">尚未設定評審</span>
                            )}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Actions Footer */}
                <div className="pt-2.5 flex items-center justify-between gap-1.5">
                  <button
                    onClick={() => handleOpenEvaluatorModal(cfgObj)}
                    className="flex-1 py-1.5 px-2 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-semibold flex items-center justify-center gap-1 border border-blue-200 cursor-pointer transition-colors"
                  >
                    <Users className="w-3.5 h-3.5 shrink-0" />
                    <span>設定評審</span>
                  </button>

                  <button
                    onClick={() => handleOpenEditDomain(cfgObj)}
                    className="py-1.5 px-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium flex items-center justify-center gap-1 border border-slate-200 cursor-pointer transition-colors"
                    title="編輯領域、顯示代碼與分組組數"
                  >
                    <Edit className="w-3.5 h-3.5" />
                    <span>編輯</span>
                  </button>

                  <button
                    onClick={() => { beginDraft(); setDomainToDelete(cfgObj); }}
                    className="p-1.5 rounded-xl hover:bg-rose-50 text-slate-400 hover:text-rose-600 border border-transparent hover:border-rose-200 cursor-pointer transition-colors"
                    title="刪除"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[850px] text-left text-xs sm:text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200 text-xs">
                <th className="py-2.5 px-4 text-center border border-slate-200 whitespace-nowrap">顯示代碼</th>
                <th className="py-2.5 px-4 border border-slate-200">列標籤 (領域名稱)</th>
                <th className="py-2.5 px-4 text-center border border-slate-200">件數</th>
                <th className="py-2.5 px-4 text-center border border-slate-200">
                  分組組數
                </th>
                <th className="py-2.5 px-4 border border-slate-200">各組評審委員名單</th>
                <th className="py-2.5 px-4 text-center border border-slate-200">抽籤進度</th>
                <th className="py-2.5 px-4 text-right border border-slate-200">管理操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {domainStats.map(stat => {
                const drawnCount = projects.filter((p) => p.field === stat.field && p.draw_order).length;
                const isSelected = selectedFieldFilter === stat.field;
                const cfgObj = domainConfigs.find((c) => c.id === stat.id) || {
                  id: stat.id,
                  field: stat.field,
                  groupCount: stat.groupCount,
                  evaluatorsPerGroup: stat.evaluatorsPerGroup,
                };

                return (
                  <tr
                    key={stat.id}
                    className={`hover:bg-slate-50 transition-colors ${
                      isSelected ? 'bg-blue-50/70 font-semibold' : ''
                    }`}
                  >
                    <td className="py-2 px-4 text-center border border-slate-200 whitespace-nowrap">
                      <span className="text-xs font-bold font-mono text-slate-600">{getDomainCode(cfgObj.field, cfgObj.drawPrefix) || '領域名稱'}</span>
                    </td>
                    <td className="py-2 px-4 text-slate-800 border border-slate-200">
                      <span className="font-semibold text-slate-900">{stat.field}</span>
                    </td>
                    <td className="py-2 px-4 text-center font-mono font-bold text-slate-900 border border-slate-200">
                      {stat.count}
                    </td>
                    <td className="py-2 px-4 text-center border border-slate-200">
                      <span className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-50 px-3 py-1 font-bold text-slate-800" aria-label={`${stat.field}分組組數 ${stat.groupCount} 組`}>
                        {stat.groupCount} 組
                      </span>
                    </td>
                    <td className="py-2 px-4 border border-slate-200 max-w-xs">
                      <div className="space-y-1 text-[11px]">
                        {Array.from({ length: stat.groupCount }, (_, i) => i + 1).map((g) => {
                          const evs = stat.evaluatorsPerGroup?.[g] || [];
                          return (
                            <div key={g} className="flex items-center gap-1.5 truncate">
                              <span className="font-bold text-slate-700 font-mono shrink-0">
                                第{g}組:
                              </span>
                              {stat.groupCapacities && <span className="shrink-0 font-semibold text-blue-700">{stat.groupCapacities[g]} 件</span>}
                              <span className="text-slate-600 truncate">
                                {evs.length > 0 ? evs.join('、') : <span className="text-slate-400 italic">尚未設定（點右側設定）</span>}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </td>
                    <td className="py-2 px-4 text-center border border-slate-200">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-mono font-medium ${
                        drawnCount === stat.count && stat.count > 0
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : drawnCount > 0
                          ? 'bg-amber-50 text-amber-700 border border-amber-200'
                          : 'text-slate-400'
                      }`}>
                        {drawnCount} / {stat.count}
                      </span>
                    </td>
                    <td className="py-2 px-4 text-right border border-slate-200 whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5 justify-end">
                        <button
                          onClick={() => handleOpenEvaluatorModal(cfgObj)}
                          className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-medium flex items-center gap-1 border border-slate-200 cursor-pointer transition-colors"
                          title="設定各組之評審委員名單"
                        >
                          <Users className="w-3.5 h-3.5 text-slate-600" />
                          <span>設定評審</span>
                        </button>

                        <button
                          onClick={() => handleOpenEditDomain(cfgObj)}
                          className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium flex items-center gap-1 cursor-pointer transition-colors"
                          title="編輯領域、顯示代碼與分組組數"
                        >
                          <Edit className="w-3 h-3 text-slate-500" />
                          <span>編輯</span>
                        </button>

                        <button
                          onClick={() => { beginDraft(); setDomainToDelete(cfgObj); }}
                          className="p-1 rounded-lg hover:bg-rose-50 text-slate-400 hover:text-rose-600 cursor-pointer transition-colors"
                          title="刪除此領域"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {/* Grand Total */}
              <tr className="bg-slate-100/90 font-bold text-slate-900 border-t-2 border-slate-300">
                <td className="py-2.5 px-4 border border-slate-200" />
                <td className="py-2.5 px-4 border border-slate-200">總計</td>
                <td className="py-2.5 px-4 text-center font-mono text-rose-700 text-sm border border-slate-200">
                  {totalProjectsCount}
                </td>
                <td className="py-2.5 px-4 text-center font-mono text-slate-900 text-sm border border-slate-200">
                  {totalGroupCount} 組
                </td>
                <td className="py-2.5 px-4 text-xs text-slate-500 border border-slate-200">
                  全校共 {totalGroupCount} 個分組場次
                </td>
                <td className="py-2.5 px-4 text-center font-mono text-emerald-700 text-xs border border-slate-200">
                  {projects.filter((p) => p.draw_order).length} / {totalProjectsCount}
                </td>
                <td className="py-2.5 px-4 text-right text-xs text-slate-500 border border-slate-200">
                  {selectedFieldFilter !== 'ALL' && (
                    <button
                      onClick={() => setSelectedFieldFilter('ALL')}
                      className="text-blue-600 hover:underline cursor-pointer"
                    >
                      顯示全部領域
                    </button>
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        )}
      </div>

      {/* Projects Table / Card View Card */}
      <div className="bg-white rounded-3xl border border-slate-200 p-4 sm:p-6 shadow-sm">
        {/* Section Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 mb-4 border-b border-slate-100">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2">
              <FolderPlus className="w-5 h-5 text-blue-600 shrink-0" />
              <span>專題名冊管理</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              名冊總計 {projects.length} 件專題 · 支援個別增修、抽籤序號查驗與評審指派
            </p>
          </div>

        </div>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
            <div className="relative">
              <input
                type="text"
                aria-label="搜尋專題名稱、學號或老師"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜尋專題名稱、學號、老師..."
                className="w-full sm:w-72 bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-4 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
            </div>

            <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-600">
              <Filter className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <select
                aria-label="依領域篩選專題"
                value={selectedFieldFilter}
                onChange={(e) => setSelectedFieldFilter(e.target.value)}
                className="bg-transparent text-slate-800 focus:outline-none cursor-pointer text-xs w-full sm:w-auto"
              >
                <option value="ALL">全部領域 ({projects.length})</option>
                {domainList.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center justify-between md:justify-end gap-3">
            <div className="text-xs text-slate-500">
              顯示 {filteredProjects.length} 筆專題 (總計 {projects.length} 筆)
            </div>

            <div className="inline-flex items-center p-0.5 rounded-lg bg-slate-100 border border-slate-200 text-xs">
              <button
                onClick={() => setAdminProjectDisplayMode('table')}
                aria-pressed={adminProjectDisplayMode === 'table'}
                className={`px-2.5 py-1 rounded-md transition-all cursor-pointer font-medium ${
                  adminProjectDisplayMode === 'table'
                    ? 'bg-white text-emerald-800 shadow-xs font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                表格檢視
              </button>
              <button
                onClick={() => setAdminProjectDisplayMode('cards')}
                aria-pressed={adminProjectDisplayMode === 'cards'}
                className={`px-2.5 py-1 rounded-md transition-all cursor-pointer font-medium ${
                  adminProjectDisplayMode === 'cards'
                    ? 'bg-white text-emerald-800 shadow-xs font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                卡片檢視
              </button>
            </div>
          </div>
        </div>

        {adminProjectDisplayMode === 'cards' ? (
          /* Cards Grid View (Responsive on mobile & tablet) */
          <div>
            {filteredProjects.length === 0 ? (
              <div className="py-16 text-center text-slate-400 text-xs sm:text-sm space-y-2">
                <FileSpreadsheet className="w-10 h-10 mx-auto text-slate-300 stroke-1" />
                <p className="font-medium text-slate-600">
                  {projects.length === 0
                    ? '目前尚無專題資料'
                    : '查無符合條件的專題資料'}
                </p>
                <p className="text-xs text-slate-400">
                  {projects.length === 0
                    ? '請點擊上方「匯入 Excel 名冊」或「手動新增專題」開始匯入或建立名冊！'
                    : '請嘗試更換篩選領域或清除搜尋關鍵字'}
                </p>
                {projects.length === 0 && (
                  <div className="pt-3 flex flex-wrap items-center justify-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-xs flex items-center gap-1.5 cursor-pointer"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>匯入 Excel 名冊</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleOpenAddProject}
                      className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold shadow-xs flex items-center gap-1.5 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5 text-emerald-400" />
                      <span>手動新增專題</span>
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {displayedProjects.map(p => (
                  <ProjectRosterCard
                    key={p.id}
                    project={p}
                    sharedPasswordEnabled={sharedPasswordEnabled}
                    onEdit={() => handleStartEdit(p)}
                    onDelete={() => { beginDraft(); setProjectToDelete({ id: p.id, title: p.project_title }); }}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          /* Table View */
          <div>
            <div className="sm:hidden text-[10px] text-slate-400 flex items-center gap-1 mb-2">
              <Info className="w-3 h-3 text-slate-400" />
              <span>可橫向滑動查看完整名冊欄位與操作</span>
            </div>
            <div className="overflow-x-auto max-h-[550px] overflow-y-auto -mx-4 px-4 sm:mx-0 sm:px-0">
              <table className="w-full text-left text-xs sm:text-sm min-w-[820px]">
                <thead className="sticky top-0 bg-slate-100/90 text-slate-700 z-10 border-b border-slate-200">
                  <tr className="text-xs font-semibold">
                    {sortableHeader('seq_no', '序號')}
                    {sortableHeader('draw_code', '+編號(抽籤後)')}
                    {sortableHeader('assigned_group', '分組場次')}
                    {sortableHeader('draw_order', '組內順序')}
                    {sortableHeader('evaluators', '評審委員')}
                    {sortableHeader('field', '領域')}
                    {sortableHeader('original_code', '編號')}
                    {sortableHeader('project_title', '專題名稱')}
                    {sortableHeader('leader_id', '組長學號')}
                    {sortableHeader('password_set', '登入密碼')}
                    {sortableHeader('advisor', '指導老師')}
                    <th scope="col" className="py-2.5 px-3 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredProjects.length === 0 ? (
                    <tr>
                      <td colSpan={12} className="py-12 text-center text-slate-400">
                        <div className="space-y-1">
                          <p className="font-medium text-slate-600 text-sm">
                            {projects.length === 0
                              ? '目前尚無專題資料'
                              : '查無符合條件的專題資料'}
                          </p>
                          <p className="text-xs text-slate-400">
                            {projects.length === 0
                              ? '請點擊上方「匯入 Excel 名冊」或「手動新增專題」開始匯入或建立名冊！'
                              : '請嘗試更換篩選領域或清除搜尋關鍵字'}
                          </p>
                          {projects.length === 0 && (
                            <div className="pt-3 flex flex-wrap items-center justify-center gap-2.5">
                              <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-xs flex items-center gap-1.5 cursor-pointer"
                              >
                                <Upload className="w-3.5 h-3.5" />
                                <span>匯入 Excel 名冊</span>
                              </button>
                              <button
                                type="button"
                                onClick={handleOpenAddProject}
                                className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold shadow-xs flex items-center gap-1.5 cursor-pointer"
                              >
                                <Plus className="w-3.5 h-3.5 text-emerald-400" />
                                <span>手動新增專題</span>
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  ) : (
                    displayedProjects.map((p) => {
                      const hasConflict = p.assigned_group && isAdvisorConflict(p.advisor, p.evaluators || []);
                      return (
                        <tr key={p.id} className="hover:bg-slate-50 text-slate-700 transition-colors">
                          <td className="py-2.5 px-3 font-mono text-slate-400">{p.seq_no}</td>
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            {p.draw_code ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 font-bold border border-emerald-200 text-xs font-mono">
                                {p.draw_code}
                              </span>
                            ) : (
                              <span className="text-slate-400 italic text-xs">未抽籤</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 whitespace-nowrap font-medium text-slate-800">
                            {p.assigned_group ? (
                              <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 font-mono text-xs border border-blue-200">
                                第 {p.assigned_group} 組
                              </span>
                            ) : (
                              <span className="text-slate-400 italic text-xs">待分配</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 whitespace-nowrap font-mono text-xs tabular-nums">
                            {p.assigned_group && p.draw_order ? (
                              <span className="font-semibold text-slate-800">第 {p.draw_order} 位</span>
                            ) : (
                              <span className="text-slate-400">-</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 whitespace-nowrap text-xs">
                            {p.evaluators && p.evaluators.length > 0 ? (
                              <span className="text-slate-700 truncate max-w-[140px] block" title={p.evaluators.join('、')}>
                                {p.evaluators.join('、')}
                              </span>
                            ) : (
                              <span className="text-slate-400 italic">-</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-xs border border-slate-200">
                              {p.field}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 font-mono text-xs text-slate-500">{p.original_code}</td>
                          <td className="py-2.5 px-3 font-medium text-slate-900 max-w-xs truncate" title={p.project_title}>
                            {p.project_title}
                          </td>
                          <td className="py-2.5 px-3 font-mono whitespace-nowrap">
                            <span className="font-semibold text-blue-600">{p.leader_id}</span>
                          </td>
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            <span className={`inline-flex items-center rounded-full border px-2 py-1 text-[11px] font-bold ${p.password_set ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
                              {p.password_set ? '密碼已設定' : '需設定登入密碼'}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 whitespace-nowrap text-slate-700">
                            <span>{p.advisor}</span>
                            {hasConflict && (
                              <span className="ml-1 text-[10px] text-rose-600 font-bold bg-rose-50 px-1 rounded">
                                衝突!
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-right whitespace-nowrap">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => handleStartEdit(p)}
                                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
                                title="編輯資料"
                              >
                                <Edit className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => { beginDraft(); setProjectToDelete({ id: p.id, title: p.project_title }); }}
                                className="p-1.5 rounded-lg hover:bg-rose-50 text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
                                title="刪除"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Modal for Setting Evaluators / Reviewers with Conflict Avoidance */}
      {isEvaluatorModalOpen && domainForEvaluators && (
        <div role="dialog" aria-modal="true" aria-label="設定各組評審委員名單" className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-3xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 sm:p-7 shadow-xl space-y-5">
            <div className="space-y-4 border-b border-slate-100 pb-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#f2f7f1] text-[#356a32]">
                    <Users className="h-5 w-5" />
                  </div>
                  <h3 className="min-w-0 text-base font-bold leading-snug text-slate-900 sm:text-xl">設定各組評審委員名單</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setIsEvaluatorModalOpen(false)}
                  aria-label="關閉評審委員設定"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-2 focus-visible:outline-blue-600 cursor-pointer"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-slate-500">專題領域</p>
                  <p className="mt-1 break-words text-lg font-bold leading-snug text-[#28518a] sm:text-xl">{domainForEvaluators.field}</p>
                </div>
                <span className="inline-flex shrink-0 items-center rounded-full border border-[#ead5df] bg-[#fbf4f8] px-3 py-1.5 text-xs font-semibold text-[#93466e]">共 {domainForEvaluators.groupCount} 個分組場次</span>
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-200 p-3 rounded-2xl text-xs text-slate-600">
              各組評審委員名單由主辦單位自行設定與維護（匯入名冊時不會自動預設或覆寫）。請直接在下方各組填入評審委員姓名（以頓號、逗號或空白分隔），未指派時亦可留空。
            </div>

            <form onSubmit={handleSaveEvaluators} className="space-y-4">
              <div className="space-y-3.5">
                {Array.from({ length: domainForEvaluators.groupCount }, (_, i) => i + 1).map((g) => {
                  const currentValue = evaluatorDrafts[g] || '';
                  const currentProfs = currentValue
                    .split(/[、,，\s]+/)
                    .map((s) => s.trim())
                    .filter(Boolean);

                  return (
                    <div
                      key={g}
                      className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <label htmlFor={`evaluator-group-${g}`} className="text-xs font-bold text-slate-900 flex items-center gap-2">
                          <span className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center font-mono text-[10px]">
                            {g}
                          </span>
                          <span>第 {g} 組 評審委員名冊</span>
                        </label>
                        <span className="text-[11px] text-slate-500 font-mono">
                          目前 {currentProfs.length} 位委員
                        </span>
                      </div>

                      <input
                        id={`evaluator-group-${g}`}
                        type="text"
                        value={currentValue}
                        onChange={(e) =>
                          setEvaluatorDrafts({
                            ...evaluatorDrafts,
                            [g]: e.target.value,
                          })
                        }
                        placeholder="請輸入教授姓名，以頓號或逗號分隔，例如：陳志成副教授、張麗華副教授"
                        className="w-full bg-white border border-slate-200 rounded-xl px-3.5 py-2 text-xs sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                      />

                      {currentProfs.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {currentProfs.map((prof, idx) => (
                            <span
                              key={idx}
                              className="text-[11px] bg-white text-slate-800 px-2 py-0.5 rounded-md border border-slate-200 font-medium"
                            >
                              {prof}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="pt-2 border-t border-slate-100 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsEvaluatorModalOpen(false)}
                  disabled={pendingAction === 'evaluators'}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={pendingAction === 'evaluators'}
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-sm cursor-pointer flex items-center gap-1.5"
                >
                  {pendingAction === 'evaluators' ? <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                  <span>{pendingAction === 'evaluators' ? '儲存中…' : '儲存評審名單'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal for Adding or Editing a Domain and its Group Count */}
      {isDomainModalOpen && (
        <div role="dialog" aria-modal="true" aria-label={editingDomain ? '編輯領域設定' : '新增專題展覽領域'} className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-3xl max-w-md w-full max-h-[90vh] overflow-y-auto p-6 sm:p-7 shadow-xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center border border-amber-200">
                  <Settings2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    {editingDomain ? '編輯領域設定' : '新增專題展覽領域'}
                  </h3>
                  <p className="text-[11px] text-slate-500">自訂展覽領域與評審分組設定</p>
                </div>
              </div>
              <button
                onClick={() => setIsDomainModalOpen(false)}
                aria-label="關閉領域設定"
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {domainFormError && (
              <div role="alert" className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{domainFormError}</span>
              </div>
            )}

            <form onSubmit={handleSaveDomain} className="space-y-4 text-xs sm:text-sm">
              <div>
                <label htmlFor="domain-name" className="block text-slate-700 mb-1 font-semibold">
                  領域名稱 (Field Name) *
                </label>
                <input
                  id="domain-name"
                  type="text"
                  required
                  value={domainFormName}
                  onChange={(e) => {
                    setDomainFormName(e.target.value);
                    setDomainFormError(null);
                  }}
                  placeholder="例如：智慧車聯網與AIoT"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>

              <div>
                <label htmlFor="domain-draw-prefix" className="block text-slate-700 mb-1 font-semibold">
                  顯示代碼
                </label>
                <select
                  id="domain-draw-prefix"
                  value={domainFormPrefix}
                  onChange={e => { setDomainFormPrefix(e.target.value); setDomainFormError(null); }}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                >
                  <option value="">沿用預設{getDomainCode(domainFormName) ? `（${getDomainCode(domainFormName)}）` : '（領域名稱）'}</option>
                  {Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i)).map(letter => {
                    const used = domainConfigs.some(c => c.id !== editingDomain?.id && getDomainCode(c.field, c.drawPrefix) === letter);
                    return <option key={letter} value={letter} disabled={used}>{letter}{used ? '（已使用）' : ''}</option>;
                  })}
                </select>
                <p className="mt-1 text-xs text-slate-500">編號預覽：{getDomainCode(domainFormName, domainFormPrefix) || domainFormName.slice(0, 4) || '領域'}{getDomainCode(domainFormName, domainFormPrefix) ? '01' : '-第1組-序號01'}</p>
              </div>

              <div>
                <label htmlFor="domain-group-count" className="block text-slate-700 mb-1 font-semibold">
                  組數 (評審分組數量) *
                </label>
                <div className="relative">
                  <input
                    id="domain-group-count"
                    type="number"
                    min={1}
                    max={50}
                    required
                    value={domainFormGroupCount}
                    onChange={(e) => {
                      setDomainFormGroupCount(Number(e.target.value));
                      setDomainFormError(null);
                    }}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-slate-900 font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  />
                  <span className="absolute right-3.5 top-2.5 text-xs text-slate-400">組</span>
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  用於該領域的分組場次或評審組數。已有抽籤結果時，若要移除有專題的組別，請先重設該領域。
                </p>
              </div>

              <fieldset className="space-y-3 rounded-xl border border-slate-200 p-3">
                <legend className="px-1 font-semibold text-slate-700">各組專題件數</legend>
                <label className="flex items-center gap-2 text-slate-800">
                  <input type="checkbox" checked={domainManualCounts} onChange={e => { setDomainManualCounts(e.target.checked); setDomainFormError(null); }} />
                  直接指定每組件數
                </label>
                {domainManualCounts ? (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      {Array.from({ length: Math.min(50, Math.max(0, domainFormGroupCount)) }, (_, i) => i + 1).map(group => (
                        <div key={group}>
                          <label htmlFor={`domain-capacity-${group}`} className="mb-1 block text-xs font-medium text-slate-700">第 {group} 組專題件數</label>
                          <input id={`domain-capacity-${group}`} type="number" min={0} max={2000} step={1} required value={domainCapacityDrafts[group] ?? ''}
                            onChange={e => { setDomainCapacityDrafts(drafts => ({ ...drafts, [group]: e.target.value })); setDomainFormError(null); }}
                            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-slate-900" />
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-slate-700" aria-live="polite">設定合計 {Array.from({ length: Math.min(50, Math.max(0, domainFormGroupCount)) }, (_, i) => Number(domainCapacityDrafts[i + 1]) || 0).reduce((sum, count) => sum + count, 0)} 件 · 目前名冊 {editingDomain ? statsMap[editingDomain.field] || 0 : statsMap[domainFormName.trim()] || 0} 件</p>
                    <p className="text-[11px] leading-relaxed text-slate-500">可先儲存設定。抽籤時合計必須等於該領域專題數，並符合指導老師迴避；0 件表示該組不分配專題。已抽籤領域若要改變分配件數，請先重設。</p>
                  </>
                ) : <p className="text-[11px] text-slate-500">未指定時沿用自動分組。需要固定各組件數時，請勾選並逐組填寫。</p>}
              </fieldset>

              {editingDomain && statsMap[editingDomain.field] > 0 && (
                <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 text-blue-800 text-[11px] leading-relaxed">
                  💡 貼心提醒：目前名冊中共有 <strong>{statsMap[editingDomain.field]}</strong> 筆專題屬於「{editingDomain.field}」，若變更領域名稱，系統將自動同步更新所有相關專題的領域標籤！
                </div>
              )}

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsDomainModalOpen(false)}
                  disabled={pendingAction === 'domain'}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={pendingAction === 'domain'}
                  className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2 text-xs font-bold text-white shadow-sm hover:bg-blue-700 disabled:opacity-60 cursor-pointer"
                >
                  {pendingAction === 'domain' && <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                  {pendingAction === 'domain' ? '儲存中…' : editingDomain ? '儲存變更' : '確定新增領域'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal for Deleting Domain Confirmation */}
      {domainToDelete && (
        <div role="dialog" aria-modal="true" aria-label="確認刪除展覽領域" className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-3xl max-w-sm w-full p-6 shadow-xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0 border border-rose-100">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">確定刪除此展覽領域？</h3>
                <p className="text-xs text-slate-600 mt-1">
                  領域：「<strong className="text-slate-900">{domainToDelete.field}</strong>」
                </p>
                {domainDeleteBlockedMessage ? (
                  <p role="alert" className="mt-2 rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs leading-relaxed text-rose-700">{domainDeleteBlockedMessage}</p>
                ) : statsMap[domainToDelete.field] > 0 && (
                  <p className="text-[11px] text-amber-700 bg-amber-50 p-2 rounded-lg border border-amber-200 mt-2 leading-relaxed">
                    ⚠️ 注意：名冊內尚有 {statsMap[domainToDelete.field]} 筆專題屬於此領域，刪除後將移至「{domainConfigs.find(config => config.id !== domainToDelete.id)?.field || '未分類領域'}」。
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setDomainToDelete(null)}
                disabled={pendingAction === 'delete-domain'}
                className="px-3.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs cursor-pointer"
              >
                取消
              </button>
              <button
                onClick={handleConfirmDeleteDomain}
                disabled={pendingAction === 'delete-domain' || !!domainDeleteBlockedMessage}
                className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-rose-700 disabled:opacity-60 cursor-pointer"
              >
                {pendingAction === 'delete-domain' && <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                {pendingAction === 'delete-domain' ? '刪除中…' : '確定刪除領域'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* In-App Modal for Excel Import Decision */}
      {pendingImportProjects && (
        <div role="dialog" aria-modal="true" aria-label="選擇名冊匯入模式" className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-3xl max-w-md w-full p-6 shadow-xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0 border border-blue-100">
                <Upload className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  成功解析 {pendingImportProjects.length} 筆專題名冊
                </h3>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  請選擇匯入模式：您可以選擇完全覆蓋現有名單，或是將新名單追加至現有名單之後。
                </p>
                {sharedPasswordEnabled && <p className="text-xs text-indigo-700 mt-2">共用密碼啟用中，匯入檔案內的個別密碼欄位會略過；新專題沿用目前共用密碼。</p>}
                {projects.some(p => p.draw_order) && <label className="mt-3 flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                  <input type="checkbox" checked={overwriteAcknowledged} onChange={e => setOverwriteAcknowledged(e.target.checked)} className="mt-0.5 shrink-0" />
                  <span>我了解「完全覆蓋」會以 Excel 內容取代現有名冊，可能清除或改變已完成的抽籤結果。需要保留現有結果時，請使用「追加」。</span>
                </label>}
              </div>
            </div>

            <div className="pt-2 flex flex-col gap-2">
              <button
                onClick={() => handleApplyImport('overwrite')}
                disabled={pendingAction?.startsWith('import-') || (projects.some(p => p.draw_order) && !overwriteAcknowledged)}
                className="w-full py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-sm transition-all cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {pendingAction === 'import-overwrite' && <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                <span>{pendingAction === 'import-overwrite' ? '匯入中…' : '完全覆蓋並替換現有名單'}</span>
              </button>

              <button
                onClick={() => handleApplyImport('append')}
                disabled={pendingAction?.startsWith('import-')}
                className="w-full py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold text-xs border border-slate-200 transition-all cursor-pointer flex items-center justify-center gap-1.5"
              >
                {pendingAction === 'import-append' && <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                <span>{pendingAction === 'import-append' ? '匯入中…' : '追加至現有名冊 (保留現有資料)'}</span>
              </button>

              <button
                onClick={() => setPendingImportProjects(null)}
                disabled={pendingAction?.startsWith('import-')}
                className="w-full py-2 text-slate-400 hover:text-slate-600 text-xs transition-colors cursor-pointer"
              >
                取消匯入
              </button>
            </div>
          </div>
        </div>
      )}

      {/* In-App Modal for Delete Project Confirmation */}
      {projectToDelete && (
        <div role="dialog" aria-modal="true" aria-label="確認刪除專題" className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-3xl max-w-sm w-full p-6 shadow-xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0 border border-rose-100">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">確定刪除此專題？</h3>
                <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                  「{projectToDelete.title}」
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setProjectToDelete(null)}
                disabled={pendingAction === 'delete-project'}
                className="px-3.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs cursor-pointer"
              >
                取消
              </button>
              <button
                onClick={handleConfirmDelete}
                disabled={pendingAction === 'delete-project'}
                className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-rose-700 disabled:opacity-60 cursor-pointer"
              >
                {pendingAction === 'delete-project' && <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                {pendingAction === 'delete-project' ? '刪除中…' : '確認刪除'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add or Edit Project Modal */}
      {(isAddModalOpen || editingProject) && (
        <div role="dialog" aria-modal="true" aria-labelledby="project-modal-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 backdrop-blur-xs sm:p-6">
          <div className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl sm:max-h-[calc(100dvh-3rem)] sm:rounded-3xl">
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4 sm:px-7 sm:py-5">
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700" aria-hidden="true">
                  {editingProject ? <Edit className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
                </span>
                <div className="min-w-0">
                  <h3 id="project-modal-title" className="text-lg font-black text-slate-900 sm:text-xl">
                    {editingProject ? '編輯專題組別資料' : '手動新增專題組別'}
                  </h3>
                  <p className="mt-1 break-words text-xs leading-relaxed text-slate-500 sm:text-sm">
                    {editingProject ? `序號 ${editingProject.seq_no} · ${editingProject.project_title}` : '填寫專題與組長資料，儲存後會加入名冊。'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeProjectModal}
                disabled={projectSaving}
                aria-label="關閉專題編輯"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {formValidationNotice && (
              <div role="alert" className="mx-5 mt-4 flex shrink-0 items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 sm:mx-7">
                <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{formValidationNotice}</span>
              </div>
            )}

            <form onSubmit={handleSaveModal} onChange={() => { if (formValidationNotice) setFormValidationNotice(null); }} className="flex min-h-0 flex-1 flex-col text-sm">
              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:space-y-6 sm:px-7 sm:py-6">
              <section aria-labelledby="project-main-fields" className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h4 id="project-main-fields" className="text-sm font-black text-slate-900 sm:text-base">專題與組長</h4>
                  {editingProject && (
                    <span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${editingProject.password_set ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
                      {sharedPasswordEnabled ? '使用共用密碼' : editingProject.password_set ? '登入密碼已設定' : '尚未設定登入密碼'}
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500">先確認專題名稱與組長登入資訊。</p>
              <div>
                <label htmlFor="project-title" className="block text-slate-700 mb-1 font-semibold">專題名稱 *</label>
                <input
                  id="project-title"
                  type="text"
                  required
                  value={formData.project_title || ''}
                  onChange={(e) => setFormData({ ...formData, project_title: e.target.value })}
                  placeholder="例如：基於生成式AI之智慧排程平台"
                  className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="project-leader-id" className="block text-slate-700 mb-1 font-semibold">組長學號 *</label>
                  <input
                    id="project-leader-id"
                    type="text"
                    required
                    value={formData.leader_id || ''}
                    onChange={(e) => setFormData({ ...formData, leader_id: e.target.value })}
                    placeholder="例如：110214101"
                    className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 font-mono text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
                <div>
                  <label htmlFor="project-password" className="mb-1 block font-semibold text-slate-700">設定／重設組長密碼</label>
                  <input
                    id="project-password"
                    type="password"
                    disabled={sharedPasswordEnabled}
                    aria-describedby="project-password-help"
                    value={formData.password || ''}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    placeholder="輸入至少 8 字元的新密碼"
                    autoComplete="new-password"
                    minLength={8}
                    maxLength={128}
                    className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 font-mono text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                  />
                  <p id="project-password-help" className="mt-1.5 text-xs leading-relaxed text-slate-500">
                    {sharedPasswordEnabled ? '目前使用全體共用密碼，無法單獨設定。' : editingProject ? '留空會保留目前密碼；輸入新密碼則會重設。' : '可先留空，之後再設定個別密碼。'}
                  </p>
                </div>
              </div>

              </section>
              <section aria-labelledby="project-roster-fields" className="space-y-4 border-t border-slate-200 pt-5">
                <div>
                  <h4 id="project-roster-fields" className="text-sm font-black text-slate-900 sm:text-base">領域與名冊資料</h4>
                  <p className="mt-1 text-xs text-slate-500">這些欄位會用於名冊管理與抽籤分組。</p>
                </div>

              <div>
                <label htmlFor="project-field" className="block text-slate-700 mb-1 font-semibold">領域 *</label>
                <select
                  id="project-field"
                  value={formData.field || domainList[0]}
                  onChange={(e) => setFormData({ ...formData, field: e.target.value })}
                  className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                >
                  {domainList.map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="project-original-code" className="block text-slate-700 mb-1 font-semibold">專題編號</label>
                  <input
                    id="project-original-code"
                    type="text"
                    value={automaticOriginalCode ?? formData.original_code ?? ''}
                    readOnly={automaticOriginalCode !== undefined}
                    onChange={(e) => setFormData({ ...formData, original_code: e.target.value })}
                    placeholder="例如：A01"
                    className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 font-mono text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                  {automaticOriginalCode !== undefined && <p className="mt-1 text-xs text-slate-500">依領域自動編號，儲存時套用。</p>}
                </div>
                <div>
                  <label htmlFor="project-advisor" className="block text-slate-700 mb-1 font-semibold">指導老師</label>
                  <input
                    id="project-advisor"
                    type="text"
                    value={formData.advisor || ''}
                    onChange={(e) => setFormData({ ...formData, advisor: e.target.value })}
                    placeholder="例如：王教授"
                    className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label htmlFor="project-education-system" className="block text-slate-700 mb-1 font-semibold">學制</label>
                  <input
                    id="project-education-system"
                    type="text"
                    value={formData.education_system || ''}
                    onChange={(e) => setFormData({ ...formData, education_system: e.target.value })}
                    className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
                <div>
                  <label htmlFor="project-department" className="block text-slate-700 mb-1 font-semibold">系所</label>
                  <input
                    id="project-department"
                    type="text"
                    value={formData.department || ''}
                    onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                    className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
                <div>
                  <label htmlFor="project-class-name" className="block text-slate-700 mb-1 font-semibold">班級</label>
                  <input
                    id="project-class-name"
                    type="text"
                    value={formData.class_name || ''}
                    onChange={(e) => setFormData({ ...formData, class_name: e.target.value })}
                    className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
              </div>

              </section>
              <section aria-labelledby="project-draw-fields" className="space-y-3 border-t border-slate-200 pt-5">
                <div>
                  <h4 id="project-draw-fields" className="text-sm font-black text-slate-900 sm:text-base">抽籤資料</h4>
                  <p className="mt-1 text-xs text-slate-500">尚未抽籤的專題可保持空白。</p>
                </div>

              <div>
                <label htmlFor="project-draw-code" className="block text-slate-700 mb-1 font-semibold">+編號(抽籤後)</label>
                <input
                  id="project-draw-code"
                  type="text"
                  value={formData.draw_code || ''}
                  onChange={(e) => setFormData({ ...formData, draw_code: e.target.value })}
                  placeholder="留空代表未抽籤，或填寫例如：A01"
                  className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 font-mono text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
              </section>
              </div>

              <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-slate-200 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
                <span className="hidden text-xs text-slate-500 sm:block">儲存後立即更新專題名冊</span>
                <div className="flex gap-2 sm:justify-end">
                <button
                  type="button"
                  onClick={closeProjectModal}
                  disabled={projectSaving}
                  className="min-h-11 flex-1 rounded-xl bg-slate-100 px-5 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-200 disabled:opacity-50 sm:flex-none cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={projectSaving}
                  className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none cursor-pointer"
                >
                  {projectSaving && <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                  {projectSaving ? '儲存中…' : editingProject ? '儲存變更' : '新增專題'}
                </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
