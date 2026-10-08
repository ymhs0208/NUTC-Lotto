import { useEffect, useState } from 'react';
import { LoaderCircle, Search, ClipboardList } from 'lucide-react';
import { isRequestCancelled } from '../lib/api';
import { useApiRequest } from '../lib/useApiRequest';
import { staffActions, type StaffLogPage } from '../types/staffLogs';

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
  const inputClass = 'min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm';
  return <section className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="flex items-center gap-2 text-xl font-black text-slate-900 sm:text-2xl"><ClipboardList className="text-blue-700" />工作人員操作紀錄</h1><p className="mt-1 text-sm text-slate-500">依時間由新到舊查看操作紀錄；日期以臺灣時間顯示。</p></div><a href="/admin" className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-700">返回管理後台</a></div>
    <form className="grid grid-cols-2 gap-3 rounded-2xl border border-slate-200 bg-white p-4" onSubmit={event => { event.preventDefault(); setEmail(emailInput.trim()); setCursors([undefined]); setRevision(value => value + 1); }}>
      <label className="col-span-2 space-y-1 text-xs font-bold text-slate-600 sm:col-span-1">工作人員帳號<input type="search" maxLength={256} value={emailInput} onChange={event => setEmailInput(event.target.value)} placeholder="搜尋工作人員 Email" className={inputClass} /></label>
      <label className="col-span-2 space-y-1 text-xs font-bold text-slate-600 sm:col-span-1">操作類型<select value={action} onChange={event => { setAction(event.target.value); setCursors([undefined]); }} className={inputClass}><option value="">全部操作</option>{Object.entries(staffActions).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <div className="col-span-2 flex flex-wrap justify-end gap-2"><button type="button" disabled={loading} onClick={() => { setCursors([undefined]); setRevision(value => value + 1); }} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold disabled:opacity-50">重新載入</button><button type="submit" className="flex items-center gap-2 rounded-xl bg-blue-700 px-5 py-2 text-sm font-bold text-white"><Search size={16} />搜尋／篩選</button></div>
    </form>
    {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}<button type="button" className="ml-4 underline" onClick={() => setRevision(value => value + 1)}>重試</button></div>}
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white" aria-busy={loading} tabIndex={0} role="region" aria-label="操作紀錄表格，可左右捲動">
      <table className="w-full min-w-[760px] text-left text-sm">
        <caption className="sr-only">工作人員操作紀錄，依時間由新到舊排列</caption>
        <thead className="bg-slate-50 text-slate-600"><tr>{['時間', '工作人員', '角色', '操作', '範圍與內容'].map(label => <th scope="col" key={label} className="px-4 py-3 font-bold">{label}</th>)}</tr></thead>
        <tbody>{loading ? <tr><td colSpan={5} className="p-8 text-center text-slate-500"><LoaderCircle className="mr-2 inline animate-spin motion-reduce:animate-none" size={18} />正在載入紀錄…</td></tr> : error || !data.logs.length ? <tr><td colSpan={5} className="p-8 text-center text-slate-500">{error ? '無法取得紀錄，請重新載入。' : '目前篩選條件沒有紀錄。'}</td></tr> : data.logs.map(log => <tr key={log.id} className="border-t border-slate-100">
          <td className="whitespace-nowrap px-4 py-4 tabular-nums"><time dateTime={log.created_at}>{new Date(log.created_at).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false })}</time></td>
          <td className="px-4 py-4 break-all">{log.email}</td>
          <td className="whitespace-nowrap px-4 py-4">{log.role === 'admin' ? '管理員' : '抽籤人員'}</td>
          <td className="whitespace-nowrap px-4 py-4 font-bold">{staffActions[log.action]}</td>
          <td className="max-w-md px-4 py-4"><p className="break-words">{log.summary}</p>{log.version !== null && <p className="mt-1 text-xs text-slate-500">資料版本 {log.version}</p>}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <div className="flex items-center justify-between gap-4 text-sm"><span className="text-slate-500" aria-live="polite">第 {cursors.length} 頁 · 本頁 {loading || error ? 0 : data.logs.length} 筆</span><div className="flex gap-2"><button type="button" className="rounded-xl border border-slate-300 bg-white px-4 py-2 disabled:opacity-40" disabled={loading || cursors.length === 1} onClick={() => setCursors(values => values.slice(0, -1))}>上一頁</button><button type="button" className="rounded-xl border border-slate-300 bg-white px-4 py-2 disabled:opacity-40" disabled={loading || !!error || data.nextCursor === null} onClick={() => setCursors(values => [...values, data.nextCursor!])}>下一頁</button></div></div>
  </section>;
}
