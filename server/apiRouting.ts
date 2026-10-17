/** Keep each login queue inside one Durable Object's I/O context. Verification
 * CPU is distributed separately; ordinary API traffic retains its shard pool. */
export function apiBackendName(pathname: string, shard: number, distributed = false): string {
  if (!distributed) return `api-${shard}`;
  const path = pathname.toLowerCase().replace(/\/+$/, '');
  if (path === '/api/student/verify') return 'api-student-login-v2';
  if (path === '/api/auth/verify') return 'api-staff-login-v2';
  return `api-${shard}`;
}
