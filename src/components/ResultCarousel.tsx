import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play, Settings, X } from 'lucide-react';
import type { DomainConfig, ProjectItem } from '../types';
import { buildResultSlides } from '../lib/resultPresentation';
import { useModalFocus } from '../lib/useModalFocus';
import './ResultCarousel.css';

interface Props {
  projects: ProjectItem[];
  domains: DomainConfig[];
  scope: string | string[];
  onClose: () => void;
}

export function ResultCarousel({ projects, domains, scope, onClose }: Props) {
  const [pageSize, setPageSize] = useState<5 | 10>(5);
  const [index, setIndex] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [seconds, setSeconds] = useState(10);
  const [remaining, setRemaining] = useState(10);
  const [visible, setVisible] = useState(!document.hidden);
  const listRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<string | null>(null);
  const slides = useMemo(() => buildResultSlides(projects, domains, scope, pageSize), [projects, domains, scope, pageSize]);
  const safeIndex = Math.min(index, Math.max(0, slides.length - 1));
  const slide = slides[safeIndex];
  const next = slides[(safeIndex + 1) % slides.length];
  const running = playing && visible && !settingsOpen && slides.length > 1;

  useModalFocus(settingsOpen ? 'carousel-settings' : 'result-carousel', () => settingsOpen ? setSettingsOpen(false) : onClose());
  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  useEffect(() => {
    // Keep the current project visible when loaded results change.
    const anchor = anchorRef.current;
    if (anchor) {
      const found = slides.findIndex((page) => page.items.some((item) => item.id === anchor));
      if (found >= 0) setIndex(found);
    }
    setRemaining(seconds);
  }, [slides, seconds]);
  useEffect(() => { anchorRef.current = slide?.items[0]?.id ?? null; }, [slide]);
  useEffect(() => { setRemaining(seconds); listRef.current?.scrollTo({ top: 0 }); }, [slide?.key, seconds]);
  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(() => {
      if (remaining > 1) setRemaining(remaining - 1);
      else {
        setIndex((current) => (current + 1) % slides.length);
        setRemaining(seconds);
      }
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [running, remaining, seconds, slides.length]);

  const move = (direction: number) => {
    setIndex((safeIndex + direction + slides.length) % slides.length);
    setRemaining(seconds);
  };
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (settingsOpen) return;
      const target = event.target as HTMLElement;
      if (target.closest('select, input, textarea')) return;
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault(); move(event.key === 'ArrowRight' ? 1 : -1);
      } else if (event.code === 'Space') {
        event.preventDefault(); setPlaying((value) => !value);
      }
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  });

  const groups = slides.map((page, position) => ({ page, position })).filter(({ page }) => page.page === 0);
  return (
    <section className="result-carousel" role="dialog" aria-modal="true" aria-label="抽籤結果輪播">
      <header className="result-carousel-header">
        <div className="result-carousel-brand">
          <img className="result-carousel-logo" src="/android-chrome-512x512.png" alt="國立臺中科技大學專題成果展" width={56} height={56} />
          <div className="result-carousel-heading">
            <p>國立臺中科技大學 · 專題報告抽籤結果</p>
            <h2>{slide?.field ?? '目前沒有可展示的抽籤結果'}</h2>
          </div>
        </div>
        <button onClick={onClose} className="result-control" aria-label="結束輪播，返回抽籤畫面"><X size={20} /><span>返回抽籤</span></button>
      </header>
      {slide && <div className="result-carousel-meta">
        <div className="result-carousel-group">
          <strong>第 <b>{slide.group}</b> 組</strong>
        </div>
        <div className="result-carousel-page-info">
          <span className="result-carousel-group-page" aria-label={`本組第 ${slide.page + 1}／${slide.pages} 頁`}><small>本組頁碼</small><span><b>{slide.page + 1}</b>／{slide.pages} 頁</span></span>
        </div>
      </div>}
      <div className={`result-carousel-list ${pageSize === 10 ? 'result-carousel-list--two-columns' : ''}`} ref={listRef} onWheel={() => setPlaying(false)} onTouchMove={() => setPlaying(false)} style={{ '--result-rows': 5 } as React.CSSProperties}>
        {slide?.items.map((item) => <article className="result-carousel-row" key={item.id}>
          <div className="result-carousel-order"><small>報告順位</small><strong>{String(item.draw_order).padStart(2, '0')}</strong></div>
          <div className="result-carousel-project"><span>{item.draw_code || '編號未設定'}</span><h3>{item.project_title}</h3></div>
        </article>)}
        {!slide && <p className="result-carousel-empty">請先完成抽籤，再開始展示。</p>}
      </div>
      <footer className="result-carousel-footer">
        <div className="result-carousel-controls">
          <div className="result-carousel-transport">
            <button className="result-control" onClick={() => move(-1)} disabled={slides.length < 2} aria-label="上一頁"><ChevronLeft /></button>
            <button className="result-control result-control-primary" onClick={() => setPlaying((value) => !value)} disabled={slides.length < 2} aria-label={playing ? '暫停輪播' : '播放輪播'}>{playing ? <Pause size={18} /> : <Play size={18} />}{playing ? '暫停' : '播放'}</button>
            <button className="result-control" onClick={() => move(1)} disabled={slides.length < 2} aria-label="下一頁"><ChevronRight /></button>
            <span className="result-carousel-counter">{slides.length ? safeIndex + 1 : 0}／{slides.length} 頁</span>
          </div>
          <button type="button" className="result-control result-carousel-settings-trigger" onClick={() => setSettingsOpen(true)} aria-haspopup="dialog"><Settings size={18} />設定</button>
        </div>
        <div className="result-carousel-hint"><span>{slides.length < 2 ? '單頁結果' : !visible ? '背景暫停' : settingsOpen ? '設定中 · 暫停換頁' : playing ? `${remaining} 秒後換頁 · 循環播放` : '已暫停'}{next && slides.length > 1 ? ` · 下一頁：${next.field} 第 ${next.group} 組` : ''}</span><span>← → 換頁 · 空白鍵播放／暫停 · Esc 返回</span></div>
      </footer>
      {settingsOpen && <div className="result-carousel-settings-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false); }}>
        <div className="result-carousel-settings" role="dialog" aria-modal="true" aria-label="輪播設定">
          <div className="result-carousel-settings-heading"><h3><Settings size={20} />輪播設定</h3><button type="button" className="result-control" aria-label="關閉輪播設定" onClick={() => setSettingsOpen(false)}><X size={18} /></button></div>
          <p>設定期間暫停換頁，關閉後依原播放狀態繼續。</p>
          <div className="result-carousel-settings-fields">
          <label>跳至場次<select aria-label="跳至場次" value={slide ? JSON.stringify([slide.field, slide.group]) : ''} onChange={(event) => {
            const found = groups.find(({ page }) => JSON.stringify([page.field, page.group]) === event.target.value);
            if (found) { setIndex(found.position); setRemaining(seconds); }
          }}>{groups.map(({ page }) => <option key={page.key} value={JSON.stringify([page.field, page.group])}>{page.field} · 第 {page.group} 組</option>)}</select></label>
          <label>每頁筆數<select aria-label="每頁筆數" value={pageSize} onChange={(event) => setPageSize(Number(event.target.value) as 5 | 10)}><option value={5}>5 筆（單欄）</option><option value={10}>10 筆（左右）</option></select></label>
          <label>換頁間隔<select aria-label="換頁間隔" value={seconds} onChange={(event) => setSeconds(Number(event.target.value))}>{[3, 5, 10, 15, 20, 30].map((value) => <option key={value} value={value}>{value} 秒</option>)}</select></label>
          </div>
          <button type="button" className="result-control result-control-primary result-carousel-settings-done" onClick={() => setSettingsOpen(false)}>完成設定</button>
        </div>
      </div>}
    </section>
  );
}
