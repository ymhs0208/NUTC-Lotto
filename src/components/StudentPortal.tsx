import React, { useState, useEffect, useRef } from 'react';
import { ApiRequestError, isRequestCancelled } from '../lib/api';
import { useApiRequest } from '../lib/useApiRequest';
import { hasStudentSessionHint, rememberStudentSessionHint, clearStudentSessionHint } from '../lib/studentSessionHint';
import { ProjectItem } from '../types';
import { formatSessionLabel } from '../lib/sessionLabel';
import {
  UserCheck,
  Clock,
  AlertCircle,
  RefreshCw,
  ChevronRight,
  FileText,
  User,
  Lock,
  Eye,
  EyeOff,
  LogIn,
  LogOut,
  LoaderCircle,
} from 'lucide-react';

export const StudentPortal: React.FC = () => {
  const request = useApiRequest();
  const [studentIdInput, setStudentIdInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [myProject, setMyProject] = useState<ProjectItem | null>(null);
  const [sharedPasswordMode, setSharedPasswordMode] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [isCheckingSession, setIsCheckingSession] = useState(hasStudentSessionHint);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingAction, setLoadingAction] = useState<'login' | 'refresh' | 'logout' | null>(null);
  const requestEpoch = useRef(0);
  const sessionController = useRef<AbortController | null>(null);

  const onRefresh = async () => {
    if (isLoading) return;
    sessionController.current?.abort();
    requestEpoch.current++;
    setIsLoading(true);
    setLoadingAction('refresh');
    try {
      const data = await request<{ project: ProjectItem; sharedPasswordMode: boolean }>('/api/student/me');
      setMyProject(data.project);
      setLastUpdatedAt(new Date());
      setSharedPasswordMode(data.sharedPasswordMode);
      setErrorMessage('');
    } catch (error) {
      if (isRequestCancelled(error)) return;
      if (error instanceof ApiRequestError && error.status === 401) {
        clearStudentSessionHint();
        setMyProject(null);
        setSharedPasswordMode(false);
        setLastUpdatedAt(null);
      }
      setErrorMessage(error instanceof Error ? error.message : '查詢失敗');
    } finally { setIsLoading(false); setLoadingAction(null); }
  };
  useEffect(() => {
    let cancelled = false;
    const epoch = requestEpoch.current;
    const controller = new AbortController();
    sessionController.current = controller;
    request<{ project: ProjectItem; sharedPasswordMode: boolean }>('/api/student/me', undefined, { signal: controller.signal, timeoutMs: 10000 })
      .then(data => { if (!cancelled && requestEpoch.current === epoch) { if (!hasStudentSessionHint()) rememberStudentSessionHint(); setMyProject(data.project); setLastUpdatedAt(new Date()); setSharedPasswordMode(data.sharedPasswordMode); } })
      .catch(error => {
        if (!cancelled && !isRequestCancelled(error) && requestEpoch.current === epoch) {
          if (error instanceof ApiRequestError && error.status === 401) clearStudentSessionHint();
          else setErrorMessage(error instanceof Error ? error.message : '確認登入狀態失敗，請稍後再試。');
        }
      })
      .finally(() => {
        if (!cancelled) setIsCheckingSession(false);
      });
    return () => { cancelled = true; controller.abort(); };
  }, [request]);
  const handleLogout = async () => {
    if (isLoading) return;
    sessionController.current?.abort();
    requestEpoch.current++;
    setIsLoading(true);
    setLoadingAction('logout');
    try {
      await request('/api/student/logout', {});
      clearStudentSessionHint();
      setMyProject(null);
      setSharedPasswordMode(false);
      setStudentIdInput('');
      setPasswordInput('');
      setErrorMessage('');
    } catch (error) { if (!isRequestCancelled(error)) setErrorMessage(error instanceof Error ? error.message : '登出失敗'); }
    finally { setIsLoading(false); setLoadingAction(null); }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;
    setErrorMessage('');
    const query = studentIdInput.trim();
    const pwd = passwordInput;

    if (!query) {
      setErrorMessage('請輸入組長學號');
      return;
    }

    if (!pwd) {
      setErrorMessage('請輸入大會提供的組長登入密碼');
      return;
    }

    sessionController.current?.abort();
    requestEpoch.current++;
    setIsLoading(true);
    setLoadingAction('login');
    try {
      const data = await request<{ project: ProjectItem; sharedPasswordMode: boolean }>('/api/student/verify', { leaderId: query, password: pwd });
      rememberStudentSessionHint();
      setMyProject(data.project);
      setLastUpdatedAt(new Date());
      setSharedPasswordMode(data.sharedPasswordMode);
      setPasswordInput('');
    } catch (error) {
      if (!isRequestCancelled(error)) setErrorMessage(error instanceof Error ? error.message : '登入失敗');
    } finally { setIsLoading(false); setLoadingAction(null); }
  };

  return (
    <div className="min-h-[calc(100vh-5rem)] bg-gradient-to-b from-blue-50/70 via-white to-slate-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-6 sm:space-y-8">
        <header className="relative overflow-hidden rounded-[2rem] border border-blue-100 bg-white px-6 py-7 sm:px-9 sm:py-9 shadow-sm">
          <div className="absolute -right-12 -top-20 h-56 w-56 rounded-full bg-blue-100/70 blur-2xl pointer-events-none" />
          <div className="absolute right-36 bottom-0 h-28 w-28 rounded-full bg-amber-100/70 blur-2xl pointer-events-none" />
          <div className="relative flex items-start gap-4 sm:gap-6">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-slate-100 bg-white p-1.5 shadow-sm sm:h-16 sm:w-16 sm:rounded-2xl sm:p-2">
              <img width={64} height={64} src="/college-logo-64.webp" srcSet="/college-logo-64.webp 1x, /college-logo-128.webp 2x" alt="國立臺中科技大學 資訊與流通學院" className="max-h-full max-w-full object-contain" />
            </div>
            <div className="min-w-0">
              <p className="text-xs sm:text-sm font-semibold text-blue-700">國立臺中科技大學 · 資訊與流通學院</p>
              <h1 className="mt-2 text-2xl sm:text-4xl font-black tracking-tight text-slate-900">專題報告場次查詢</h1>
              <p className="mt-2 max-w-2xl text-sm sm:text-base leading-relaxed text-slate-600">登入後即可查看您的專題名稱與抽籤後編號。</p>
            </div>
          </div>
        </header>

      {isCheckingSession ? (
        <div role="status" className="flex min-h-48 items-center justify-center gap-3 rounded-[1.75rem] border border-slate-200 bg-white p-6 text-sm font-medium text-slate-600 shadow-sm">
          <LoaderCircle className="h-5 w-5 shrink-0 animate-spin text-blue-700 motion-reduce:animate-none" aria-hidden="true" />
          <span>正在確認登入狀態…</span>
        </div>
      ) : !myProject ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-stretch">
          <section className="order-2 rounded-[1.75rem] border border-blue-100 bg-blue-50/80 p-6 sm:p-8 lg:order-1">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-blue-700 shadow-sm"><UserCheck className="h-6 w-6" /></div>
            <h2 className="mt-6 text-xl sm:text-2xl font-black text-slate-900">查詢您的報告資訊</h2>
            <p className="mt-3 text-sm leading-7 text-slate-600">使用組長學號與大會提供的密碼登入，即可確認專題的報告場次與上台順位。</p>
            <div className="mt-7 space-y-4 border-t border-blue-200/70 pt-6">
              <div className="flex gap-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-700 text-xs font-bold text-white">1</span><p className="text-sm leading-7 text-slate-700">輸入<span className="font-bold">組長學號</span>與登入密碼</p></div>
              <div className="flex gap-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-700 text-xs font-bold text-white">2</span><p className="text-sm leading-7 text-slate-700">查看抽籤後編號</p></div>
            </div>
          </section>

          <section className="order-1 rounded-[1.75rem] border border-slate-200 bg-white p-6 sm:p-8 shadow-sm lg:order-2" aria-labelledby="student-login-title">
            <div className="mb-6 border-b border-slate-100 pb-5">
              <h2 id="student-login-title" className="text-xl sm:text-2xl font-black text-slate-900">組長登入</h2>
              <p className="mt-1 text-sm text-slate-500">請填寫以下資料，查詢您的專題報告順序。</p>
            </div>
            <form onSubmit={handleLogin} className="space-y-5">
              <div>
                <label htmlFor="student-leader-id" className="mb-2 block text-sm font-bold text-slate-700">組長學號</label>
                <div className="relative">
                  <User className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                  <input id="student-leader-id" type="text" value={studentIdInput} onChange={(e) => setStudentIdInput(e.target.value)} placeholder="請輸入組長學號" className="w-full rounded-xl border border-slate-300 bg-white py-3.5 pl-12 pr-4 text-base text-slate-900 placeholder-slate-400 outline-none transition focus:border-blue-600 focus:ring-4 focus:ring-blue-100" autoComplete="username" />
                </div>
              </div>
              <div>
                <label htmlFor="student-password" className="mb-2 block text-sm font-bold text-slate-700">登入密碼</label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                  <input id="student-password" type={showPassword ? 'text' : 'password'} value={passwordInput} onChange={(e) => setPasswordInput(e.target.value)} placeholder="請輸入大會提供的密碼" className="w-full rounded-xl border border-slate-300 bg-white py-3.5 pl-12 pr-12 text-base text-slate-900 placeholder-slate-400 outline-none transition focus:border-blue-600 focus:ring-4 focus:ring-blue-100" autoComplete="current-password" />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800" aria-label={showPassword ? '隱藏密碼' : '顯示密碼'}>{showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}</button>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-slate-500">登入密碼請依大會公告為準。</p>
              </div>
              {errorMessage && <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-sm text-rose-700"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{errorMessage}</span></div>}
              <button type="submit" disabled={isLoading} className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-700 px-5 py-3.5 text-base font-bold text-white shadow-sm transition hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-wait disabled:opacity-60">
                {loadingAction === 'login' ? <LoaderCircle className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <LogIn className="h-5 w-5" />}
                <span>{loadingAction === 'login' ? '查詢中…' : '登入並查詢順序'}</span>
                {loadingAction !== 'login' && <ChevronRight className="h-5 w-5" />}
              </button>
            </form>
          </section>
        </div>
      ) : (
        /* Logged In View */
        <div className="space-y-5 sm:space-y-6">
          {/* Top Status Bar */}
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-[1.5rem] border border-slate-200 bg-white p-4 sm:p-5 shadow-sm">
            <div className="flex items-center gap-2.5 sm:gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-blue-100 bg-blue-50 text-blue-700">
                <User className="h-5 w-5" />
              </div>
              <div>
                <div className="text-xs text-slate-500">目前登入的組長學號（末四碼）</div>
                <div className="text-base font-bold text-slate-900 font-mono">
                  {myProject.leader_id ? `••••${myProject.leader_id.slice(-4)}` : '—'}
                </div>
              </div>
            </div>

            <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:items-center">
              <button
                onClick={onRefresh}
                disabled={isLoading}
                className="inline-flex w-full min-w-0 items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-2 py-2.5 text-[13px] font-bold text-blue-800 transition hover:bg-blue-100 disabled:opacity-60 sm:w-auto sm:px-3.5 sm:text-sm"
                title="重新整理以同步最新抽籤結果"
              >
                <RefreshCw className={`h-4 w-4 ${loadingAction === 'refresh' ? 'animate-spin motion-reduce:animate-none' : ''}`} />
                {loadingAction === 'refresh' ? '更新中…' : '更新結果'}
              </button>
              <button
                onClick={handleLogout}
                disabled={isLoading}
                className="inline-flex w-full min-w-0 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-2 py-2.5 text-[13px] font-semibold text-slate-600 transition hover:bg-slate-50 hover:text-slate-900 disabled:opacity-60 sm:w-auto sm:px-3.5 sm:text-sm"
              >
                {loadingAction === 'logout'
                  ? <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                  : <LogOut className="h-4 w-4" aria-hidden="true" />}
                {loadingAction === 'logout' ? '登出中…' : '登出'}
              </button>
            </div>
          </div>

          {errorMessage && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{errorMessage}<p className="mt-1">目前顯示上次成功取得的結果，請稍後按「更新結果」。</p></div>}
          {lastUpdatedAt && <p className="px-1 text-xs text-slate-500">最後成功更新：{lastUpdatedAt.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</p>}

          {/* Main Showcase Card */}
          <div className="rounded-[1.75rem] border border-slate-200 bg-white p-5 sm:p-8 shadow-sm">
            {myProject.draw_order ? (
              <div className="space-y-6">
                {/* Project Header Info */}
                <div className="flex flex-col gap-4 border-b border-slate-100 pb-6 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 space-y-3">
                    <p className="flex items-center gap-2 text-sm font-bold text-slate-500"><FileText className="h-4 w-4" />專題名稱</p>
                    <h2 className="break-words text-xl font-black leading-snug text-slate-900 sm:text-3xl">
                      {myProject.project_title}
                    </h2>
                  </div>

                  {!sharedPasswordMode &&
                  <div className="shrink-0 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 sm:text-right">
                    <div className="text-xs text-slate-500">現場抽籤時間</div>
                    <div className="mt-1 text-sm font-medium text-slate-800">
                      {myProject.draw_time
                        ? new Date(myProject.draw_time).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                        : '現場即時同步'}
                    </div>
                  </div>}
                </div>

                <dl aria-label="專題抽籤結果" className="space-y-4">
                  <div className="grid grid-cols-2 gap-3 sm:gap-5">
                    <div className="flex min-w-0 flex-col rounded-2xl bg-blue-50 px-3 py-3 text-center sm:px-5">
                      <dt className="text-sm font-bold text-blue-700">報告場次</dt>
                      <dd className="mt-1 flex items-center justify-center text-blue-950">
                        <strong className="break-words text-2xl font-black leading-9 [-webkit-text-stroke:0.3px] sm:text-[28px]">{myProject.assigned_group ? formatSessionLabel(myProject.assigned_group) : '場次尚未提供'}</strong>
                      </dd>
                    </div>
                    <div className="flex min-w-0 flex-col rounded-2xl bg-blue-50 px-3 py-3 text-center sm:px-5">
                      <dt className="text-sm font-bold text-blue-700">抽籤編號</dt>
                      <dd className="mt-1 flex items-center justify-center text-blue-950">
                        <strong className={`break-words font-black tracking-tight ${myProject.draw_code ? 'font-mono text-[32px] leading-9 sm:text-[36px]' : 'text-lg leading-snug sm:text-xl'}`}>{myProject.draw_code || '編號尚未提供'}</strong>
                      </dd>
                    </div>
                  </div>
                  <div className="min-w-0 rounded-2xl bg-slate-100 p-4 sm:p-6">
                    <dt className="text-sm font-bold text-slate-600 sm:text-base">領域名稱</dt>
                    <dd className="mt-2 break-words text-lg font-bold leading-relaxed text-slate-800 sm:text-2xl">
                      {myProject.field}
                    </dd>
                  </div>
                </dl>
                {!sharedPasswordMode && !!myProject.evaluators?.length && <p className="text-sm text-slate-600 px-1">
                  評審委員：{myProject.evaluators.join('、')}
                </p>}
              </div>
            ) : (
              /* Undrawn Waiting State */
              <div className="space-y-6">
                <div className="flex flex-col gap-4 border-b border-slate-100 pb-6 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 space-y-3">
                    <p className="flex items-center gap-2 text-sm font-bold text-slate-500"><FileText className="h-4 w-4" aria-hidden="true" />專題名稱</p>
                    <h2 className="break-words text-xl font-black leading-snug text-slate-900 sm:text-3xl">{myProject.project_title}</h2>
                    {!sharedPasswordMode && <p className="text-sm text-slate-600">所屬領域：{myProject.field}</p>}
                  </div>
                </div>

                <section className="rounded-2xl border border-amber-200 bg-amber-50/70 p-5 sm:p-6" aria-labelledby="student-waiting-title">
                  <div className="flex items-start gap-3 sm:gap-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-100 bg-white text-amber-700 sm:h-12 sm:w-12">
                      <Clock className="h-5 w-5 sm:h-6 sm:w-6" aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <h3 id="student-waiting-title" className="text-base font-bold text-slate-900 sm:text-lg">等待現場抽籤</h3>
                      <p className="mt-1.5 text-sm leading-relaxed text-slate-700">您的專題已登記，抽籤編號尚未公布。</p>
                      <p className="mt-2 text-sm leading-relaxed text-slate-600">抽籤完成後，請按上方「更新結果」查看抽籤編號、領域與報告場次。</p>
                    </div>
                  </div>
                </section>
              </div>
            )}
          </div>

          {/* Presentation Notes */}
          <aside className="rounded-[1.5rem] border border-slate-200 bg-white p-5 sm:p-6 text-sm text-slate-600 shadow-sm">
            <h3 className="flex items-center gap-2 font-bold text-slate-900">
              <FileText className="h-5 w-5 text-blue-700" />
              成果簡報(所有參賽組別)：
            </h3>
            <ul className="mt-3 list-disc space-y-2 pl-5 leading-relaxed">
              <li>日間部簡報時間為115年11月26日(四)全天09:00至17:00。</li>
              <li>進修部簡報時間為115年11月26日(四)晚間18:00至21:00。</li>
            </ul>
          </aside>
        </div>
      )}
      </div>
    </div>
  );
};
