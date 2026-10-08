import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw, Search, ClipboardList } from 'lucide-react';
import { isRequestCancelled } from '../lib/api';
import { useApiRequest } from '../lib/useApiRequest';
import { staffActions, type StaffLog, type StaffLogPage } from '../types/staffLogs';

const dateFormat = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFormat = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
function LogTime({ log }: { log: StaffLog }) {
  const date = new Date(log.created_at);
  return <time dateTime={log.created_at} className="block whitespace-nowrap tabular-nums"><span className="block text-slate-700">{dateFormat.format(date)}</span><span className="mt-1 block text-xs text-slate-500">{timeFormat.format(date)}</span></time>;
}
function LogAccount({ log }: { log: StaffLog }) {
  return <><span className="block font-medium text-slate-900 [overflow-wrap:anywhere]">{log.email}</span><span className={`mt-1.5 inline-block text-xs ${log.role === 'admin' ? 'text-emerald-700' : 'text-slate-500'}`}>{log.role === 'admin' ? '管理員' : '抽籤人員'}</span></>;
}
function LogAction({ log }: { log: StaffLog }) {
  const color = log.action === 'reset' || log.action === 'password_clear' ? 'bg-rose-50 text-rose-800'
    : log.action === 'draw' ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-700';
  return <span className={`inline-block max-w-full rounded px-2 py-1 text-xs font-medium leading-5 ${color}`}>{staffActions[log.action]}</span>;
}
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
  const iconButton = 'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40';
  return <section className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="flex items-center gap-2 text-xl font-black text-slate-900 sm:text-2xl"><ClipboardList className="shrink-0 text-blue-700" />工作人員操作紀錄</h1><p className="mt-1 text-sm text-slate-500">依時間由新到舊查看操作紀錄；日期以臺灣時間顯示。</p></div>
      <div className="flex items-center gap-2"><a href="/admin" className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-700">返回管理後台</a><button type="button" title="重新整理" aria-label="重新整理" disabled={loading} className={iconButton} onClick={() => { setCursors([undefined]); setRevision(value => value + 1); }}><RefreshCw size={18} className={loading ? 'animate-spin motion-reduce:animate-none' : ''} /></button></div>
    </header>
    <form className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-4" onSubmit={event => { event.preventDefault(); setEmail(emailInput.trim()); setCursors([undefined]); setRevision(value => value + 1); }}>
      <label className="flex min-w-0 flex-1 flex-col gap-2 text-sm text-slate-600">工作人員帳號<input type="search" maxLength={256} value={emailInput} onChange={event => setEmailInput(event.target.value)} placeholder="搜尋電子信箱" className="min-h-11 min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-slate-900" /></label>
      <button type="submit" title="搜尋" aria-label="搜尋" className={iconButton}><Search size={18} /></button>
      <label className="flex w-full flex-col gap-2 text-sm text-slate-600 sm:w-52">操作類型<select value={action} onChange={event => { setAction(event.target.value); setCursors([undefined]); }} className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-slate-900"><option value="">全部操作</option>{Object.entries(staffActions).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    </form>
    {error ? <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">{error}<button type="button" className="ml-4 underline" onClick={() => setRevision(value => value + 1)}>重試</button></div> :
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white" aria-busy={loading}>
        <div className="hidden lg:block">
          <table className="w-full table-fixed text-left text-sm leading-6">
            <caption className="sr-only">工作人員操作紀錄，依時間由新到舊排列</caption>
            <colgroup><col className="w-36" /><col className="w-[25%]" /><col className="w-44" /><col /><col className="w-24" /></colgroup>
            <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500"><tr>{['時間（台北）', '工作人員', '操作', '內容', '資料版本'].map((label, index) => <th scope="col" key={label} className={`px-4 py-3 font-bold ${index === 4 ? 'text-right' : ''}`}>{label}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100 bg-white">{loading || !data.logs.length ? <tr><td colSpan={5} className="px-4 py-16 text-center text-slate-500">{loading ? '載入紀錄中…' : '目前沒有符合條件的紀錄'}</td></tr> : data.logs.map(log => <tr key={log.id} className="align-top transition-colors hover:bg-slate-50">
              <td className="px-4 py-4"><LogTime log={log} /></td>
              <td className="px-4 py-4"><LogAccount log={log} /></td>
              <td className="px-4 py-4"><LogAction log={log} /></td>
              <td className="px-4 py-4 text-slate-600 [overflow-wrap:anywhere]">{log.summary}</td>
              <td className="px-4 py-4 text-right tabular-nums text-slate-500">{log.version ?? '-'}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <div className="lg:hidden">
          <div className="border-b border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-500">操作紀錄 · 台北時間</div>
          {loading || !data.logs.length ? <div role="status" className="py-16 text-center text-sm text-slate-500">{loading ? '載入紀錄中…' : '目前沒有符合條件的紀錄'}</div> :
            <ol className="divide-y divide-slate-100 bg-white">{data.logs.map(log => <li key={log.id} className="px-3 py-4 text-sm">
              <div className="flex items-start justify-between gap-3"><LogAction log={log} /><div className="shrink-0 text-right"><LogTime log={log} /></div></div>
              <div className="mt-3"><LogAccount log={log} /></div>
              <p className="mt-3 leading-6 text-slate-600 [overflow-wrap:anywhere]">{log.summary}</p>
              <div className="mt-3 flex items-center justify-between text-xs tabular-nums text-slate-400"><span>紀錄 #{log.id}</span><span>資料版本 {log.version ?? '-'}</span></div>
            </li>)}</ol>}
        </div>
      </div>}
    <div className="flex items-center justify-between gap-4 py-4 text-sm text-slate-500"><span aria-live="polite">第 {cursors.length} 頁{!loading && !error ? ` · ${data.logs.length} 筆` : ''}</span><div className="flex gap-2"><button type="button" title="上一頁" aria-label="上一頁" className={iconButton} disabled={loading || cursors.length === 1} onClick={() => setCursors(values => values.slice(0, -1))}><ChevronLeft size={18} /></button><button type="button" title="下一頁" aria-label="下一頁" className={iconButton} disabled={loading || !!error || data.nextCursor === null} onClick={() => setCursors(values => [...values, data.nextCursor!])}><ChevronRight size={18} /></button></div></div>
  </section>;
}
