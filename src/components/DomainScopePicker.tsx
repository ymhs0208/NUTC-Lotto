import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import type { DomainConfig, ProjectItem } from '../types';
import './DomainScopePicker.css';
import { getAvailableDrawFields, getSelectedDrawFields, getIncompleteDrawFields } from '../lib/drawScope';

interface Props {
  domains: DomainConfig[];
  projects: ProjectItem[];
  selected: string[] | null;
  disabled: boolean;
  onChange: (fields: string[] | null) => void;
}
export function DomainScopePicker({ domains, projects, selected, disabled, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const fields = domains.map(domain => domain.field);
  const available = getAvailableDrawFields(fields, projects);
  const incomplete = getIncompleteDrawFields(fields, projects);
  const checked = getSelectedDrawFields(fields, projects, selected);
  const total = projects.filter(project => checked.includes(project.field)).length;
  const all = available.length > 0 && checked.length === available.length;
  const label = available.length === 0 ? '目前沒有可抽籤領域' : all && available.length !== fields.length ? `所有未抽籤領域（${total} 件）` : all ? `全校所有領域（${total} 件）` : checked.length === 1 ? `${checked[0]}（${total} 件）` : checked.length ? `已選 ${checked.length} 個領域（${total} 件）` : '請勾選抽籤領域';
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  return <div className="domain-scope-picker" ref={ref} onKeyDown={event => {
    if (open && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); ref.current?.querySelector('button')?.focus(); }
  }}>
    <button type="button" className="domain-scope-trigger" disabled={disabled} aria-label={`抽籤範圍：${label}`} aria-expanded={open} onClick={() => setOpen(value => !value)}><span>{label}</span><ChevronDown size={16} /></button>
    {open && <div className="domain-scope-options" role="group" aria-label="勾選抽籤領域">
      <div className="domain-scope-heading"><strong>選擇抽籤領域</strong><span>可複選</span><button type="button" aria-label="完成領域選擇" onClick={() => setOpen(false)}><Check size={16} />完成</button></div>
      <div className="domain-scope-shortcuts"><button type="button" disabled={disabled || available.length === 0} onClick={() => { if (!disabled && available.length > 0) onChange(null); }}>全選</button><button type="button" onClick={() => onChange([])}>清除</button><span>已選 {checked.length} 個</span></div>
      <div className="domain-scope-list">{domains.map(domain => <label key={domain.id} aria-disabled={!available.includes(domain.field)}><input type="checkbox" disabled={disabled || !available.includes(domain.field)} checked={checked.includes(domain.field)} onChange={event => {
        if (disabled || !available.includes(domain.field)) return;
        const next = event.target.checked ? [...checked, domain.field] : checked.filter(field => field !== domain.field);
        onChange(next.length === available.length ? null : next);
      }} /><span>{domain.field}</span><small>{incomplete.includes(domain.field) ? '資料不完整 · ' : !available.includes(domain.field) ? '已抽籤 · ' : ''}{projects.filter(project => project.field === domain.field).length} 件</small></label>)}</div>
      {!domains.length && <p>尚無領域設定</p>}
      <p className="domain-scope-help">已有抽籤結果的領域不可勾選；重設結果後即可再次選取。</p>
      {incomplete.length > 0 && <p className="domain-scope-help">資料不完整的領域請先補齊匯入資料，或重設後重新抽籤。</p>}
    </div>}
  </div>;
}
