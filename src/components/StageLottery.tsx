import { formatSessionLabel } from '../lib/sessionLabel';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ProjectItem, DomainConfig } from '../types';
import { isRequestCancelled, StoreState } from '../lib/api';
import { useApiRequest } from '../lib/useApiRequest';
import { useModalFocus } from '../lib/useModalFocus';
import { DomainScopePicker } from './DomainScopePicker';
import { ResultCarousel } from './ResultCarousel';
import { FloatingNotice } from './FloatingNotice';
import confetti from 'canvas-confetti';
import './StageLottery.css';
import { PupLotteryAnimation, pupLotteryDuration } from './PupLotteryAnimation';
import { getDrawableFields } from '../lib/lotterySelection';
import {
  RotateCcw,
  Maximize2,
  Minimize2,
  Zap,
  CheckCircle2,
  AlertTriangle,
  X,
  Users,
  ShieldCheck,
  ArrowRight,
  Search,
  Table,
  LayoutGrid,
  Play
} from 'lucide-react';

interface StageLotteryProps {
  projects: ProjectItem[];
  dataVersion: number | null;
  onApplyState: (state: StoreState) => void;
  domainList: string[];
  domainConfigs: DomainConfig[];
}

export const StageLottery: React.FC<StageLotteryProps> = ({
  projects,
  dataVersion,
  onApplyState,
  domainList,
  domainConfigs,
}) => {
  const request = useApiRequest();
  const mounted = useRef(false);
  const animationReveal = useRef<(() => void) | null>(null);
  const handleAnimationReveal = useCallback(() => {
    animationReveal.current?.();
    animationReveal.current = null;
  }, []);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; handleAnimationReveal(); }; }, [handleAnimationReveal]);
  const [selectedFields, setSelectedFields] = useState<string[] | null>(null);
  const selectedField = selectedFields === null ? 'ALL' : selectedFields.join('、');
  const includesField = (field: string) => selectedFields === null || selectedFields.includes(field);
  const changeFields = (fields: string[] | null) => { setSelectedFields(fields); setBatchDrawSummary(null); setBoardDomainFilter('ALL'); };
  const [showDrawAnimation, setShowDrawAnimation] = useState(false);
  const [animationDuration, setAnimationDuration] = useState(9000);
  const [isAnimating, setIsAnimating] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [carouselScope, setCarouselScope] = useState<string | string[] | null>(null);
  const fullscreenRef = useRef(false);

  const [batchDrawSummary, setBatchDrawSummary] = useState<string | null>(null);

  // Redesigned board states
  const [boardSearchQuery, setBoardSearchQuery] = useState<string>('');
  const [boardDisplayMode, setBoardDisplayMode] = useState<'lanes' | 'table'>('lanes');
  const [boardDomainFilter, setBoardDomainFilter] = useState<string>('ALL');

  // In-app modal states
  const [isBatchModalOpen, setIsBatchModalOpen] = useState<boolean>(false);
  const [isResetModalOpen, setIsResetModalOpen] = useState<boolean>(false);
  const [resetFields, setResetFields] = useState<string[]>([]);
  const [isResetting, setIsResetting] = useState(false);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);

  const stageContainerRef = useRef<HTMLDivElement>(null);

  // Filter projects based on selected field
  const currentPool = projects.filter(p => includesField(p.field));
  const undrawnPool = currentPool.filter((p) => !p.draw_order);
  const drawFields = getDrawableFields(domainConfigs.filter(cfg => includesField(cfg.field)).map(cfg => cfg.field), projects);
  const drawablePool = undrawnPool.filter(project => drawFields.includes(project.field));
  const visibleDomainConfigs = domainConfigs.filter(cfg =>
    (drawablePool.length ? drawFields.includes(cfg.field) : includesField(cfg.field)) && currentPool.some(p => p.field === cfg.field)
  );
  const completedFields = domainConfigs.filter(cfg => projects.some(project => project.field === cfg.field && !!project.draw_order)).map(cfg => cfg.field);
  const resettableFields = completedFields;
  const selectedResetFields = resetFields.filter(field => completedFields.includes(field));
  const resetProjectCount = projects.filter(project => selectedResetFields.includes(project.field)).length;
  const drawnPool = currentPool
    .filter((p) => !!p.draw_order)
    .sort((a, b) => {
      // Sort by assigned_group then draw_order
      if (a.assigned_group && b.assigned_group && a.assigned_group !== b.assigned_group) {
        return a.assigned_group - b.assigned_group;
      }
      return (a.draw_order || 0) - (b.draw_order || 0);
    });

  const enterFullscreen = async () => {
    fullscreenRef.current = true;
    setIsFullscreen(true);
    try {
      if (stageContainerRef.current?.requestFullscreen) await stageContainerRef.current.requestFullscreen();
      else setNoticeMessage('此瀏覽器不支援全螢幕，已改為視窗展示。');
    } catch {
      setNoticeMessage('無法進入瀏覽器全螢幕，已改為視窗展示。');
    }
  };
  const toggleFullscreen = async () => {
    if (!fullscreenRef.current) { await enterFullscreen(); return; }
    fullscreenRef.current = false;
    setIsFullscreen(false);
    setCarouselScope(null);
    if (document.fullscreenElement === stageContainerRef.current) await document.exitFullscreen().catch(() => {});
  };
  const openCarousel = () => {
    setCarouselScope(selectedFields === null ? 'ALL' : [...selectedFields]);
    if (!fullscreenRef.current) void enterFullscreen();
  };
  useEffect(() => {
    const handleFsChange = () => {
      const active = document.fullscreenElement === stageContainerRef.current;
      fullscreenRef.current = active;
      setIsFullscreen(active);
      if (!active) setCarouselScope(null);
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  // Multi-cannon celebratory confetti
  const triggerCelebration = () => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    try {
      // Left cannon
      confetti({
        particleCount: 80,
        angle: 60,
        spread: 70,
        origin: { x: 0.1, y: 0.65 },
        colors: ['#e11d48', '#2563eb', '#f59e0b', '#10b981', '#8b5cf6'],
      });
      // Right cannon
      confetti({
        particleCount: 80,
        angle: 120,
        spread: 70,
        origin: { x: 0.9, y: 0.65 },
        colors: ['#e11d48', '#2563eb', '#f59e0b', '#10b981', '#8b5cf6'],
      });
      // Center burst
      setTimeout(() => {
        confetti({
          particleCount: 140,
          spread: 110,
          origin: { x: 0.5, y: 0.5 },
          colors: ['#e11d48', '#2563eb', '#f59e0b', '#10b981', '#8b5cf6', '#06b6d4'],
        });
      }, 250);
    } catch {
      // Fallback
    }
  };

  /**
   * Open Batch Confirmation Modal
   */
  const handleOpenBatchModal = () => {
    if (drawablePool.length === 0) {
      setNoticeMessage('目前範圍內無尚未抽籤的組別！如需重新抽籤請先點擊重設。');
      return;
    }
    setIsBatchModalOpen(true);
  };

  /**
   * Redesigned One-Click School-Wide Automatic Lottery Animation & Execution
   */
  const handleConfirmBatchDraw = async () => {
    setIsBatchModalOpen(false);
    if (drawablePool.length === 0 || isAnimating) return;
    if (dataVersion === null) { setNoticeMessage('資料尚未載入，請重新整理後再試。'); return; }

    const duration = pupLotteryDuration();
    const revealReady = showDrawAnimation
      ? new Promise<void>((resolve) => { animationReveal.current = resolve; })
      : Promise.resolve();
    setAnimationDuration(duration);
    setIsAnimating(true);
    setBatchDrawSummary(null);
    try {
      // Reveal the saved results exactly when 小布 presses the remote again.
      const [backendResult] = await Promise.all([
        request<StoreState & { summary: string }>('/api/lottery/draw', {
          fields: drawFields,
          version: dataVersion,
        }),
        revealReady,
      ]);
      if (!mounted.current) return;
      if (!Array.isArray(backendResult.projects)) throw new Error('抽籤回應格式不正確。');
      setBatchDrawSummary(
        backendResult.summary ||
          (selectedField === 'ALL'
            ? `全校共 ${domainConfigs.length} 個領域已完成獨立分組抽籤。`
            : `「${selectedField}」領域已完成獨立分組抽籤。`)
      );
      onApplyState(backendResult);
      triggerCelebration();
      if (fullscreenRef.current) {
        setCarouselScope([...drawFields]);
      }
    } catch (apiErr) {
      if (!isRequestCancelled(apiErr)) setNoticeMessage(apiErr instanceof Error ? apiErr.message : '抽籤失敗，請重新整理後再試。');
    } finally {
      handleAnimationReveal();
      setIsAnimating(false);
    }
  };

  /**
   * Reset draw
   */
  const handleOpenResetModal = () => {
    if (completedFields.length === 0) {
      setNoticeMessage('目前尚無任何已抽籤的領域。');
      return;
    }
    setResetFields([]);
    setIsResetModalOpen(true);
  };

  const handleConfirmReset = async () => {
    if (isResetting || resetFields.length === 0) return;
    if (dataVersion === null) { setNoticeMessage('資料尚未載入，請重新整理後再試。'); return; }
    setIsResetting(true);
    try {
      const data = await request('/api/lottery/reset', { fields: resetFields, version: dataVersion });
      onApplyState(data);
      changeFields(resetFields);
      setBatchDrawSummary(null);
      setIsResetModalOpen(false);
    } catch (error) {
      if (!isRequestCancelled(error)) setNoticeMessage(error instanceof Error ? error.message : '重設失敗，請稍後再試。');
    } finally {
      setIsResetting(false);
    }
  };

  useModalFocus(
    isBatchModalOpen ? 'draw' : isResetModalOpen ? 'reset' : null,
    () => { if (!isResetting) { setIsBatchModalOpen(false); setIsResetModalOpen(false); } }
  );

  return (
    <div
      ref={stageContainerRef}
      className={`min-h-[calc(100vh-4rem)] bg-gradient-to-b from-blue-50/70 via-white to-slate-50 text-slate-800 transition-all ${
        isFullscreen
          ? 'stage-fullscreen fixed inset-0 z-50 bg-white'
          : 'py-4 sm:py-7 px-3 sm:px-6 max-w-[1600px] mx-auto space-y-5 sm:space-y-7'
      }`}
    >
      <div hidden={carouselScope !== null} className={isFullscreen ? 'stage-fullscreen-layout' : 'space-y-5 sm:space-y-7'}>
      {isFullscreen && <header className="stage-presentation-header">
        <div className="stage-presentation-brand">
          <img className="stage-presentation-logo" src="/college-logo-64.webp" srcSet="/college-logo-64.webp 1x, /college-logo-128.webp 2x" alt="專題報告抽籤系統圖標" width={56} height={56} />
          <div><p>國立臺中科技大學 · 資訊與流通學院</p><h1>專題報告抽籤現場</h1></div>
        </div>
        <div className="stage-presentation-tools">
          <DomainScopePicker domains={domainConfigs} projects={projects} selected={selectedFields} disabled={isAnimating || isResetting} onChange={changeFields} />
          <button type="button" onClick={handleOpenResetModal} disabled={isAnimating || isResetting || resettableFields.length === 0} aria-label="選擇要重設的領域"><RotateCcw size={18} /></button>
          <button type="button" onClick={toggleFullscreen} aria-label="退出全螢幕"><Minimize2 size={18} /><span>退出全螢幕</span></button>
        </div>
      </header>}

      {/* Presentation control header */}
      <section hidden={isFullscreen} className="relative rounded-[1.75rem] border border-blue-100 bg-white text-slate-900 shadow-sm">
        <div className="absolute inset-0 overflow-hidden rounded-[1.75rem] pointer-events-none">
        <div className="absolute -right-20 -top-28 h-72 w-72 rounded-full bg-blue-100/80 blur-3xl pointer-events-none" />
        <div className="absolute -left-20 bottom-0 h-52 w-52 rounded-full bg-amber-100/70 blur-3xl pointer-events-none" />
        </div>
        <div className="relative p-5 sm:p-7 lg:p-9 space-y-6">
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-5">
            <div className="flex items-center gap-4 min-w-0">
              <div className="h-14 w-14 sm:h-16 sm:w-16 rounded-2xl border border-slate-100 bg-white flex items-center justify-center shrink-0 p-2 shadow-sm">
                <img width={64} height={64} src="/college-logo-64.webp" srcSet="/college-logo-64.webp 1x, /college-logo-128.webp 2x" alt="國立臺中科技大學 資訊與流通學院" className="max-h-full max-w-full object-contain" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] sm:text-xs font-semibold tracking-wide text-blue-700">國立臺中科技大學 · 資訊與流通學院</p>
                <h1 className="mt-1 text-2xl sm:text-3xl lg:text-4xl font-black tracking-tight">專題報告抽籤現場</h1>
                <p className="mt-1 text-xs sm:text-sm text-slate-600">各領域獨立分組，現場同步公布編號</p>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:items-end sm:justify-between">
            <div className="block min-w-0 sm:min-w-72">
              <span className="block text-[11px] font-semibold text-slate-600 mb-2">抽籤範圍（可複選）</span>
              <DomainScopePicker domains={domainConfigs} projects={projects} selected={selectedFields} disabled={isAnimating || isResetting} onChange={changeFields} />
            </div>
            <div className="flex items-center gap-2">
              <button onClick={toggleFullscreen} type="button" className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 hover:bg-blue-100 px-4 py-3 text-sm font-bold text-blue-800 transition-colors cursor-pointer" title={isFullscreen ? '退出全螢幕' : '全螢幕大螢幕投影'}>
                {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                {isFullscreen ? '退出全螢幕' : '全螢幕展示'}
              </button>
              <button onClick={handleOpenResetModal} disabled={isAnimating || isResetting || resettableFields.length === 0} type="button" className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white hover:bg-rose-50 px-4 py-3 text-sm font-bold text-slate-700 hover:text-rose-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer" title="選擇要重設的抽籤領域">
                <RotateCcw className="w-4 h-4" />
                <span className="hidden sm:inline">重設結果</span>
              </button>
            </div>
          </div>
        </div>
      </section>

      <div role="group" className={isFullscreen ? 'hidden' : 'grid grid-cols-3 gap-2 sm:gap-4'} aria-label="抽籤數量統計">
        <div className="rounded-2xl border border-slate-200 bg-white p-3 sm:p-5 shadow-sm"><div className="text-[11px] sm:text-sm font-semibold text-slate-500">專題總數</div><div className="mt-1 text-2xl sm:text-4xl font-black text-slate-900 tabular-nums">{currentPool.length}<span className="ml-1 text-xs sm:text-base font-semibold text-slate-500">件</span></div></div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 sm:p-5 shadow-sm"><div className="text-[11px] sm:text-sm font-semibold text-emerald-700">已完成</div><div className="mt-1 text-2xl sm:text-4xl font-black text-emerald-800 tabular-nums">{drawnPool.length}<span className="ml-1 text-xs sm:text-base font-semibold text-emerald-700">件</span></div></div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 sm:p-5 shadow-sm"><div className="text-[11px] sm:text-sm font-semibold text-amber-700">尚待抽籤</div><div className="mt-1 text-2xl sm:text-4xl font-black text-amber-900 tabular-nums">{undrawnPool.length}<span className="ml-1 text-xs sm:text-base font-semibold text-amber-700">件</span></div></div>
      </div>

      {/* Main Big Stage Presentation Card */}
      <section className={`${isFullscreen ? 'stage-presentation-main' : ''} relative overflow-hidden rounded-[1.75rem] bg-white border border-blue-100 shadow-lg shadow-blue-100/70 p-5 sm:p-8 lg:p-10 text-center`} aria-label="抽籤主舞台" aria-busy={isAnimating}>
        {isAnimating && <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(219,234,254,0.75),transparent_70%)] pointer-events-none" />}

        <div className={`${isFullscreen ? 'stage-presentation-content' : ''} relative z-10 max-w-7xl mx-auto min-h-[300px] sm:min-h-[350px] flex flex-col items-center justify-center`} aria-live="polite">
          {isAnimating ? (
            <div className={`${isFullscreen ? 'stage-presentation-animation' : ''} w-full py-3 sm:py-5`}>
              <p className="text-sm font-bold tracking-wide text-blue-700">{selectedField === 'ALL' ? '全校各領域' : selectedField} · 現場抽籤中</p>
              {showDrawAnimation
                ? <PupLotteryAnimation duration={animationDuration} onReveal={handleAnimationReveal} />
                : <div className="flex flex-col items-center gap-3 py-10" role="status">
                    <div className="h-10 w-10 rounded-full border-4 border-blue-100 border-t-blue-700 animate-spin" aria-hidden="true" />
                    <span className="text-base font-bold text-slate-600">正在產生抽籤結果…</span>
                  </div>}
            </div>
          ) : isFullscreen ? (
            <div className="stage-presentation-ready">
              <div className="stage-presentation-hero">
                <div className="stage-presentation-intro">
                  <div className="stage-presentation-title">
                    <p className="stage-presentation-scope">{selectedField === 'ALL' ? '全校各領域' : selectedFields?.length === 0 ? '尚未選擇領域' : selectedFields?.length === 1 ? selectedField : `本次已選 ${selectedFields?.length} 個領域`}</p>
                    <h2>{currentPool.length === 0 ? selectedFields?.length === 0 ? '請勾選抽籤領域' : '尚無專題資料' : undrawnPool.length ? '準備開始抽籤' : '報告場次與編號已排定'}</h2>
                  </div>
                </div>
                <div className="stage-presentation-counts" role="group" aria-label="本次抽籤數量">
                  <div className="stage-presentation-stat"><span>專題總數</span><p><strong>{currentPool.length}</strong><small>件</small></p></div>
                  <div className="stage-presentation-stat stage-presentation-stat--complete"><span>已完成</span><p><strong>{drawnPool.length}</strong><small>件</small></p></div>
                  <div className="stage-presentation-stat stage-presentation-stat--pending"><span>尚待抽籤</span><p><strong>{undrawnPool.length}</strong><small>件</small></p></div>
                </div>
                <p className="stage-presentation-description">{batchDrawSummary || (currentPool.length === 0 ? selectedFields?.length === 0 ? '請從抽籤範圍選擇至少一個領域。' : '請先在管理後台匯入專題資料。' : undrawnPool.length ? '確認本次領域後，點選下方按鈕開始抽籤。' : '點選「輪播結果」，開始展示各組報告順序。')}</p>
              </div>
              <div className="stage-presentation-domains">
                {visibleDomainConfigs.map((cfg) => <article key={cfg.id}><h3>{cfg.field}</h3><p>{cfg.groupCount} 組場次 · {currentPool.filter(p => p.field === cfg.field).length} 件專題</p></article>)}
              </div>
            </div>
          ) : batchDrawSummary ? (
            /* ========================================================
             * Completed Screen
             * ======================================================== */
            <div className="w-full animate-in fade-in zoom-in duration-300 text-left">
              <div className="flex flex-col gap-5 rounded-3xl border border-blue-100 bg-gradient-to-r from-blue-50 via-white to-emerald-50 p-5 sm:p-7 lg:flex-row lg:items-center lg:justify-between lg:p-8">
                <div className="flex items-start gap-4 sm:gap-5">
                  <div>
                    <p className="text-sm font-bold text-emerald-800 sm:text-base">
                      {selectedField === 'ALL' ? '全校各領域抽籤完成' : `「${selectedField}」領域抽籤完成`}
                    </p>
                    <h2 className="mt-1 text-2xl font-black leading-tight tracking-tight text-slate-950 sm:text-4xl lg:text-5xl">
                      報告場次與編號已排定
                    </h2>
                    <p className="mt-3 text-sm font-medium text-slate-600 sm:text-base">{batchDrawSummary}</p>
                  </div>
                </div>
                <div className="flex shrink-0 items-baseline gap-2 rounded-2xl border border-blue-200 bg-white/90 px-5 py-3 shadow-sm lg:flex-col lg:items-start lg:gap-0 lg:px-7 lg:py-4" aria-label={`已排定 ${drawnPool.length} 件專題`}>
                  <span className="text-xs font-bold text-blue-700 sm:text-sm">已排定專題</span>
                  <span className="text-3xl font-black tabular-nums text-slate-950 sm:text-4xl">{drawnPool.length}<span className="ml-1 text-base font-bold text-slate-600">件</span></span>
                </div>
              </div>

              <div className="mb-4 mt-7 flex flex-wrap items-end justify-between gap-2">
                <h3 className="text-lg font-black text-slate-900 sm:text-2xl">各領域排定結果</h3>
                <span className="text-xs font-semibold text-slate-500 sm:text-sm">分組場次與專題件數</span>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 sm:gap-4">
                {domainConfigs.filter(cfg => includesField(cfg.field)).filter((cfg) => projects.some((p) => p.field === cfg.field)).map((cfg) => {
                  const teams = projects.filter((p) => p.field === cfg.field);
                  return (
                    <article
                      key={cfg.id}
                      className="flex min-w-0 flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <h4 className="min-w-0 text-base font-black leading-snug break-words text-slate-900 sm:text-lg">{cfg.field}</h4>
                        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
                      </div>
                      <div className="mt-5 grid grid-cols-2 gap-3">
                        <div className="rounded-xl bg-blue-50 px-3 py-2.5">
                          <span className="block text-xs font-semibold text-blue-800">分組場次</span>
                          <span className="mt-1 block text-2xl font-black tabular-nums text-blue-950">{cfg.groupCount}<span className="ml-1 text-sm font-semibold">組</span></span>
                        </div>
                        <div className="rounded-xl bg-slate-50 px-3 py-2.5">
                          <span className="block text-xs font-semibold text-slate-600">專題件數</span>
                          <span className="mt-1 block text-2xl font-black tabular-nums text-slate-950">{teams.length}<span className="ml-1 text-sm font-semibold">件</span></span>
                        </div>
                      </div>
                      <div className="mt-4 border-t border-slate-100 pt-3 text-sm font-bold text-emerald-700">
                        已完成排定
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          ) : (
            /* ========================================================
             * Idle / Ready to Draw Screen
             * ======================================================== */
            <div className="w-full max-w-6xl mx-auto text-left">
              <div className="flex flex-col gap-5 rounded-3xl border border-blue-100 bg-gradient-to-r from-blue-50 via-white to-slate-50 p-5 sm:p-7 lg:flex-row lg:items-center lg:justify-between lg:p-8">
                <div className="flex items-start gap-4 sm:gap-5">
                  <div>
                    <p className="text-sm font-bold text-blue-800 sm:text-base">專題報告抽籤</p>
                    <h2 className="mt-1 text-2xl font-black leading-tight tracking-tight text-slate-950 sm:text-4xl lg:text-5xl">
                      {currentPool.length === 0 ? selectedFields?.length === 0 ? '請勾選抽籤領域' : '此範圍尚無專題' : undrawnPool.length === 0 ? '此範圍已完成抽籤' : '準備開始抽籤'}
                    </h2>
                    <p className="mt-3 max-w-2xl text-sm font-medium leading-relaxed text-slate-600 sm:text-base">
                      {currentPool.length === 0
                        ? selectedFields?.length === 0 ? '請從抽籤範圍選擇至少一個領域。' : '請先在管理後台匯入專題資料，完成後即可在此進行抽籤。'
                        : undrawnPool.length === 0
                        ? '場次與編號已排定，請查看下方結果看板。'
                        : '各領域依設定組數獨立分組，並排定各組的報告順序。'}
                    </p>
                  </div>
                </div>
                {currentPool.length > 0 && (
                  <div className="grid shrink-0 grid-cols-2 gap-4 rounded-2xl border border-blue-200 bg-white/90 px-5 py-3 shadow-sm lg:px-6 lg:py-4">
                    <div>
                      <span className="block text-xs font-bold text-blue-700 sm:text-sm">抽籤領域</span>
                      <span className="mt-1 block text-3xl font-black tabular-nums text-slate-950 sm:text-4xl">{visibleDomainConfigs.length}<span className="ml-1 text-base font-semibold text-slate-600">個</span></span>
                    </div>
                    <div>
                      <span className="block text-xs font-bold text-blue-700 sm:text-sm">專題總數</span>
                      <span className="mt-1 block text-3xl font-black tabular-nums text-slate-950 sm:text-4xl">{currentPool.length}<span className="ml-1 text-base font-semibold text-slate-600">件</span></span>
                    </div>
                  </div>
                )}
              </div>

              {currentPool.length > 0 && (
                <div className="mt-6">
                  <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
                    <h3 className="text-lg font-black text-slate-900 sm:text-2xl">{undrawnPool.length === 0 ? '各領域分組設定' : '本次抽籤領域'}</h3>
                    <span className="text-xs font-semibold text-slate-500 sm:text-sm">各領域獨立排定報告順序</span>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 sm:gap-4">
                    {visibleDomainConfigs.map((c) => (
                      <article key={c.id} className="flex min-w-0 flex-col justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                        <div>
                          <h4 className="text-base font-black leading-snug break-words text-slate-900 sm:text-lg">{c.field}</h4>
                        </div>
                        <div className="mt-5 flex items-end justify-between gap-3 border-t border-slate-100 pt-3">
                          <span className="text-sm font-semibold text-slate-600">{projects.filter((p) => p.field === c.field).length} 件專題</span>
                          <span className="whitespace-nowrap rounded-xl bg-blue-50 px-3 py-1.5 text-xl font-black tabular-nums text-blue-900">{c.groupCount}<span className="ml-1 text-sm font-semibold">組</span></span>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Action Button: One-Click School-Wide Automatic Draw */}
        <div className={`${isFullscreen ? 'stage-presentation-actions' : ''} relative z-10 mt-6 sm:mt-8 pt-5 sm:pt-6 border-t border-slate-100 flex flex-col items-center gap-3`}>
          <div className={isFullscreen ? 'stage-presentation-buttons' : 'flex w-full flex-col items-center gap-3'}>
          {(!isFullscreen || undrawnPool.length > 0 || isAnimating) && <button
            onClick={handleOpenBatchModal}
            disabled={isAnimating || drawablePool.length === 0}
            className="w-full sm:w-auto min-w-[260px] sm:min-w-[340px] px-8 py-4 rounded-2xl bg-blue-700 hover:bg-blue-800 text-white font-extrabold text-base sm:text-lg shadow-lg shadow-blue-500/20 transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-40 disabled:hover:scale-100 disabled:shadow-none flex items-center justify-center gap-2.5 cursor-pointer"
          >
            <Zap className="w-5 h-5 fill-current shrink-0 animate-pulse" />
            <span>
              {selectedField === 'ALL' && drawFields.length === domainConfigs.length
                ? '開始全校抽籤'
                : drawFields.length === 1 ? `開始「${drawFields[0]}」抽籤` : `開始抽籤（${drawFields.length} 個領域）`}
            </span>
          </button>}
          {isFullscreen && drawnPool.length > 0 && !isAnimating && <button type="button" onClick={openCarousel} className="stage-presentation-play"><Play size={22} />輪播結果</button>}
          </div>
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-600 cursor-pointer">
            <input type="checkbox" checked={showDrawAnimation} disabled={isAnimating} onChange={(event) => setShowDrawAnimation(event.target.checked)} className="h-4 w-4 accent-blue-700" />
            播放抽籤動畫
          </label>
        </div>
      </section>

      {/* ========================================================
       * Redesigned Order Board (清晰分組與順序時間軸看板)
       * ======================================================== */}
      <section
        hidden={isFullscreen}
        className="rounded-[1.75rem] p-4 sm:p-7 lg:p-8 bg-white border border-slate-200 shadow-sm space-y-6"
        aria-label="已抽出順序看板"
      >
        {/* Board title and tools */}
        <div className="space-y-5 border-b border-slate-200 pb-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h3 className="flex items-center gap-2.5 text-xl font-black text-slate-900 sm:text-3xl">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><CheckCircle2 className="h-5 w-5" /></span>
                <span>分組與報告順序</span>
              </h3>
              <p className="mt-1 text-sm text-slate-600 sm:text-base">
                依領域與場次排列；編號於各領域內跨組連續編號
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
            <button type="button" onClick={openCarousel} disabled={isAnimating || isResetting || drawnPool.length === 0}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-bold text-blue-800 hover:bg-blue-100 disabled:opacity-40 cursor-pointer">
              <Play className="h-4 w-4" />輪播結果
            </button>
            </div>
          </div>

          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div className="w-full min-w-0 md:max-w-2xl">
              <label htmlFor="board-project-search" className="mb-1.5 block text-sm font-bold text-slate-700">搜尋專題名稱或抽籤編號</label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-blue-700" />
                <input
                  id="board-project-search"
                  type="text"
                  value={boardSearchQuery}
                  onChange={(e) => setBoardSearchQuery(e.target.value)}
                  placeholder="輸入專題名稱或抽籤編號"
                  className="min-h-12 w-full rounded-xl border border-slate-300 bg-slate-50 py-3 pl-11 pr-11 text-sm font-medium text-slate-900 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 sm:text-base"
                />
                {boardSearchQuery && (
                  <button
                    type="button"
                    onClick={() => setBoardSearchQuery('')}
                    aria-label="清除搜尋"
                    className="absolute right-3 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-slate-500 hover:bg-slate-200 hover:text-slate-800 cursor-pointer"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
            {/* View Switcher: Lanes vs Table */}
            <div role="group" aria-label="看板檢視方式" className="inline-flex min-h-12 w-full items-center rounded-xl border border-slate-200 bg-slate-100 p-1 text-sm sm:w-auto md:shrink-0">
              <button
                type="button"
                onClick={() => setBoardDisplayMode('lanes')}
                aria-pressed={boardDisplayMode === 'lanes'}
                className={`flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 font-semibold transition-all cursor-pointer ${
                  boardDisplayMode === 'lanes'
                    ? 'bg-white text-rose-700 shadow-xs font-bold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <LayoutGrid className="h-4 w-4" />
                <span>分組看板</span>
              </button>
              <button
                type="button"
                onClick={() => setBoardDisplayMode('table')}
                aria-pressed={boardDisplayMode === 'table'}
                className={`flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 font-semibold transition-all cursor-pointer ${
                  boardDisplayMode === 'table'
                    ? 'bg-white text-rose-700 shadow-xs font-bold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Table className="h-4 w-4" />
                <span>名單表格</span>
              </button>
            </div>
          </div>
        </div>

        {/* Quick Domain Filter Tabs (when viewing ALL domains) */}
        {domainConfigs.filter(cfg => includesField(cfg.field)).length > 1 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 -mx-2 px-2">
            <button
              onClick={() => setBoardDomainFilter('ALL')}
              aria-pressed={boardDomainFilter === 'ALL'}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer border ${
                boardDomainFilter === 'ALL'
                  ? 'bg-blue-700 text-white border-blue-700 shadow-xs'
                  : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
              }`}
            >
              全部領域 ({drawnPool.length} 組已抽)
            </button>
            {domainConfigs.filter(cfg => includesField(cfg.field)).map((cfg) => {
              const count = drawnPool.filter((p) => p.field === cfg.field).length;
              const total = projects.filter((p) => p.field === cfg.field).length;
              return (
                <button
                  key={cfg.id}
                  onClick={() => setBoardDomainFilter(cfg.field)}
                  aria-pressed={boardDomainFilter === cfg.field}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer border flex items-center gap-1.5 ${
                    boardDomainFilter === cfg.field
                      ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                      : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
                  }`}
                >
                  <span>{cfg.field}</span>
                  <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                    boardDomainFilter === cfg.field ? 'bg-blue-700 text-white' : 'bg-slate-200 text-slate-600'
                  }`}>
                    {count}/{total}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Empty State */}
        {drawnPool.length === 0 ? (
          <div className="text-center py-12 text-slate-400 text-xs">
            尚無抽籤結果，請從上方主舞台開始抽籤。
          </div>
        ) : (
          /* Render Domains & Subgroups */
          <div className="space-y-8">
            {domainConfigs.filter(c => includesField(c.field) && (boardDomainFilter === 'ALL' || c.field === boardDomainFilter)).map((cfg) => {
              const domainDrawnProjects = drawnPool.filter((p) => p.field === cfg.field);
              if (domainDrawnProjects.length === 0) return null;

              const cleanQuery = boardSearchQuery.trim().toLowerCase();
              const isMatch = (item: ProjectItem) => {
                if (!cleanQuery) return false;
                return (
                  item.project_title.toLowerCase().includes(cleanQuery) ||
                  (item.draw_code && item.draw_code.toLowerCase().includes(cleanQuery))
                );
              };

              return (
                <div key={cfg.id} className="space-y-3.5">
                  {/* Domain Header Banner */}
                  <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                    <div className="h-1 bg-linear-to-r from-[#28518a] via-[#356a32] to-[#93466e]" aria-hidden="true" />
                    <div className="flex flex-col gap-4 p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0">
                        <p className="mb-1 text-xs font-semibold text-[#28518a]">專題領域</p>
                        <h4 className="break-words text-lg font-bold leading-snug text-slate-900 sm:text-2xl">
                          {cfg.field}
                        </h4>
                      </div>
                      <div className="grid shrink-0 grid-cols-2 divide-x divide-slate-200 rounded-xl border border-slate-200 bg-white lg:min-w-52">
                        <div className="px-4 py-3 text-center">
                          <p className="text-xs font-medium text-slate-500">分組場次</p>
                          <p className="mt-1 text-xs text-slate-600"><strong className="mr-1 text-2xl font-bold tabular-nums text-[#28518a]">{cfg.groupCount}</strong>組</p>
                        </div>
                        <div className="px-4 py-3 text-center">
                          <p className="text-xs font-medium text-slate-500">已抽專題</p>
                          <p className="mt-1 text-xs text-slate-600"><strong className="mr-1 text-2xl font-bold tabular-nums text-[#356a32]">{domainDrawnProjects.length}</strong>件</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Lanes View (Columns per Subgroup) */}
                  {boardDisplayMode === 'lanes' ? (
                    <div
                      className={`grid gap-5 ${
                        cfg.groupCount === 1
                          ? 'grid-cols-1'
                          : 'grid-cols-1 lg:grid-cols-2'
                      }`}
                    >
                      {Array.from({ length: cfg.groupCount }, (_, i) => i + 1).map((g) => {
                        const groupItems = domainDrawnProjects
                          .filter((p) => p.assigned_group === g)
                          .sort((a, b) => (a.draw_order || 0) - (b.draw_order || 0));

                        return (
                          <div
                            key={g}
                            className="bg-slate-50/80 rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-4 flex flex-col"
                          >
                            {/* Subgroup Lane Header */}
                            <div className="flex items-center justify-between pb-2.5 border-b border-slate-200">
                              <div className="flex items-center gap-2">
                                <span className="w-11 h-11 rounded-xl bg-blue-700 text-white font-black text-xl flex items-center justify-center font-mono shadow-xs">
                                  {g}
                                </span>
                                <div>
                                  <div className="text-lg sm:text-xl font-black text-slate-900">
                                    {formatSessionLabel(g)}
                                  </div>
                                  <div className="text-sm text-slate-600 font-mono">
                                    編號 {groupItems.length ? `${groupItems[0].draw_code || '編號未設定'} ~ ${groupItems[groupItems.length - 1].draw_code || '編號未設定'}` : '尚無資料'}
                                  </div>
                                </div>
                              </div>
                              <span className="text-sm font-bold text-blue-800 bg-blue-50 px-3 py-1 rounded-md border border-blue-200 font-mono">
                                共 {groupItems.length} 組
                              </span>
                            </div>

                            {/* Subgroup Items Ordered List */}
                            <div className="space-y-3 flex-1">
                              {groupItems.length === 0 ? (
                                <div className="text-center py-6 text-slate-400 text-xs">
                                  該組尚無資料
                                </div>
                              ) : (
                                groupItems.map((item) => {
                                  const matched = isMatch(item);

                                  return (
                                    <div
                                      key={item.id}
                                      className={`p-4 sm:p-5 rounded-xl border transition-all text-left flex items-center gap-4 ${
                                        matched
                                          ? 'bg-blue-50/90 border-blue-400 ring-2 ring-blue-300 shadow-md scale-[1.01]'
                                          : 'bg-white border-slate-200 hover:border-slate-300 hover:shadow-xs'
                                      }`}
                                    >
                                      {/* Prominent draw code badge */}
                                      <div className="min-w-24 min-h-20 px-3 py-4 rounded-xl text-white flex flex-col items-center justify-center shrink-0 shadow-xs bg-rose-700">
                                        <span className="text-xs font-semibold tracking-wider leading-none">
                                          編號
                                        </span>
                                        <span className="text-2xl sm:text-3xl font-black font-mono leading-none mt-1">
                                          {item.draw_code || '編號未設定'}
                                        </span>
                                      </div>

                                      {/* Project Details */}
                                      <div className="flex-1 min-w-0">
                                        {matched && (
                                          <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
                                            <span className="text-[10px] font-bold text-blue-700 bg-blue-100 px-1.5 py-0.2 rounded animate-pulse">
                                              搜尋結果
                                            </span>
                                          </div>
                                        )}

                                        <h5
                                          className="text-lg sm:text-xl lg:text-2xl font-bold text-slate-950 leading-snug break-words"
                                          title={item.project_title}
                                        >
                                          {item.project_title}
                                        </h5>

                                      </div>
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    /* Table View (Structured Table per Domain) */
                    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-xs">
                      <table className="w-full text-left text-xs sm:text-sm min-w-[500px]">
                        <thead>
                          <tr className="bg-blue-50 text-blue-950 text-xs font-semibold border-b border-blue-200">
                            <th className="py-2.5 px-3 whitespace-nowrap">編號</th>
                            <th className="py-2.5 px-3 whitespace-nowrap">分組場次</th>
                            <th className="py-2.5 px-3">專題名稱</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {domainDrawnProjects
                            .sort((a, b) => {
                              if (a.assigned_group !== b.assigned_group) {
                                return (a.assigned_group || 0) - (b.assigned_group || 0);
                              }
                              return (a.draw_order || 0) - (b.draw_order || 0);
                            })
                            .map((item) => {
                              const matched = isMatch(item);
                              return (
                                <tr
                                  key={item.id}
                                  className={`transition-colors ${
                                    matched
                                      ? 'bg-blue-50/90 font-semibold text-blue-900 border-l-4 border-blue-600'
                                      : 'hover:bg-slate-50 text-slate-700'
                                  }`}
                                >
                                  <td className="py-2.5 px-3 whitespace-nowrap">
                                    <span className="font-mono font-black text-rose-600 bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
                                      {item.draw_code || '編號未設定'}
                                    </span>
                                  </td>
                                  <td className="py-2.5 px-3 whitespace-nowrap font-mono text-xs">
                                    <span className="font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-100">
                                      {formatSessionLabel(item.assigned_group!)}
                                    </span>
                                  </td>
                                  <td className="py-2.5 px-3 max-w-xs sm:max-w-md truncate font-medium">
                                    {item.project_title}
                                    {matched && (
                                      <span className="ml-2 text-[10px] bg-blue-600 text-white px-1.5 py-0.2 rounded font-normal">
                                        相符
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* In-App Confirmation Modal for Batch Draw */}
      {isBatchModalOpen && (
        <div role="dialog" aria-modal="true" aria-label="確認開始抽籤" className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-3xl max-w-lg w-full p-6 sm:p-7 shadow-xl space-y-5">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-100">
                  <Zap className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base sm:text-lg font-bold text-slate-900">
                    啟動各領域獨立自動抽籤
                  </h3>
                  <p className="text-xs text-slate-500">
                    依各領域設定之組數獨立排定報告順序
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsBatchModalOpen(false)}
                aria-label="關閉抽籤確認視窗"
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-2.5 text-xs text-slate-700 leading-relaxed">
              <div className="font-bold text-slate-900 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>抽籤規則說明：</span>
              </div>
              <ul className="list-disc list-inside space-y-1 text-slate-600">
                <li><strong>本次範圍</strong>：{drawFields.join('、') || '尚未選擇'}，共 {drawablePool.length} 件專題。</li>
                <li>
                  <strong>各領域獨立排序</strong>：每個領域依其設定的「分組組數」分別獨立產生順序（例如：第 1 組、第 2 組等各自從順序 01 起跳）。
                </li>
                <li>
                  <strong>編號</strong>：A 企業智慧化、B 數位內容與多媒體應用、C 網路應用與資通安全、D 嵌入式系統與行動計算、E 智慧運算創新應用、F 智慧流通應用與研究、G 進修部。各領域從 01 連續編號，跨組不重複，例如 A01、A02。
                </li>
                {domainConfigs.filter(cfg => drawFields.includes(cfg.field) && cfg.groupCapacities).map(cfg => (
                  <li key={cfg.id}><strong>{cfg.field} 指定件數</strong>：{Array.from({ length: cfg.groupCount }, (_, i) => `第 ${i + 1} 組 ${cfg.groupCapacities![i + 1]} 件`).join('、')}。抽籤將同時遵守指定件數與指導老師迴避。</li>
                ))}
              </ul>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-1">
              <button
                onClick={() => setIsBatchModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium cursor-pointer"
              >
                取消
              </button>
              <button
                onClick={handleConfirmBatchDraw}
                className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-sm cursor-pointer flex items-center gap-1.5"
              >
                <Zap className="w-3.5 h-3.5" />
                <span>確認開始抽籤</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset Modal */}
      {isResetModalOpen && (
        <div role="dialog" aria-modal="true" aria-label="確認重設抽籤結果" className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-3xl max-w-md w-full max-h-[90dvh] overflow-y-auto p-6 shadow-xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0 border border-rose-100">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">確定重設抽籤結果？</h3>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  請勾選要重設的領域。所選領域的分組、報告順位及抽籤編號將清除，其他領域保留。
                </p>
              </div>
            </div>

            <fieldset disabled={isResetting} className="space-y-3">
              <legend className="w-full">
                <span className="flex items-center justify-between gap-2">
                  <span className="whitespace-nowrap text-xs font-bold text-slate-800 sm:text-sm">重設範圍（可複選）</span>
                  <span className="flex shrink-0 items-center gap-2 text-xs">
                    <button type="button" disabled={isResetting} onClick={() => setResetFields([...resettableFields])} className="rounded-lg bg-slate-100 px-2 py-2 font-bold text-slate-700 disabled:opacity-50 sm:px-3">全選</button>
                    <button type="button" disabled={isResetting} onClick={() => setResetFields([])} className="rounded-lg bg-slate-100 px-2 py-2 font-bold text-slate-700 disabled:opacity-50 sm:px-3">清除</button>
                  </span>
                </span>
              </legend>
              <div className="max-h-[30dvh] overflow-y-auto rounded-xl border border-slate-200 divide-y divide-slate-100">
                {resettableFields.map(field => <label key={field} className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                  <input type="checkbox" checked={selectedResetFields.includes(field)} onChange={event => {
                    if (isResetting) return;
                    const checked = event.target.checked;
                    setResetFields(current => checked ? [...current.filter(value => value !== field), field] : current.filter(value => value !== field));
                  }} className="h-4 w-4 shrink-0 accent-rose-600" />
                  <span className="min-w-0 flex-1 font-semibold text-slate-700">{field}</span>
                  <small className="shrink-0 text-slate-500">{projects.filter(p => p.field === field).length} 件</small>
                </label>)}
              </div>
              <p role="status" className="text-xs font-semibold text-rose-700">{selectedResetFields.length ? `將重設 ${selectedResetFields.length} 個領域，共 ${resetProjectCount} 件專題。` : '請勾選至少一個領域。'}</p>
            </fieldset>
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                onClick={() => setIsResetModalOpen(false)}
                disabled={isResetting}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium cursor-pointer"
              >
                取消保留
              </button>
              <button
                onClick={handleConfirmReset}
                disabled={isResetting || !selectedResetFields.length}
                className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-5 py-2 text-xs font-bold text-white shadow-sm hover:bg-rose-700 disabled:opacity-60 cursor-pointer"
              >
                {isResetting && <RotateCcw className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                {isResetting ? '重設中…' : `重設所選領域（${selectedResetFields.length}）`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Non-blocking reminder */}
      {noticeMessage && (
        <FloatingNotice message={noticeMessage} type="error" onClose={() => setNoticeMessage(null)} />
      )}
      </div>
      {carouselScope !== null && <ResultCarousel projects={projects} domains={domainConfigs} scope={carouselScope} onClose={() => setCarouselScope(null)} />}
    </div>
  );
};
