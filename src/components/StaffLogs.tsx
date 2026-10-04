import { useEffect, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, RefreshCw, Search, ClipboardList } from 'lucide-react';
import { isRequestCancelled } from '../lib/api';
import { useApiRequest } from '../lib/useApiRequest';
import { staffActions, type StaffLogPage } from '../types/staffLogs';

const dateFormat = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
export function StaffLogs() {
  const request = useApiRequest();
  const [emailInput, setEmailInput] = useState('');
  const [email, setEmail] = useState('');
  const [action, setAction] = useState('');
  const [cursors, setCursors] = useState<(number | undefined)[]>([undefined]);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<StaffLogPage>({ logs: [], nextCursor: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const before = cursors[cursors.length - 1];
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    const query = new URLSearchParams({ email, action });
    if (before !== undefined) query.set('before', String(before));
    void request<StaffLogPage>(`/api/staff-logs?${query}`, undefined, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(err => { if (!controller.signal.aborted && !isRequestCancelled(err)) setError(err instanceof Error ? err.message : '紀錄載入失敗'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [request, email, action, before, revision]);
  const iconButton = 'flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40';
  return <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
    <a href="/admin" className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-emerald-700"><ArrowLeft size={16} />管理後台</a>
    <header className="mt-6 flex items-center justify-between gap-4 border-b border-slate-200 pb-6">
      <h1 className="flex items-center gap-3 text-xl font-bold text-slate-900 sm:text-2xl"><ClipboardList className="shrink-0 text-emerald-700" />工作人員操作紀錄</h1>
      <button type="button" title="重新整理" aria-label="重新整理" disabled={loading} className={iconButton} onClick={() => { setCursors([undefined]); setRevision(value => value + 1); }}><RefreshCw size={18} className={loading ? 'animate-spin motion-reduce:animate-none' : ''} /></button>
    </header>
    <form className="flex flex-wrap items-end gap-3 py-5" onSubmit={event => { event.preventDefault(); setEmail(emailInput.trim()); setCursors([undefined]); setRevision(value => value + 1); }}>
      <label className="flex min-w-0 flex-1 flex-col gap-2 text-sm text-slate-600">工作人員帳號<input type="search" maxLength={256} value={emailInput} onChange={event => setEmailInput(event.target.value)} placeholder="搜尋電子信箱" className="h-10 min-w-0 rounded-md border border-slate-300 bg-white px-3 text-slate-900" /></label>
      <button type="submit" title="搜尋" aria-label="搜尋" className={iconButton}><Search size={18} /></button>
      <label className="flex w-full flex-col gap-2 text-sm text-slate-600 sm:w-52">操作類型<select value={action} onChange={event => { setAction(event.target.value); setCursors([undefined]); }} className="h-10 rounded-md border border-slate-300 bg-white px-3 text-slate-900"><option value="">全部操作</option>{Object.entries(staffActions).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    </form>
    {error ? <div role="alert" className="border-y border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">{error}<button type="button" className="ml-4 underline" onClick={() => setRevision(value => value + 1)}>重試</button></div> :
      <div className="overflow-x-auto border-y border-slate-200" aria-busy={loading}>
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500"><tr>{['時間（台北）', '工作人員', '操作', '內容', '資料版本'].map(label => <th key={label} className="px-4 py-3 font-medium">{label}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100 bg-white">{loading ? <tr><td colSpan={5} className="px-4 py-16 text-center text-slate-500">載入紀錄中…</td></tr> : !data.logs.length ? <tr><td colSpan={5} className="px-4 py-16 text-center text-slate-500">目前沒有符合條件的紀錄</td></tr> : data.logs.map(log => <tr key={log.id} className="align-top hover:bg-slate-50/60">
            <td className="whitespace-nowrap px-4 py-4 tabular-nums text-slate-500">{dateFormat.format(new Date(log.created_at))}</td>
            <td className="max-w-64 break-all px-4 py-4 text-slate-900">{log.email}<span className={`mt-1 block text-xs ${log.role === 'admin' ? 'text-emerald-700' : 'text-rose-700'}`}>{log.role === 'admin' ? '管理員' : '抽籤人員'}</span></td>
            <td className="whitespace-nowrap px-4 py-4 font-medium text-slate-800">{staffActions[log.action]}</td>
            <td className="min-w-48 break-words px-4 py-4 text-slate-600">{log.summary}</td>
            <td className="px-4 py-4 tabular-nums text-slate-500">{log.version ?? '-'}</td>
          </tr>)}</tbody>
        </table>
      </div>}
    <div className="flex items-center justify-between gap-4 py-4 text-sm text-slate-500"><span>第 {cursors.length} 頁</span><div className="flex gap-2"><button type="button" title="上一頁" aria-label="上一頁" className={iconButton} disabled={loading || cursors.length === 1} onClick={() => setCursors(values => values.slice(0, -1))}><ChevronLeft size={18} /></button><button type="button" title="下一頁" aria-label="下一頁" className={iconButton} disabled={loading || !!error || data.nextCursor === null} onClick={() => setCursors(values => [...values, data.nextCursor!])}><ChevronRight size={18} /></button></div></div>
  </section>;
}
