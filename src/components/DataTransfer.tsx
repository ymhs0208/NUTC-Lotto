import React, { useRef, useState } from 'react';
import { useApiRequest } from '../lib/useApiRequest';
import { isApiRequestCancelled } from '../lib/api';
export function DataTransfer({ empty }: { empty: boolean }) {
  const request = useApiRequest();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [imported, setImported] = useState(false);
  const download = async () => {
    if (busy) return; setBusy(true); setMessage('');
    try {
      const backup = await request<Record<string, unknown>>('/api/data/export');
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = `lottery-backup-${new Date().toISOString().slice(0, 10)}.json`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage('備份已下載。請妥善保存，檔案包含學生密碼雜湊。');
    } catch (error) { if (!isApiRequestCancelled(error)) setMessage(error instanceof Error ? error.message : '備份失敗。'); }
    finally { setBusy(false); }
  };
  const upload = async (event: React.FormEvent) => {
    event.preventDefault(); const file = input.current?.files?.[0]; if (!file || busy) return;
    if (file.size > 5 * 1024 * 1024) { setMessage('JSON 檔案須小於 5 MB。'); return; }
    setBusy(true); setMessage('');
    try {
      const raw = JSON.parse(await file.text());
      const source = (Array.isArray(raw) ? raw[0]?.backup : raw.backup) || raw;
      const state = typeof source === 'string' ? JSON.parse(source) : source;
      if (!Array.isArray(state?.projects) || !Array.isArray(state?.domainConfigs)) throw new Error('請選擇含有 projects 和 domainConfigs 的備份 JSON。');
      await request('/api/data/import', { projects: state.projects, domainConfigs: state.domainConfigs });
      setImported(true); setMessage('搬移完成。請重新載入查看名冊，並重新設定學生密碼。');
    } catch (error) { if (!isApiRequestCancelled(error)) setMessage(error instanceof Error ? error.message : '搬移失敗。'); }
    finally { setBusy(false); }
  };
  return <details className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
    <summary className="cursor-pointer font-bold text-slate-900">名冊與結果搬移</summary>
    <div className="mt-5 space-y-4 text-sm">
      <p className="text-slate-500">備份包含名冊、領域與抽籤結果。工作人員帳號、登入與操作紀錄須另行保存；搬入時會清除學生密碼，請重新設定。</p>
      {message && <p role="status" className="rounded-xl bg-slate-100 p-3">{message}</p>}
      <button type="button" disabled={busy} onClick={() => void download()} className="rounded-xl border border-slate-300 px-4 py-2 font-semibold disabled:opacity-50">下載名冊與結果備份</button>
      {empty && !imported ? <form onSubmit={upload} className="space-y-3 border-t border-slate-100 pt-4">
        <label className="block font-semibold" htmlFor="lottery-import-file">選擇搬移用 JSON</label>
        <input id="lottery-import-file" ref={input} type="file" accept=".json,application/json" required disabled={busy} className="block w-full text-sm" />
        <p className="text-slate-500">僅能搬入尚未操作的空白系統；所有資料驗證通過後才會儲存。</p>
        <button type="submit" disabled={busy} className="rounded-xl bg-blue-700 px-5 py-2 font-bold text-white disabled:opacity-50">{busy ? '處理中…' : '搬入資料'}</button>
      </form> : imported ? <button type="button" onClick={() => window.location.reload()} className="rounded-xl bg-blue-700 px-5 py-2 font-bold text-white">重新載入名冊</button> : <p className="text-slate-500">目前系統已有資料或操作，無法搬入，以避免覆蓋。</p>}
    </div>
  </details>;
}
