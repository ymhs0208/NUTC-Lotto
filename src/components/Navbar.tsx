import React, { useEffect, useRef, useState } from 'react';
import { AuthSession } from '../lib/auth';
import { UserRound, ShieldCheck, ChevronDown, LogOut, LoaderCircle, ClipboardList, LayoutDashboard, LayoutGrid, Presentation } from 'lucide-react';

interface NavbarProps {
  authSession?: AuthSession | null;
  onLogout?: () => Promise<void>;
}

export const Navbar: React.FC<NavbarProps> = ({ authSession, onLogout }) => {
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const menuRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) menuRef.current.open = false;
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && menuRef.current?.open) {
        menuRef.current.open = false;
        menuRef.current.querySelector('summary')?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);
  const handleLogout = async () => {
    if (!onLogout || isLoggingOut) return;
    setIsLoggingOut(true);
    try { await onLogout(); }
    finally { setIsLoggingOut(false); }
  };

  const isAdmin = authSession?.role === 'admin';
  const canOpenStage = isAdmin || authSession?.role === 'stage';
  const roleLabel = isAdmin ? '大會系統管理員' : '台上抽籤人員';

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 shadow-[0_3px_16px_rgba(15,23,42,0.04)] backdrop-blur-xl">
      <div className="flex h-0.5" aria-hidden="true">
        <span className="flex-[2] bg-[#365b92]" />
        <span className="flex-1 bg-[#4b8a42]" />
        <span className="flex-[2] bg-[#b3487d]" />
      </div>
      <div className="mx-auto flex min-h-14 max-w-7xl items-center justify-between gap-3 px-4 py-1.5 sm:min-h-16 sm:px-6 lg:px-8">
        <a href="/" className="group flex min-w-0 items-center gap-2.5 rounded-lg sm:gap-3 focus-visible:outline-2 focus-visible:outline-blue-600" aria-label="返回專題報告場次查詢首頁">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center p-1 sm:h-11 sm:w-11">
            <img
              width={64} height={64} src="/college-logo-64.webp" srcSet="/college-logo-64.webp 1x, /college-logo-128.webp 2x"
              alt=""
              className="max-h-full max-w-full object-contain"
              loading="eager"
            />
          </div>
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-x-1.5 text-[10px] font-medium leading-tight text-slate-500 sm:text-[11px]">
              <span>國立臺中科技大學</span>
              <span className="text-[#356a32]">・資訊與流通學院</span>
            </p>
            <p className="mt-0.5 text-lg font-bold leading-tight tracking-wide text-[#28518a] transition-colors group-hover:text-[#234574] sm:text-xl">專題成果展</p>
            <p className="mt-0.5 text-[11px] font-medium leading-tight tracking-[0.16em] text-[#93466e] sm:text-xs">報告抽籤系統</p>
          </div>
        </a>

        {authSession && onLogout && (
          <details ref={menuRef} className="group relative shrink-0">
            <summary
              aria-label={`目前登入：${roleLabel}，開啟帳號選單`}
              title="帳號選單"
              className="flex h-11 list-none items-center gap-2.5 rounded-lg border border-slate-200 bg-white px-2 text-slate-700 transition-colors hover:bg-slate-50 group-open:border-slate-300 group-open:bg-slate-50 sm:px-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 cursor-pointer [&::-webkit-details-marker]:hidden"
            >
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${isAdmin ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                <UserRound className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="hidden text-sm font-semibold sm:block">{isAdmin ? '系統管理員' : '抽籤人員'}</span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
            </summary>
            <div className="absolute right-0 top-full z-50 mt-2 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[0_12px_36px_rgba(15,23,42,0.12)]">
              <div className="p-4">
                <div className="flex items-start gap-3">
                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${isAdmin ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                    {isAdmin ? <ShieldCheck className="h-5 w-5" aria-hidden="true" /> : <UserRound className="h-5 w-5" aria-hidden="true" />}
                  </span>
                  <div className="min-w-0 pt-0.5">
                    <p className="text-sm font-semibold leading-5 text-slate-900">{roleLabel}</p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      <span className="min-w-0 break-all">{authSession.username}</span>
                    </p>
                  </div>
                </div>
              </div>
              <div className="border-t border-slate-100 p-3">
                {canOpenStage && <nav aria-label="工作人員功能" className="space-y-2">
                  <div className={`grid gap-2 ${isAdmin ? 'grid-cols-2' : 'grid-cols-1'}`}>
                    <a href="/stage" className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600">
                      <Presentation className="h-5 w-5 shrink-0 text-amber-700" aria-hidden="true" />
                      <span className="whitespace-nowrap">台上抽籤</span>
                    </a>
                    {isAdmin && <a href="/admin" className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600">
                      <LayoutDashboard className="h-5 w-5 shrink-0 text-emerald-700" aria-hidden="true" />
                      <span className="whitespace-nowrap">管理後台</span>
                    </a>}
                  </div>
                  <div className={`grid gap-2 ${isAdmin ? 'grid-cols-2' : 'grid-cols-1'}`}>
                    <a href="/results" className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
                      <LayoutGrid className="h-5 w-5 shrink-0 text-blue-700" aria-hidden="true" />
                      <span className="whitespace-nowrap">各領域結果</span>
                    </a>
                    {isAdmin && <a href="/audit" className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
                      <ClipboardList className="h-5 w-5 shrink-0 text-blue-700" aria-hidden="true" />
                      <span className="whitespace-nowrap">操作紀錄</span>
                    </a>}
                  </div>
                </nav>}
                <div className={canOpenStage ? 'mt-3 border-t border-slate-200 pt-3' : ''}>
                  <button
                    onClick={() => void handleLogout()}
                    disabled={isLoggingOut}
                    type="button"
                    className="flex min-h-11 w-full items-center gap-3 rounded-lg border border-transparent bg-white px-3 py-2.5 text-left text-sm font-semibold text-rose-700 transition-colors hover:bg-rose-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600 disabled:cursor-wait disabled:opacity-50 cursor-pointer"
                  >
                    {isLoggingOut ? <LoaderCircle className="h-5 w-5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <LogOut className="h-5 w-5 shrink-0" aria-hidden="true" />}
                    <span>{isLoggingOut ? '登出中…' : isAdmin ? '登出後台' : '登出'}</span>
                  </button>
                </div>
              </div>
            </div>
          </details>
        )}
      </div>
    </header>
  );
};
