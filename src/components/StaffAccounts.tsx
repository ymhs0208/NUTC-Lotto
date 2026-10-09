import React, { useState, useEffect, useRef } from 'react';
import { CheckCircle2, Eye, EyeOff, LoaderCircle, Search, ShieldCheck, Users, UserRound, Pencil, RefreshCw } from 'lucide-react';
import { useApiRequest } from '../lib/useApiRequest';
import { isApiRequestCancelled } from '../lib/api';
import { getAuthSession } from '../lib/auth';

type Account = { id: string; email: string; role: 'admin' | 'stage'; disabled: number };
const roleLabel = (role: Account['role']) => role === 'admin' ? '管理員' : '抽籤人員';
const inputClass = 'min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-600 focus:ring-3 focus:ring-blue-100 disabled:bg-slate-50 disabled:text-slate-500';
const buttonClass = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-wait disabled:opacity-50';

export function StaffAccounts() {
  const request = useApiRequest();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [editing, setEditing] = useState<Account | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Account['role']>('stage');
  const [password, setPassword] = useState('');
  const [disabled, setDisabled] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const formRef = useRef<HTMLFormElement>(null);
  const currentEmail = getAuthSession()?.username.toLowerCase();
  const busy = loading || saving;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setLoadError('');
    request<{ accounts: Account[] }>('/api/staff-accounts', undefined, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setAccounts(data.accounts); })
      .catch(error => { if (!controller.signal.aborted && !isApiRequestCancelled(error)) setLoadError(error instanceof Error ? error.message : '無法載入帳號。'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [request, revision]);

  const resetForm = () => {
    setEditing(null); setEmail(''); setRole('stage'); setPassword(''); setDisabled(false); setShowPassword(false);
  };
  const openForm = (account: Account | null) => {
    resetForm(); setNotice(null);
    if (account) { setEditing(account); setEmail(account.email); setRole(account.role); setDisabled(!!account.disabled); }
    requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'nearest' });
      formRef.current?.querySelector<HTMLElement>(account ? 'select' : 'input')?.focus({ preventScroll: true });
    });
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (busy || loadError) return;
    const normalizedEmail = email.trim().toLowerCase();
    if (!editing && accounts.some(account => account.email.toLowerCase() === normalizedEmail)) {
      setNotice({ text: '這個 Email 已有帳號，請從列表選擇「編輯」。', error: true }); return;
    }
    if ((!editing || password) && password.trim().length < 8) {
      setNotice({ text: '密碼須至少 8 字元。', error: true }); return;
    }
    setSaving(true); setNotice(null);
    try {
      await request('/api/staff-accounts', { email: normalizedEmail, role, disabled, ...(password ? { password } : {}) });
      const text = editing ? '帳號已更新；角色、密碼或狀態變更後，該人員需重新登入。' : '帳號已新增，可以使用設定的 Email 與密碼登入。';
      resetForm(); setNotice({ text, error: false }); setRevision(value => value + 1);
    } catch (error) { if (!isApiRequestCancelled(error)) setNotice({ text: error instanceof Error ? error.message : '儲存失敗，請稍後再試。', error: true }); }
    finally { setSaving(false); }
  };
  const visibleAccounts = accounts.filter(account => account.email.toLowerCase().includes(search.trim().toLowerCase()) &&
    (filter === 'all' || filter === 'disabled' && !!account.disabled || filter === 'active' && !account.disabled || filter === account.role));
  const stats = [
    { label: '全部帳號', value: accounts.length, icon: Users },
    { label: '啟用管理員', value: accounts.filter(a => a.role === 'admin' && !a.disabled).length, icon: ShieldCheck },
    { label: '啟用抽籤人員', value: accounts.filter(a => a.role === 'stage' && !a.disabled).length, icon: UserRound },
  ];

  return <section className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">工作人員帳號管理</h1>
        <p className="mt-2 text-sm text-slate-500">管理大會人員的登入帳號、角色與使用狀態。</p>
      </div>
    </div>
    <div className="grid grid-cols-3 gap-2 sm:gap-4">{stats.map(({ label, value, icon: Icon }) => <div key={label} className="rounded-2xl border border-slate-200 bg-white p-3 sm:p-5"><Icon className="mb-3 h-5 w-5 text-blue-700" aria-hidden="true" /><p className="text-xs font-medium text-slate-500 sm:text-sm">{label}</p><p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{loading || loadError ? '—' : value}</p></div>)}</div>
    {notice && <div role={notice.error ? 'alert' : 'status'} className={`flex items-start gap-2 rounded-xl border p-4 text-sm ${notice.error ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>{!notice.error && <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden="true" />}{notice.text}</div>}
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_23rem]">
      <section aria-labelledby="accounts-list-title" className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="space-y-4 border-b border-slate-100 p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3"><h2 id="accounts-list-title" className="font-bold text-slate-900">帳號列表</h2><button type="button" disabled={busy} onClick={() => setRevision(value => value + 1)} className={buttonClass}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />重新載入</button></div>
          <div className="flex flex-col gap-3 sm:flex-row"><label className="relative flex-1"><span className="sr-only">搜尋 Email</span><Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400" aria-hidden="true" /><input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="搜尋 Email" className={`${inputClass} pl-9`} /></label><label><span className="sr-only">篩選帳號</span><select value={filter} onChange={e => setFilter(e.target.value)} className={inputClass}><option value="all">全部帳號</option><option value="admin">管理員</option><option value="stage">抽籤人員</option><option value="active">啟用中</option><option value="disabled">已停用</option></select></label></div>
        </div>
        {loading ? <p role="status" className="flex items-center justify-center gap-2 p-10 text-sm text-slate-500"><LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />正在載入帳號…</p> : loadError ? <p role="alert" className="p-6 text-sm text-rose-700">{loadError} 請點選「重新載入」再試。</p> : <>
          <ul className="divide-y divide-slate-100">{visibleAccounts.map(account => <li key={account.id} className={`flex items-center gap-3 p-4 sm:p-5 ${editing?.id === account.id ? 'bg-blue-50/70' : ''}`}>
            <span className={`hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl sm:flex ${account.role === 'admin' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}`}>{account.role === 'admin' ? <ShieldCheck className="h-5 w-5" aria-hidden="true" /> : <UserRound className="h-5 w-5" aria-hidden="true" />}</span>
            <div className="min-w-0 flex-1"><p className="break-all text-sm font-semibold text-slate-900">{account.email}</p><div className="mt-2 flex flex-wrap items-center gap-2 text-xs"><span className="rounded-md bg-slate-100 px-2 py-1 text-slate-600">{roleLabel(account.role)}</span><span className={`rounded-md px-2 py-1 ${account.disabled ? 'bg-slate-100 text-slate-500' : 'bg-emerald-50 text-emerald-700'}`}>{account.disabled ? '已停用' : '啟用中'}</span>{account.email.toLowerCase() === currentEmail && <span className="text-blue-700">目前登入</span>}</div></div>
            <button type="button" disabled={busy} onClick={() => openForm(account)} aria-label={`編輯 ${account.email}`} className={`${buttonClass} shrink-0 px-3`}><Pencil className="h-4 w-4" aria-hidden="true" /><span>編輯</span></button>
          </li>)}</ul>
          {!visibleAccounts.length && <p className="px-5 py-10 text-center text-sm text-slate-500">{accounts.length ? '找不到符合條件的帳號，請調整搜尋或篩選。' : '目前尚無工作人員帳號。'}</p>}
          <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">顯示 {visibleAccounts.length} 個，共 {accounts.length} 個帳號</p>
        </>}
      </section>
      <form ref={formRef} onSubmit={save} aria-labelledby="account-form-title" className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <div><h2 id="account-form-title" className="text-lg font-bold text-slate-900">{editing ? '編輯帳號' : '新增帳號'}</h2><p className="mt-1 text-xs leading-5 text-slate-500">{editing ? '調整角色、登入密碼與帳號狀態。' : '為工作人員建立專屬的登入帳號。'}</p></div>
        <fieldset disabled={busy || !!loadError} className="space-y-4 disabled:opacity-60">
          <label className="block space-y-2 text-sm font-semibold text-slate-700">Email<input required type="email" readOnly={!!editing} maxLength={256} value={email} onChange={e => setEmail(e.target.value)} autoComplete="off" placeholder="name@example.edu.tw" className={`${inputClass} ${editing ? 'bg-slate-50' : ''}`} />{editing && <span className="block text-xs font-normal text-slate-500">帳號 Email 為登入識別，無法在此修改。</span>}</label>
          <label className="block space-y-2 text-sm font-semibold text-slate-700">角色<select value={role} onChange={e => setRole(e.target.value as Account['role'])} className={inputClass}><option value="stage">抽籤人員</option><option value="admin">管理員</option></select></label>
          <p className="rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600">{role === 'admin' ? '管理員可管理名冊、評審、工作人員帳號，並執行抽籤與查看操作紀錄。' : '抽籤人員可執行抽籤與重設結果。'}</p>
          <div className="space-y-2 text-sm font-semibold text-slate-700"><label htmlFor="staff-password">{editing ? '新密碼' : '登入密碼'}</label><span className="relative block"><input id="staff-password" aria-describedby="staff-password-help" required={!editing} type={showPassword ? 'text' : 'password'} minLength={8} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" placeholder={editing ? '留空保留原密碼' : '至少 8 字元'} className={`${inputClass} pr-12`} /><button type="button" aria-label={showPassword ? '隱藏密碼' : '顯示密碼'} aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)} className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center rounded-xl text-slate-500 hover:text-blue-700 focus-visible:outline-2 focus-visible:outline-blue-600">{showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}</button></span><span id="staff-password-help" className="block text-xs font-normal text-slate-500">密碼長度為 8 至 128 字元。</span></div>
          {editing && <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-3"><input type="checkbox" checked={disabled} onChange={e => setDisabled(e.target.checked)} className="mt-1 h-4 w-4 accent-blue-700" /><span className="text-sm font-semibold text-slate-700">停用此帳號<span className="mt-1 block text-xs font-normal text-slate-500">停用後無法登入，既有登入也會失效。</span></span></label>}
        </fieldset>
        <div className="flex gap-2 border-t border-slate-100 pt-4"><button disabled={busy || !!loadError} type="submit" className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-blue-700 px-4 py-3 text-sm font-bold text-white hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50">{saving && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />}{saving ? '儲存中…' : editing ? '儲存變更' : '建立帳號'}</button>{editing && <button disabled={busy} type="button" onClick={() => openForm(null)} className={buttonClass}>取消</button>}</div>
      </form>
    </div>
  </section>;
}
