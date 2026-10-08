import { formatSessionLabel } from '../lib/sessionLabel';
import { useRef, useState } from 'react';
import { FlaskConical, LoaderCircle, X } from 'lucide-react';
import type { DomainConfig } from '../types';
import type { LotteryTestResult } from '../lib/lotteryTest';
import { isRequestCancelled } from '../lib/api';
import { useApiRequest } from '../lib/useApiRequest';
import { useModalFocus } from '../lib/useModalFocus';

export function LotteryTestPanel({ version, configs, disabled }: { version: number | null; configs: DomainConfig[]; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const request = useApiRequest(open);
  const [field, setField] = useState('ALL');
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<LotteryTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);
  useModalFocus(open ? 'lottery-test' : null, () => setOpen(false));
  const run = async (selected: string) => {
    if (running.current || version === null) return;
    running.current = true;
    setLoading(true); setReport(null); setError(null); setOpen(true);
    try { setReport(await request<LotteryTestResult>('/api/lottery/test', { field: selected, version })); }
    catch (err) { if (!isRequestCancelled(err)) setError(err instanceof Error ? err.message : '測試失敗，請稍後再試。'); }
    finally { running.current = false; setLoading(false); }
  };
  return <>
    <button type="button" disabled={disabled || loading || version === null} onClick={() => { setField('ALL'); setReport(null); setError(null); setOpen(true); }}
      className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-3 text-xs font-semibold text-blue-800 hover:bg-blue-100 disabled:opacity-40 sm:w-auto">
      <FlaskConical className="h-4 w-4" />測試抽籤
    </button>
    {open && <div role="dialog" aria-modal="true" aria-label="抽籤測試報告" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-xs">
      <div className="max-h-[90dvh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div><h2 className="text-lg font-bold text-slate-900">抽籤測試報告</h2><p className="mt-1 text-xs leading-relaxed text-slate-600">僅試跑目前已儲存的名冊與設定，不會儲存或覆蓋正式抽籤結果。</p></div>
          <button type="button" aria-label="關閉測試報告" onClick={() => setOpen(false)} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>
        <div className="my-4 flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1"><label htmlFor="lottery-test-field" className="mb-1 block text-xs font-semibold text-slate-700">測試範圍</label>
            <select id="lottery-test-field" value={field} disabled={loading} onChange={e => setField(e.target.value)} className="w-full rounded-lg border border-slate-300 p-2 text-sm">
              <option value="ALL">全校所有領域</option>{configs.map(c => <option key={c.id} value={c.field}>{c.field}</option>)}
            </select></div>
          <button type="button" disabled={loading || version === null} onClick={() => void run(field)} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-50">
            {loading && <LoaderCircle className="h-4 w-4 animate-spin" />}{loading ? '測試中…' : report ? '重新測試' : '開始測試'}
          </button>
        </div>
        {!loading && !report && !error && <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">請選擇測試範圍，再按「開始測試」執行一次抽籤試跑。</p>}
        {loading && <p role="status" className="rounded-xl bg-blue-50 p-4 text-sm text-blue-800">正在試跑抽籤與檢查分組設定…</p>}
        {error && <p role="alert" className="rounded-xl bg-rose-50 p-4 text-sm text-rose-800">{error}</p>}
        {report && <div className="space-y-4">
          <div className={`rounded-xl border p-4 ${report.errorCount ? 'border-rose-200 bg-rose-50' : report.warningCount ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`} role="status">
            <p className="font-bold">{report.errorCount ? '檢查未通過' : report.warningCount ? '試跑完成，有項目需注意' : '本次試跑檢查通過'}</p>
            <p className="mt-1 text-sm">範圍：{report.field === 'ALL' ? '全校所有領域' : report.field} · {report.projectCount} 件 · {report.errorCount} 項問題 · {report.warningCount} 項提醒</p>
            <p className="mt-2 text-xs text-slate-600">單次試跑結果僅供檢查；正式抽籤會重新隨機分配與排序。已有正式結果仍可試跑，正式重抽須先重設。</p>
          </div>
          {report.version !== version && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">名冊或設定已更新，這份報告使用舊資料，請重新測試。</p>}
          {report.domains.map(domain => <section key={domain.field} className="min-w-0 space-y-3 rounded-xl border border-slate-200 p-4">
            <h3 className="break-words font-bold text-slate-900">{domain.field} · {domain.projectCount} 件</h3>
            <div className="flex flex-wrap gap-2">{domain.groups.map(g => <span key={g.group} className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-700">{formatSessionLabel(g.group)}：{domain.preview.length ? `${g.count} 件` : '未產生結果'}{g.target !== null ? `（指定 ${g.target} 件）` : ''}</span>)}</div>
            {domain.issues.length > 0 && <ul className="space-y-2 text-sm">{domain.issues.map((issue, i) => <li key={i} className={`break-words rounded-lg p-3 ${issue.level === 'error' ? 'bg-rose-50 text-rose-800' : 'bg-amber-50 text-amber-900'}`}>{issue.level === 'error' ? '問題：' : '提醒：'}{issue.message}</li>)}</ul>}
            {domain.preview.length > 0 && <details><summary className="cursor-pointer text-sm font-semibold text-blue-700">查看本次試跑場次（未儲存）</summary>
              <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="border-b text-slate-500"><th className="p-2">原始編號</th><th className="p-2">抽籤後編號</th><th className="p-2">場次</th><th className="p-2">專題名稱</th></tr></thead><tbody>{domain.preview.map((p, i) => <tr key={i} className="border-b border-slate-100"><td className="whitespace-nowrap p-2 font-mono">{p.originalCode}</td><td className="whitespace-nowrap p-2 font-mono">{p.drawCode}</td><td className="whitespace-nowrap p-2">{formatSessionLabel(p.group)}</td><td className="min-w-40 p-2">{p.title}</td></tr>)}</tbody></table></div>
            </details>}
          </section>)}
        </div>}
      </div>
    </div>}
  </>;
}
