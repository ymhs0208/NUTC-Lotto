import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });
config({ quiet: true });

export async function setup(body: object) {
  const target = new URL(process.env.TARGET_URL || 'https://localhost:3000');
  const token = process.env.SETUP_TOKEN;
  if (target.protocol !== 'https:') throw new Error('TARGET_URL 必須使用 HTTPS。');
  if (!token || token.length < 32) throw new Error('請設定至少 32 字元的 SETUP_TOKEN。');
  if (['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)) {
    // Only the local Wrangler endpoint uses a self-signed certificate.
    const { Agent } = await import('node:https');
    const { request } = await import('node:https');
    const raw = JSON.stringify(body);
    return new Promise<any>((resolve, reject) => {
      const req = request(new URL('/api/cloudflare/setup', target), {
        method: 'POST', agent: new Agent({ rejectUnauthorized: false }),
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(raw), Authorization: `Bearer ${token}` },
      }, res => {
        let text = ''; res.setEncoding('utf8'); res.on('data', chunk => text += chunk);
        res.on('error', reject);
        res.on('end', () => {
          try {
            const result = JSON.parse(text);
            if (res.statusCode !== 200) reject(new Error(result.error || `HTTP ${res.statusCode}`));
            else resolve(result);
          } catch { reject(new Error('帳號設定服務回應格式錯誤。')); }
        });
      });
      req.on('error', reject);
      req.setTimeout(30000, () => req.destroy(new Error('帳號設定逾時；請確認目標資料庫後再重試。')));
      req.end(raw);
    });
  }
  const response = await fetch(new URL('/api/cloudflare/setup', target), {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body), signal: AbortSignal.timeout(30000), redirect: 'error',
  });
  const result = await response.json() as { error?: string };
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  return result;
}
