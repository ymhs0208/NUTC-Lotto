import { BoundedExecutor, ResourceBusyError } from '../server/resourceLimits';
import { checkPasswordKey, PASSWORD_HASH_FORMAT } from '../server/passwordHash';

// Each deployed script receives requests for one fixed object only. Its queue
// stays inside that object's I/O context; no cross-object global waiting list.
export class PasswordVerifier {
  private readonly work = new BoundedExecutor(1, 32, 15000);
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/verify') return new Response('Not found', { status: 404 });
    if (!request.headers.get('Content-Type')?.startsWith('application/json')) return new Response('Invalid request', { status: 400 });
    try {
      // Read at most 4 KiB even if an internal caller omits Content-Length.
      const reader = request.body?.getReader();
      if (!reader) return new Response('Invalid request', { status: 400 });
      const chunks: Uint8Array[] = []; let length = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > 4096) { await reader.cancel(); return new Response('Request too large', { status: 413 }); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      const body = JSON.parse(Buffer.concat(chunks).toString()) as { password?: unknown; encoded?: unknown } | null;
      if (!body || typeof body.password !== 'string' || body.password.length > 128 ||
          !(body.encoded === null || (typeof body.encoded === 'string' && PASSWORD_HASH_FORMAT.test(body.encoded)))) {
        return new Response('Invalid request', { status: 400 });
      }
      const { password, encoded } = body as { password: string; encoded: string | null };
      const valid = await this.work.run(() => checkPasswordKey(password, encoded));
      return Response.json({ valid }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      if (error instanceof SyntaxError) return new Response('Invalid request', { status: 400 });
      return Response.json({ error: 'Verification unavailable' }, {
        status: 503, headers: { 'Cache-Control': 'no-store', ...(error instanceof ResourceBusyError ? { 'Retry-After': '2' } : {}) },
      });
    }
  }
}

// Only the private DO binding accepts verification. No public HTTP entry point.
export default { fetch() { return new Response('Not found', { status: 404 }); } };
