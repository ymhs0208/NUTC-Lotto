import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LayoutGrid, RefreshCw, Table2 } from 'lucide-react';
import type { PublicDrawResult, PublicResultsResponse } from '../types';
import { useApiRequest } from '../lib/useApiRequest';
import { isRequestCancelled } from '../lib/api';
import { formatSessionLabel } from '../lib/sessionLabel';

export function PublicResults() {
  const request = useApiRequest();
  const [field, setField] = useState('');
  const [visibleCount, setVisibleCount] = useState(50);
  const [displayMode, setDisplayMode] = useState<'cards' | 'table'>(() => {
    try { return localStorage.getItem('public-results-display') === 'table' ? 'table' : 'cards'; }
    catch { return 'cards'; }
  });
  useEffect(() => {
    try { localStorage.setItem('public-results-display', displayMode); } catch {}
  }, [displayMode]);
  const [data, setData] = useState<PublicResultsResponse>({ domains: [], results: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [hasSnapshot, setHasSnapshot] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const cachedDomains = useRef(new Map<string, { data: PublicResultsResponse; updatedAt: string }>());
  const version = useRef<number | undefined>(undefined);
  const selectedField = useRef('');

  const selectField = (next: string) => {
    setVisibleCount(50);
    selectedField.current = next;
    const cached = cachedDomains.current.get(next);
    setData(previous => cached?.data || { domains: previous.domains, results: [] });
    setUpdatedAt(cached?.updatedAt ?? null);
    setHasSnapshot(!!cached);
    setError('');
    setLoading(true);
    setField(next);
  };

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    const cached = cachedDomains.current.get(field);
    if (cached) { setData(cached.data); setUpdatedAt(cached.updatedAt); setHasSnapshot(true); }
    request<PublicResultsResponse>(`/api/public/results${field ? `?field=${encodeURIComponent(field)}` : ''}`, undefined, { signal: controller.signal })
      .then(result => {
        if (controller.signal.aborted || selectedField.current !== field) return;
        if (version.current !== undefined && result.version !== version.current) cachedDomains.current.clear();
        version.current = result.version;
        const receivedAt = new Date().toISOString();
        cachedDomains.current.set(field, { data: result, updatedAt: receivedAt });
        setData(result);
        setUpdatedAt(receivedAt);
        setHasSnapshot(true);
        if (field && !result.domains.includes(field)) selectField('');
      })
      .catch(reason => {
        if (selectedField.current === field && !isRequestCancelled(reason)) setError(reason instanceof Error ? reason.message : '抽籤結果暫時無法載入，請稍後再試。');
      })
      .finally(() => { if (!controller.signal.aborted && selectedField.current === field) setLoading(false); });
    return () => controller.abort();
  }, [field, refresh, request]);

  const sessions = useMemo(() => {
    const grouped = new Map<number | null, PublicDrawResult[]>();
    for (const result of data.results) {
      const group = grouped.get(result.assigned_group) || [];
      group.push(result);
      grouped.set(result.assigned_group, group);
    }
    let remaining = visibleCount;
    return Array.from(grouped).flatMap(([session, allResults]) => {
      const results = allResults.slice(0, remaining);
      remaining = Math.max(0, remaining - allResults.length);
      return results.length ? [{ session, results, total: allResults.length }] : [];
    });
  }, [data.results, visibleCount]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <header className="border-l-4 border-blue-700 pl-4 sm:pl-5">
        <h1 className="text-2xl font-black tracking-tight text-slate-900 sm:text-4xl">各領域抽籤結果</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">選擇領域，查看報告場次與抽籤編號。</p>
      </header>
      <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <div className="min-w-0">
          <label htmlFor="public-result-field" className="mb-2 block text-sm font-bold text-slate-700">選擇領域</label>
          <select id="public-result-field" disabled={!data.domains.length} aria-busy={loading && !data.domains.length} value={field} onChange={event => selectField(event.target.value)} className="min-h-12 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-3 text-base font-semibold text-slate-900 focus-visible:outline-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-60">
            <option value="">{data.domains.length ? '請選擇領域' : loading ? '領域載入中…' : error ? '領域載入失敗' : '尚無可選領域'}</option>
            {data.domains.map(domain => <option key={domain} value={domain}>{domain}</option>)}
          </select>
        </div>
        <button type="button" disabled={loading || !field} onClick={() => { if (!field || loading) return; setLoading(true); setRefresh(value => value + 1); }} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-blue-700 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden="true" />{loading ? '更新中…' : '更新結果'}
        </button>
        </div>
      </div>
      {error && <div role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-relaxed text-amber-900">
        <p>{error} {hasSnapshot ? '目前顯示上次取得的結果。' : ''}{field ? '請按「更新結果」重試。' : '請重新載入領域選單。'}</p>
        {!field && <button type="button" disabled={loading} onClick={() => { setLoading(true); setRefresh(value => value + 1); }} className="mt-3 min-h-11 rounded-xl border border-amber-300 bg-white px-4 py-2 font-bold hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-amber-700 disabled:opacity-50">重新載入領域</button>}
      </div>}
      {loading && !hasSnapshot ? <div role="status" className="flex items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white py-14 text-sm text-slate-500"><RefreshCw className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />載入抽籤結果中…</div>
        : !field ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-14 text-center"><p className="font-bold text-slate-700">{data.domains.length ? '選擇領域，查看抽籤結果' : '目前尚未設定領域'}</p><p className="mt-2 text-sm text-slate-500">{data.domains.length ? '請使用上方選單選擇要查詢的領域。' : '領域設定完成後，將在此提供查詢。'}</p></div>
        : <section aria-label={`${field}抽籤結果`} className="space-y-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0 space-y-2">
              <h2 className="break-words text-xl font-black text-slate-900 sm:text-2xl">{field}</h2>
              <p aria-live="polite" className="text-xs font-medium text-slate-500">{`已公布 ${data.results.length} 件專題`}</p>
              {updatedAt && <p className="text-xs leading-relaxed text-slate-500">最後更新時間：<time dateTime={updatedAt}>{new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(updatedAt))}</time></p>}
            </div>
            <div className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-200 pt-3 sm:border-0 sm:pt-0">
              <span className="text-xs font-semibold text-slate-500">顯示方式</span>
        <div role="group" aria-label="結果顯示方式" className="grid min-h-11 shrink-0 grid-cols-2 gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
          <button type="button" aria-pressed={displayMode === 'cards'} onClick={() => setDisplayMode('cards')} className={`inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-bold transition-colors focus-visible:outline-2 focus-visible:outline-blue-600 ${displayMode === 'cards' ? 'bg-blue-700 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}><LayoutGrid className="h-4 w-4" aria-hidden="true" />卡片</button>
          <button type="button" aria-pressed={displayMode === 'table'} onClick={() => setDisplayMode('table')} className={`inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-bold transition-colors focus-visible:outline-2 focus-visible:outline-blue-600 ${displayMode === 'table' ? 'bg-blue-700 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}><Table2 className="h-4 w-4" aria-hidden="true" />表格</button>
        </div>
            </div>
          </div>
          {!data.results.length ? <p className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-14 text-center text-slate-500">此領域尚無已公布的抽籤結果。</p>
            : sessions.map(({ session, results, total }) => <section key={session ?? 'pending'} aria-label={session ? formatSessionLabel(session) : '場次尚未提供'} className="space-y-3">
              <div className="flex items-center gap-3 px-1">
                <span className="h-5 w-1 rounded-full bg-blue-700" aria-hidden="true" />
                <h3 className="text-base font-black text-blue-900 sm:text-lg">{session ? formatSessionLabel(session) : '場次尚未提供'}</h3>
                <span className="text-xs font-medium text-slate-500">{results.length === total ? `${total} 件專題` : `已顯示 ${results.length}／共 ${total} 件`}</span>
                <span className="h-px flex-1 bg-slate-200" aria-hidden="true" />
              </div>
              {displayMode === 'table' ? <div className="space-y-2">
                <p className="px-1 text-xs text-slate-500 sm:hidden">表格可左右滑動查看完整內容。</p>
                <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm" tabIndex={0} role="region" aria-label={`${session ? formatSessionLabel(session) : '場次尚未提供'}結果表格，可左右捲動`}>
                  <table className="w-full min-w-[640px] text-left text-sm">
                    <caption className="sr-only">{field} · {session ? formatSessionLabel(session) : '場次尚未提供'}抽籤結果</caption>
                    <thead className="border-b-2 border-slate-300 bg-blue-50 text-blue-900">
                      <tr>
                        <th scope="col" className="w-28 whitespace-nowrap px-4 py-3 font-bold">抽籤編號</th>
                        <th scope="col" className="w-36 whitespace-nowrap px-4 py-3 font-bold">報告場次</th>
                        <th scope="col" className="px-4 py-3 font-bold">專題名稱</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y-2 divide-slate-300">
                      {results.map((result, index) => <tr key={`${result.draw_code}-${index}`} className="bg-white hover:bg-blue-50/50">
                        <td className="px-4 py-4 font-mono text-lg font-normal text-blue-900 [overflow-wrap:anywhere]">{result.draw_code}</td>
                        <td className="px-4 py-4 font-bold text-slate-700">{result.assigned_group ? formatSessionLabel(result.assigned_group) : '場次尚未提供'}</td>
                        <td className="px-4 py-4 font-semibold leading-relaxed text-slate-900 [overflow-wrap:anywhere]">{result.project_title}</td>
                      </tr>)}
                    </tbody>
                  </table>
                </div>
              </div> : <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 lg:gap-4">
                {results.map((result, index) => <article key={`${result.draw_code}-${index}`} className="flex min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-blue-300 sm:p-5">
                  <dl className="flex min-w-0 flex-1 flex-col">
                    <div className="min-w-0">
                      <dt className="text-xs font-semibold tracking-wide text-slate-500">專題名稱</dt>
                      <dd className="mt-2 text-lg font-bold leading-relaxed text-slate-900 [overflow-wrap:anywhere] sm:text-xl">{result.project_title}</dd>
                    </div>
                    <div className="mt-auto grid grid-cols-2 gap-3 pt-5 [container-type:inline-size]">
                      <div className="flex min-h-20 min-w-0 flex-col justify-center rounded-xl border border-blue-100 bg-blue-50 px-2 py-2.5 text-center sm:min-h-22 sm:px-3">
                        <dt className="text-xs font-normal text-blue-700">抽籤編號</dt>
                        <dd className="mt-1.5 font-mono text-[clamp(1.125rem,8.5cqw,1.75rem)] font-semibold leading-9 tracking-tight sm:text-[28px] text-blue-900 [overflow-wrap:anywhere]">{result.draw_code}</dd>
                      </div>
                      <div className="flex min-h-20 min-w-0 flex-col justify-center rounded-xl border border-blue-100 bg-blue-50 px-2 py-2.5 text-center sm:min-h-22 sm:px-3">
                        <dt className="text-xs font-normal text-blue-700">報告場次</dt>
                        <dd className="mt-1.5 text-[clamp(1.125rem,8.5cqw,1.75rem)] font-semibold leading-9 text-blue-900 [overflow-wrap:anywhere] sm:text-[28px]">{result.assigned_group ? formatSessionLabel(result.assigned_group) : '場次尚未提供'}</dd>
                      </div>
                    </div>
                  </dl>
                </article>)}
              </div>}
            </section>)}
          {data.results.length > 0 && <div className="space-y-3 pt-2 text-center">
            <p aria-live="polite" className="text-xs font-medium text-slate-500">目前顯示 {Math.min(visibleCount, data.results.length)}／共 {data.results.length} 件專題</p>
            {visibleCount < data.results.length && <button type="button" onClick={() => setVisibleCount(count => Math.min(count + 50, data.results.length))} className="min-h-12 rounded-xl border border-blue-200 bg-white px-6 py-3 text-sm font-bold text-blue-800 shadow-sm hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">載入更多（還有 {data.results.length - visibleCount} 件）</button>}
          </div>}
        </section>}
    </div>
  );
}
