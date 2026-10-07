/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useCallback, useRef, lazy, Suspense } from 'react';
import { ProjectItem, ViewMode, DomainConfig } from './types';
import { isRequestCancelled, StoreState } from './lib/api';
import { useApiRequest } from './lib/useApiRequest';
import { Navbar } from './components/Navbar';
import { StudentPortal } from './components/StudentPortal';
import { AuthGate } from './components/AuthGate';
import { FloatingNotice } from './components/FloatingNotice';
import {
  getAuthSession,
  clearAuthSession,
  saveAuthSession,
  hasPermissionForView,
  AuthSession,
} from './lib/auth';

import { getViewFromLocation, canonicalPageUrl, viewPath, viewTitles } from './lib/routes';

const PublicResults = lazy(() => import('./components/PublicResults').then(module => ({ default: module.PublicResults })));
const StageLottery = lazy(() => import('./components/StageLottery').then(module => ({ default: module.StageLottery })));
const AdminManagement = lazy(() => import('./components/AdminManagement').then(module => ({ default: module.AdminManagement })));
const StaffLogs = lazy(() => import('./components/StaffLogs').then(module => ({ default: module.StaffLogs })));

export default function App() {
  const [currentView, setCurrentView] = useState<ViewMode>(() => getViewFromLocation(window.location));
  const request = useApiRequest(currentView);
  const loadControllerRef = useRef<AbortController | null>(null);
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [domainConfigs, setDomainConfigs] = useState<DomainConfig[]>([]);
  const [sharedPasswordEnabled, setSharedPasswordEnabled] = useState(false);
  const [dataVersion, setDataVersion] = useState<number | null>(null);
  const dataVersionRef = useRef<number | null>(null);
  const loadRequestIdRef = useRef(0);
  const [dataError, setDataError] = useState<string | null>(null);
  const [authSession, setAuthSession] = useState<AuthSession | null>(() => getAuthSession());

  const [authReady, setAuthReady] = useState(false);
  useEffect(() => {
    if (currentView === 'results') { setAuthReady(true); return; }
    let active = true;
    request<{ session: AuthSession }>('/api/auth/me').then(data => {
      if (active) { saveAuthSession(data.session); setAuthSession(data.session); }
    }).catch(() => {}).finally(() => { if (active) setAuthReady(true); });
    return () => { active = false; };
  }, [request]);

  // Handle staff/admin logout
  const handleLogout = useCallback(async () => {
    try { await request('/api/auth/logout', {}); }
    catch (error) { if (!isRequestCancelled(error)) setDataError(error instanceof Error ? error.message : '登出失敗，請重試'); return; }
    loadControllerRef.current?.abort();
    clearAuthSession();
    loadRequestIdRef.current++;
    setAuthSession(null);
    setProjects([]);
    setDomainConfigs([]);
    setSharedPasswordEnabled(false);
    dataVersionRef.current = null;
    setDataVersion(null);
    handleSelectView('student');
  }, [request]);

  const handleSelectView = useCallback((view: ViewMode) => {
    const target = viewPath(view);
    if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== target) {
      window.history.pushState({ view }, '', target);
    }
    setCurrentView(view);
    requestAnimationFrame(() => document.getElementById('main-content')?.focus());
  }, []);

  useEffect(() => {
    const syncLocation = () => {
      const view = getViewFromLocation(window.location);
      const canonical = canonicalPageUrl(window.location);
      const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (canonical !== current) window.history.replaceState({ view }, '', canonical);
      setCurrentView(view);
    };
    syncLocation();
    window.addEventListener('popstate', syncLocation);
    window.addEventListener('hashchange', syncLocation);
    return () => {
      window.removeEventListener('popstate', syncLocation);
      window.removeEventListener('hashchange', syncLocation);
    };
  }, []);

  useEffect(() => { document.title = viewTitles[currentView]; }, [currentView]);

  const applyState = (state: StoreState) => {
    // Keep the version and displayed data in the same snapshot. An older GET
    // response must not roll the UI back after a newer save has completed.
    if (dataVersionRef.current !== null && state.version < dataVersionRef.current) return;
    dataVersionRef.current = state.version;
    setDataVersion(state.version);
    setProjects(state.projects);
    setDomainConfigs(state.domainConfigs);
    setSharedPasswordEnabled(state.sharedPasswordEnabled);
    setDataError(null);
  };

  const loadData = useCallback(async () => {
    loadControllerRef.current?.abort();
    const controller = new AbortController();
    loadControllerRef.current = controller;
    const requestId = ++loadRequestIdRef.current;
    if (!getAuthSession() || currentView === 'logs' || currentView === 'results') {
      setProjects([]);
      setDomainConfigs([]);
      setSharedPasswordEnabled(false);
      dataVersionRef.current = null;
      setDataVersion(null);
      setDataError(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const state = await request<StoreState>('/api/state', undefined, { signal: controller.signal });
      if (requestId === loadRequestIdRef.current && getAuthSession()) applyState(state);
    } catch (error) {
      if (!isRequestCancelled(error) && requestId === loadRequestIdRef.current) setDataError(error instanceof Error ? error.message : '資料載入失敗');
    } finally {
      if (requestId === loadRequestIdRef.current) setIsLoading(false);
    }
  }, [request, currentView]);

  useEffect(() => { void loadData(); return () => { loadControllerRef.current?.abort(); }; }, [loadData, authSession]);
  useEffect(() => {
    const expired = () => { loadControllerRef.current?.abort(); loadRequestIdRef.current++; setAuthSession(null); setProjects([]); setDomainConfigs([]); setSharedPasswordEnabled(false); dataVersionRef.current = null; setDataVersion(null); };
    window.addEventListener('auth-expired', expired);
    return () => window.removeEventListener('auth-expired', expired);
  }, []);

  const handleSaveProjects = async (updated: ProjectItem[]) => {
    try {
      if (dataVersion === null) throw new Error('資料尚未載入，請重新整理。');
      applyState(await request('/api/projects', { projects: updated, version: dataVersion }));
    } catch (error) {
      if (!isRequestCancelled(error)) setDataError(error instanceof Error ? error.message : '儲存失敗');
      throw error;
    }
  };

  const handleSharedPassword = async (action: 'generate' | 'clear') => {
    if (dataVersion === null) throw new Error('資料尚未載入，請重新整理。');
    const state = await request<StoreState & { password?: string }>('/api/student/shared-password', { action, version: dataVersion });
    applyState(state);
    return state.password;
  };

  const handleUpdateDomainConfigs = async (
    newConfigs: DomainConfig[],
    renamedField?: { oldName: string; newName: string }
  ) => {
    try {
      if (dataVersion === null) throw new Error('資料尚未載入，請重新整理。');
      applyState(await request('/api/domain-configs', { domainConfigs: newConfigs, renamedField, version: dataVersion }));
    } catch (error) {
      if (!isRequestCancelled(error)) setDataError(error instanceof Error ? error.message : '儲存失敗');
      throw error;
    }
  };

  // Compute unique domain list based on current active domain configs
  const domainList = useMemo(() => {
    return domainConfigs.map((d) => d.field);
  }, [domainConfigs]);

  if (!authReady && currentView !== 'student' && currentView !== 'results') return <div className="p-8 text-center text-slate-500">正在載入後端登入狀態…</div>;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans selection:bg-rose-100 selection:text-rose-900">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-xl focus:bg-white focus:px-4 focus:py-3 focus:font-bold focus:text-blue-800 focus:shadow-lg">跳至主要內容</a>
      {/* Top Navigation */}
      <Navbar
        authSession={authSession}
        onLogout={handleLogout}
      />

      {/* Main Content Viewport */}
      <main id="main-content" tabIndex={-1} className="flex-1 pb-16">
        <span className="sr-only" aria-live="polite">{currentView === 'results' ? '各領域抽籤結果' : currentView === 'student' ? '專題報告場次查詢' : currentView === 'stage' ? '專題報告抽籤現場' : '管理後台'}</span>
        {dataError && (
          <FloatingNotice
            type="error"
            message={dataError}
            onClose={() => setDataError(null)}
            actionLabel="重新載入"
            onAction={() => void loadData()}
          />
        )}
        {isLoading && currentView !== 'student' && currentView !== 'results' ? (
          <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
            <div className="w-9 h-9 border-3 border-rose-100 border-t-rose-600 rounded-full animate-spin" />
            <p className="text-slate-500 text-xs">載入專題名冊與抽籤資料中...</p>
          </div>
        ) : (
          <Suspense fallback={<div className="p-8 text-center text-slate-500" role="status">正在載入頁面…</div>}>
            {currentView === 'results' && <PublicResults />}
            {currentView === 'student' && (
              <StudentPortal />
            )}

            {currentView === 'stage' && (
              !hasPermissionForView(authSession?.role || null, 'stage') ? (
                <AuthGate
                  targetView="stage"
                  onSuccess={(session) => {
                    setAuthSession(session);
                  }}
                />
              ) : (
                <StageLottery
                  projects={projects}
                  dataVersion={dataVersion}
                  onApplyState={applyState}
                  domainList={domainList}
                  domainConfigs={domainConfigs}
                />
              )
            )}

            {currentView === 'logs' && (
              !hasPermissionForView(authSession?.role || null, 'logs')
                ? <AuthGate targetView="admin" onSuccess={setAuthSession} />
                : <StaffLogs />
            )}
            {currentView === 'admin' && (
              !hasPermissionForView(authSession?.role || null, 'admin') ? (
                <AuthGate
                  targetView="admin"
                  onSuccess={(session) => {
                    setAuthSession(session);
                  }}
                />
              ) : (
                <AdminManagement
                  projects={projects}
                  dataVersion={dataVersion}
                  onSaveProjects={handleSaveProjects}
                  sharedPasswordEnabled={sharedPasswordEnabled}
                  onSharedPassword={handleSharedPassword}
                  domainList={domainList}
                  domainConfigs={domainConfigs}
                  onUpdateDomainConfigs={handleUpdateDomainConfigs}
                />
              )
            )}
          </Suspense>
        )}
      </main>

      {/* 國立臺中科技大學 版權宣告 */}
      <footer className="border-t border-slate-200/90 bg-slate-50/70 py-8 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col items-center justify-center space-y-1.5">
          <div className="text-slate-900 font-bold text-sm sm:text-base tracking-tight">
            國立臺中科技大學
          </div>
          <div className="text-slate-500 text-xs sm:text-sm font-medium tracking-wide">
            National Taichung University of Science and Technology
          </div>
          <div className="pt-2 text-slate-600 text-xs">
            © 2026 國立臺中科技大學 資訊與流通學院專題成果展
          </div>
        </div>
      </footer>
    </div>
  );
}
