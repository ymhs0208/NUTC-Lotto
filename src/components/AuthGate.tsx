import React, { useState } from 'react';
import { AuthSession, saveAuthSession } from '../lib/auth';
import { isRequestCancelled } from '../lib/api';
import { useApiRequest } from '../lib/useApiRequest';
import {
  Lock,
  User,
  Eye,
  EyeOff,
  LogIn,
  AlertCircle,
} from 'lucide-react';

interface AuthGateProps {
  targetView: 'stage' | 'admin';
  onSuccess: (session: AuthSession) => void;
}

export const AuthGate: React.FC<AuthGateProps> = ({
  targetView,
  onSuccess,
}) => {
  const isStage = targetView === 'stage';
  const request = useApiRequest(targetView);
  const defaultUser = '';

  const [username, setUsername] = useState<string>(defaultUser);
  const [password, setPassword] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [rememberMe, setRememberMe] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    const email = username.trim();
    if (!email) {
      setErrorMessage('請輸入登入 Email。');
      e.currentTarget.querySelector<HTMLInputElement>('#staff-email')?.focus();
      return;
    }
    if (!password.trim()) {
      setErrorMessage('請輸入通行密碼。');
      e.currentTarget.querySelector<HTMLInputElement>('#staff-password')?.focus();
      return;
    }
    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      const data = await request<{ session: AuthSession }>('/api/auth/verify', {
        username: email, password, targetView, remember: rememberMe,
      });
      const session = data.session;
      saveAuthSession(session);
      onSuccess(session);
    } catch (error) {
      if (!isRequestCancelled(error)) setErrorMessage(error instanceof Error ? error.message : '驗證失敗，請稍後再試');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-md mx-auto px-4 py-8 sm:py-12 space-y-6">
      {/* Main Login Card */}
      <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-sm space-y-6">
        {/* Card Header with official logo */}
        <div className="text-center space-y-3 pb-4 border-b border-slate-100">
          <div className="flex justify-center">
            <img
              src="/android-chrome-512x512.png"
              alt="國立臺中科技大學 資訊與流通學院"
              className="h-12 w-auto object-contain"
            />
          </div>

          <div>
            <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
              {isStage ? '專題報告抽籤現場登入' : '管理後台授權登入'}
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              {isStage
                ? '此通道僅供現場主持展演與計分人員操作抽籤'
                : '此通道僅供大會管理員匯入名冊與設定評審'}
            </p>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleLogin} className="space-y-4">
          {/* Username */}
          <div>
            <label htmlFor="staff-email" className="block text-xs font-bold text-slate-700 mb-1.5">
              登入 Email <span className="font-normal text-slate-400">(Account)</span>
            </label>
            <div className="relative">
              <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                <User className="w-4 h-4" />
              </div>
              <input
                id="staff-email"
                type="email"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="例如：admin@example.edu.tw"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 transition-all font-mono"
                autoComplete="username"
              />
            </div>
          </div>

          {/* Password */}
          <div>
            <label htmlFor="staff-password" className="block text-xs font-bold text-slate-700 mb-1.5">
              通行密碼 <span className="font-normal text-slate-400">(Password)</span>
            </label>
            <div className="relative">
              <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                <Lock className="w-4 h-4" />
              </div>
              <input
                id="staff-password"
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="請輸入授權通行密碼"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-10 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 transition-all font-mono"
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? '隱藏密碼' : '顯示密碼'}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1 cursor-pointer transition-colors"
                title={showPassword ? '隱藏密碼' : '顯示密碼'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Remember me option */}
          <div className="flex items-center justify-between text-xs pt-0.5">
            <label className="flex items-center gap-2 cursor-pointer select-none text-slate-600">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
              />
              <span>記住登入狀態</span>
            </label>
          </div>

          {/* Error Message */}
          {errorMessage && (
            <div role="alert" className="flex items-start gap-2.5 p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs animate-in fade-in">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
              <span className="leading-snug">{errorMessage}</span>
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isSubmitting}
            className={`w-full py-3 px-4 rounded-xl text-white font-bold text-sm shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer ${
              isStage
                ? 'bg-rose-600 hover:bg-rose-700'
                : 'bg-slate-900 hover:bg-slate-800'
            }`}
          >
            {isSubmitting ? (
              <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            ) : (
              <LogIn className="w-4 h-4" />
            )}
            <span>{isSubmitting ? '驗證中...' : '授權驗證並進入系統'}</span>
          </button>
        </form>

        <p className="text-xs text-slate-500">請使用大會配置的 Email 與密碼登入。</p>
      </div>
    </div>
  );
};
