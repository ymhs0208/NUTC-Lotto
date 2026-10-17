// Isolated benchmark entry point only. Production configs never reference this file.
import { withRuntime, type RuntimeEnvironment } from '../../server/runtime';
import { verifyPassword } from '../../server/credentials';
import { studentLoginWork } from '../../server/loginAdmission';
export class PasswordBenchmarkApi {
  constructor(_ctx: unknown, private env: RuntimeEnvironment) {}
  async fetch(request: Request): Promise<Response> {
    if (request.method === 'GET' && new URL(request.url).pathname === '/ready') return Response.json({ ready: true });
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/verify') return new Response('Not found', { status: 404 });
    const { password, encoded } = await request.json() as { password: string; encoded: string };
    const runtime = { ...this.env };
    if (request.headers.get('X-Benchmark-Pools') === '1') {
      runtime.PASSWORD_VERIFIER_1 = runtime.PASSWORD_VERIFIER_0;
      runtime.PASSWORD_VERIFIER_2 = runtime.PASSWORD_VERIFIER_0;
      runtime.PASSWORD_VERIFIER_3 = runtime.PASSWORD_VERIFIER_0;
    }
    try {
      // Match production's 16-active login admission, without the database or rate limiter.
      const valid = await withRuntime({ ...runtime, LOGIN_LIMITER: {} as any, PASSWORD_VERIFICATION_MODE: 'distributed' },
        () => studentLoginWork.run(() => verifyPassword(password, encoded)));
      return Response.json({ valid });
    } catch { return Response.json({ valid: false }, { status: 503 }); }
  }
}
export default {
  fetch(request: Request, env: { BENCHMARK_API: any; BENCHMARK_KEY: string }): Promise<Response> | Response {
    if (!env.BENCHMARK_KEY || request.headers.get('Authorization') !== `Bearer ${env.BENCHMARK_KEY}`) return new Response('Forbidden', { status: 403 });
    return env.BENCHMARK_API.get(env.BENCHMARK_API.idFromName('api')).fetch(request);
  },
};
