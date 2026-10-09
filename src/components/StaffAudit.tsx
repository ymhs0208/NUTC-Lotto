import React, { useEffect, useState } from 'react';
import { useApiRequest } from '../lib/useApiRequest';
import { isApiRequestCancelled } from '../lib/api';
import { auditActionLabels, type AuditRow } from '../lib/auditTypes';
import { LoaderCircle, Search, ClipboardList } from 'lucide-react';

const localDate = (date: Date) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(date);
export function StaffAudit() {
  const request = useApiRequest();
  const [form, setForm] = useState({ q: '', action: '', role: '', from: localDate(new Date(Date.now() - 29 * 86400000)), to: localDate(new Date()) });
  const [query, setQuery] = useState(form);
  const [revision, setRevision] = useState(0);
  const [records, setRecords] = useState<AuditRow[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [history, setHistory] = useState<Array<string | null>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setRecords([]); setNext(null);
    const params = new URLSearchParams({ q: query.q, action: query.action, role: query.role });
    try {
      if (query.from) params.set('from', new Date(`${query.from}T00:00:00+08:00`).toISOString());
      if (query.to) params.set('to', new Date(`${query.to}T23:59:59.999+08:00`).toISOString());
    } catch { setError('請輸入有效日期。'); setLoading(false); return; }
    if (cursor) params.set('before', cursor);
    request<{ enabled: boolean; records: AuditRow[]; nextCursor: string | null }>(`/api/staff-audit?${params}`, undefined, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) { setRecords(data.records); setNext(data.nextCursor); if (!data.enabled) setError('操作紀錄暫時無法使用，請重新載入。'); } })
      .catch(error => { if (!controller.signal.aborted && !isApiRequestCancelled(error)) setError(error instanceof Error ? error.message : '紀錄載入失敗'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [request, query, cursor, revision]);
  const inputClass = 'min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm';
  return <section className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="flex items-center gap-2 text-xl font-black text-slate-900 sm:text-2xl"><ClipboardList className="text-blue-700" />工作人員操作紀錄</h1><p className="mt-1 text-sm text-slate-500">查看成功操作；日期以臺灣時間顯示。每頁 50 筆，預設最近 30 天。</p></div><a href="/admin" className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-700">返回管理後台</a></div>
    <form onSubmit={event => { event.preventDefault(); setCursor(null); setHistory([]); setQuery({ ...form }); }} className="grid grid-cols-2 gap-3 rounded-2xl border border-slate-200 bg-white p-4 lg:grid-cols-6">
      <label className="col-span-2 space-y-1 text-xs font-bold text-slate-600 lg:col-span-2">搜尋<input className={inputClass} value={form.q} maxLength={128} placeholder="工作人員 Email、領域或操作內容" onChange={e => setForm({ ...form, q: e.target.value })} /></label>
      <label className="space-y-1 text-xs font-bold text-slate-600">操作類型<select className={inputClass} value={form.action} onChange={e => setForm({ ...form, action: e.target.value })}><option value="">全部操作</option>{Object.entries(auditActionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="space-y-1 text-xs font-bold text-slate-600">人員角色<select className={inputClass} value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}><option value="">全部角色</option><option value="admin">管理員</option><option value="stage">抽籤人員</option></select></label>
      <label className="space-y-1 text-xs font-bold text-slate-600">開始日期<input type="date" required className={inputClass} value={form.from} onChange={e => setForm({ ...form, from: e.target.value })} /></label>
      <label className="space-y-1 text-xs font-bold text-slate-600">結束日期<input type="date" required className={inputClass} value={form.to} min={form.from} onChange={e => setForm({ ...form, to: e.target.value })} /></label>
      <div className="col-span-2 flex flex-wrap justify-end gap-2 lg:col-span-6"><button type="button" disabled={loading} onClick={() => { setCursor(null); setHistory([]); setRevision(r => r + 1); }} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold disabled:opacity-50">重新載入</button><button type="submit" className="flex items-center gap-2 rounded-xl bg-blue-700 px-5 py-2 text-sm font-bold text-white"><Search size={16} />搜尋／篩選</button></div>
    </form>
    {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>}
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
      <table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-slate-50 text-slate-600"><tr>{['時間','工作人員','角色','操作','範圍與內容'].map(label => <th key={label} className="px-4 py-3 font-bold">{label}</th>)}</tr></thead><tbody>
        {loading ? <tr><td colSpan={5} className="p-8 text-center text-slate-500"><LoaderCircle className="mr-2 inline animate-spin" size={18} />正在載入紀錄…</td></tr> : !records.length ? <tr><td colSpan={5} className="p-8 text-center text-slate-500">{error ? '無法取得紀錄，請重新載入。' : '目前篩選條件沒有紀錄。'}</td></tr> : records.map(row => <tr key={row.id} className="border-t border-slate-100"><td className="whitespace-nowrap px-4 py-4 tabular-nums">{new Date(row.occurred_at).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false })}</td><td className="px-4 py-4 break-all">{row.actor_email}</td><td className="whitespace-nowrap px-4 py-4">{row.actor_role === 'admin' ? '管理員' : '抽籤人員'}</td><td className="whitespace-nowrap px-4 py-4 font-bold">{auditActionLabels[row.action]}</td><td className="max-w-md px-4 py-4"><p>{row.details.fields?.join('、') || row.details.summary || '—'}</p>{row.details.project_count !== undefined && <p className="mt-1 text-xs text-slate-500">共 {row.details.project_count} 件專題{row.details.version !== undefined && ` · 資料版本 ${row.details.version}`}</p>}</td></tr>)}
      </tbody></table>
    </div>
    <div className="flex items-center justify-between text-sm"><span className="text-slate-500">第 {history.length + 1} 頁 · 本頁 {records.length} 筆</span><div className="flex gap-2"><button type="button" disabled={loading || !history.length} onClick={() => { setCursor(history[history.length - 1]); setHistory(history.slice(0,-1)); }} className="rounded-xl border border-slate-300 bg-white px-4 py-2 disabled:opacity-40">上一頁</button><button type="button" disabled={loading || !next} onClick={() => { setHistory([...history, cursor]); setCursor(next); }} className="rounded-xl border border-slate-300 bg-white px-4 py-2 disabled:opacity-40">下一頁</button></div></div>
  </section>;
}
