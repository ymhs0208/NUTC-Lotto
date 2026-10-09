import React, { useState } from 'react';
import { useApiRequest } from '../lib/useApiRequest';
import { isApiRequestCancelled } from '../lib/api';
type Account = { id: string; email: string; role: 'admin' | 'stage'; disabled: number };
export function StaffAccounts() {
  const request = useApiRequest();
  const [open, setOpen] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'stage'>('stage');
  const [password, setPassword] = useState('');
  const [disabled, setDisabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const load = async () => {
    setBusy(true); setMessage('');
    try { setAccounts((await request<{ accounts: Account[] }>('/api/staff-accounts')).accounts); }
    catch (error) { if (!isApiRequestCancelled(error)) setMessage(error instanceof Error ? error.message : '無法載入帳號。'); }
    finally { setBusy(false); }
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (busy) return;
    setBusy(true); setMessage('');
    try {
      await request('/api/staff-accounts', { email, role, disabled, ...(password ? { password } : {}) });
      setPassword(''); setMessage('帳號已儲存；該帳號需重新登入。');
      setAccounts((await request<{ accounts: Account[] }>('/api/staff-accounts')).accounts);
    } catch (error) { if (!isApiRequestCancelled(error)) setMessage(error instanceof Error ? error.message : '儲存失敗。'); }
    finally { setBusy(false); }
  };
  const fieldClass = 'w-full rounded-xl border border-slate-300 px-3 py-2 text-sm';
  return <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
    <button type="button" aria-expanded={open} onClick={() => { setOpen(!open); if (!open) void load(); }} className="flex w-full items-center justify-between text-left font-bold text-slate-900">
      <span>工作人員帳號管理</span><span aria-hidden="true">{open ? '−' : '＋'}</span>
    </button>
    {open && <div className="mt-5 space-y-5">
      <p className="text-sm text-slate-500">新增帳號或選擇既有帳號修改。新密碼須至少 8 字元；修改角色、密碼或停用後，該帳號的既有登入會失效。</p>
      {message && <p role="status" className="rounded-xl bg-slate-100 p-3 text-sm">{message}</p>}
      <ul className="divide-y divide-slate-100">{accounts.map(account => <li key={account.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
        <span className="break-all">{account.email} · {account.role === 'admin' ? '管理員' : '抽籤人員'}{account.disabled ? ' · 已停用' : ''}</span>
        <button type="button" disabled={busy} onClick={() => { setEmail(account.email); setRole(account.role); setDisabled(!!account.disabled); setPassword(''); setMessage(''); }} className="rounded-lg border border-slate-300 px-3 py-2 disabled:opacity-50">編輯</button>
      </li>)}</ul>
      <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1 text-sm font-semibold">Email<input required type="email" maxLength={256} value={email} onChange={e => setEmail(e.target.value)} autoComplete="off" className={fieldClass} /></label>
        <label className="space-y-1 text-sm font-semibold">角色<select value={role} onChange={e => setRole(e.target.value as 'admin' | 'stage')} className={fieldClass}><option value="stage">抽籤人員</option><option value="admin">管理員</option></select></label>
        <label className="space-y-1 text-sm font-semibold">新密碼<input type="password" minLength={8} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" placeholder="既有帳號可留空保留密碼" className={fieldClass} /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={disabled} onChange={e => setDisabled(e.target.checked)} />停用此帳號</label>
        <div className="flex gap-2 sm:col-span-2"><button disabled={busy} type="submit" className="rounded-xl bg-blue-700 px-5 py-2 text-sm font-bold text-white disabled:opacity-50">{busy ? '處理中…' : '儲存帳號'}</button><button disabled={busy} type="button" onClick={() => { setEmail(''); setPassword(''); setRole('stage'); setDisabled(false); setMessage(''); }} className="rounded-xl border border-slate-300 px-4 py-2 text-sm">清空表單</button></div>
      </form>
    </div>}
  </section>;
}
