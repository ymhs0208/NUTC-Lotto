export type UserRole = 'admin' | 'stage' | null;

export interface AuthSession {
  expiresAt: number;
  role: UserRole;
  username: string;
  displayName: string;
  loginTime: string;
}

// Remove credentials saved by the previous browser-storage implementation.
try {
  localStorage.removeItem('nutc_cids_auth_session');
  sessionStorage.removeItem('nutc_cids_auth_session');
} catch {}

// Display-only in-memory profile. Authentication is checked by the backend cookie.
let currentSession: AuthSession | null = null;
export function getAuthSession(): AuthSession | null { return currentSession; }
export function saveAuthSession(session: AuthSession): void { currentSession = session; }
export function clearAuthSession(): void { currentSession = null; }

export function hasPermissionForView(role: UserRole, view: 'stage' | 'admin' | 'student' | 'logs' | 'results'): boolean {
  if (view === 'student' || view === 'results') return true;
  if (role === 'admin') return true; // Admin has full access to both stage and admin
  if (role === 'stage' && view === 'stage') return true; // Stage staff can access stage lottery
  return false;
}
