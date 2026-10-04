import type { ViewMode } from '../types';

interface PageLocation { pathname: string; search: string; hash: string }
const views: Record<string, ViewMode> = {
  student: 'student', inquiry: 'student', admin: 'admin', manage: 'admin', stage: 'stage', lottery: 'stage', logs: 'logs',
};
const parseView = (name: string): ViewMode | undefined => Object.hasOwn(views, name) ? views[name] : undefined;
const pathView = (path: string) => parseView(path.toLowerCase().replace(/^\//, '').replace(/\/+$/, ''));
const hashView = (hash: string) => parseView(hash.toLowerCase().replace(/^#\/?/, '').replace(/\/$/, ''));

export function viewPath(view: ViewMode): string {
  return view === 'student' ? '/' : `/${view}`;
}

export function getViewFromLocation(location: PageLocation): ViewMode {
  // Explicit page paths take precedence over stale legacy query/hash selectors.
  return pathView(location.pathname)
    || parseView(new URLSearchParams(location.search).get('view')?.toLowerCase() || '')
    || hashView(location.hash) || 'student';
}

export function canonicalPageUrl(location: PageLocation): string {
  const search = new URLSearchParams(location.search);
  const queryView = parseView(search.get('view')?.toLowerCase() || '');
  const legacyHash = hashView(location.hash);
  if (location.pathname !== '/' && !pathView(location.pathname) && !queryView && !legacyHash) {
    return `${location.pathname}${location.search}${location.hash}`;
  }
  if (queryView) search.delete('view');
  const query = search.toString();
  return `${viewPath(getViewFromLocation(location))}${query ? `?${query}` : ''}${legacyHash ? '' : location.hash}`;
}

export const viewTitles: Record<ViewMode, string> = {
  logs: '工作人員操作紀錄 | 國立臺中科技大學專題成果展',
  student: '專題報告場次查詢 | 國立臺中科技大學專題成果展',
  stage: '專題報告抽籤現場 | 國立臺中科技大學專題成果展',
  admin: '管理後台 | 國立臺中科技大學專題成果展',
};
