import { isCompleteDrawResult } from '../lib/drawScope';
import { formatSessionLabel } from '../lib/sessionLabel';
import { Edit, Trash2, AlertTriangle } from 'lucide-react';
import type { ProjectItem } from '../types';
import { isAdvisorConflict } from '../lib/lottery';

interface Props {
  project: ProjectItem;
  sharedPasswordEnabled: boolean;
  onEdit: () => void;
  onDelete: () => void;
}

export function ProjectRosterCard({ project: p, sharedPasswordEnabled, onEdit, onDelete }: Props) {
  const drawn = isCompleteDrawResult(p);
  const conflict = !!p.assigned_group && isAdvisorConflict(p.advisor, p.evaluators || []);
  return (
    <article aria-label={`${p.original_code} ${p.project_title}`} className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
      <div className="flex-1 space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-xs font-medium text-slate-500">名冊序號</p>
            <p className="mt-0.5 font-mono text-2xl font-black tracking-tight text-slate-900">{p.seq_no || '—'}</p>
          </div>
          <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${drawn ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
            {drawn ? '已抽籤' : '尚未抽籤'}
          </span>
        </div>

        <div className="space-y-1.5">
          <p className="break-words text-xs font-medium text-blue-700">{p.field || '未設定領域'} <span className="text-slate-400">· 原始編號 {p.original_code || '未編號'}</span></p>
          <h3 className="break-words text-base font-bold leading-relaxed text-slate-900">{p.project_title}</h3>
        </div>

        <dl className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="min-w-0">
            <dt className="text-xs text-slate-500">抽籤後編號</dt>
            <dd className="mt-1 break-words font-mono text-sm font-bold text-emerald-800">{p.draw_code || '待抽籤'}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-slate-500">分組場次</dt>
            <dd className="mt-1 text-sm font-bold text-slate-800">{p.assigned_group ? formatSessionLabel(p.assigned_group) : '待分配'}</dd>
          </div>
        </dl>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <div className="min-w-0"><dt className="text-xs text-slate-500">組長姓名</dt><dd className="mt-1 break-words font-medium text-slate-800">{p.leader_name || '尚未提供'}</dd></div>
          <div className="min-w-0"><dt className="text-xs text-slate-500">組長學號</dt><dd className="mt-1 break-all font-mono font-semibold text-blue-700">{p.leader_id || '—'}</dd></div>
          <div className="min-w-0"><dt className="text-xs text-slate-500">指導老師</dt><dd className="mt-1 break-words font-medium text-slate-800">{p.advisor || '未設定'}</dd></div>
          <div className="min-w-0"><dt className="text-xs text-slate-500">班級</dt><dd className="mt-1 break-words text-slate-800">{p.class_name || '—'}</dd></div>
          <div className="min-w-0"><dt className="text-xs text-slate-500">學制</dt><dd className="mt-1 break-words text-slate-800">{p.education_system || '—'}</dd></div>
          <div className="min-w-0"><dt className="text-xs text-slate-500">系所</dt><dd className="mt-1 break-words text-slate-800">{p.department || '—'}</dd></div>
          <div className="col-span-2 min-w-0 border-t border-slate-100 pt-3">
            <dt className="text-xs text-slate-500">評審委員</dt>
            <dd className="mt-1 break-words leading-relaxed text-slate-800">{p.evaluators?.length ? p.evaluators.join('、') : drawn ? '尚未設定評審' : '抽籤後顯示'}</dd>
          </div>
        </dl>

        {conflict && <p className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold leading-relaxed text-rose-800"><AlertTriangle className="h-4 w-4 shrink-0" />指導老師與評審名單有利益衝突，請檢查分組設定。</p>}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
          <span className="text-xs text-slate-500">學生登入密碼</span>
          <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${p.password_set ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
            {sharedPasswordEnabled ? '使用共用密碼' : p.password_set ? '已設定' : '尚未設定'}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3 sm:px-5">
        <button type="button" onClick={onEdit} aria-label={`編輯 ${p.original_code} 專題`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-blue-500"><Edit className="h-4 w-4" />編輯專題</button>
        <button type="button" onClick={onDelete} aria-label={`刪除 ${p.original_code} 專題`} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-3 text-sm font-medium text-rose-700 transition hover:bg-rose-100 focus-visible:outline-2 focus-visible:outline-rose-500"><Trash2 className="h-4 w-4" />刪除</button>
      </div>
    </article>
  );
}
