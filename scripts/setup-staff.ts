import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../server/credentials';
import { setup } from './cloudflareSetup';

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error('用法：npm run accounts:setup -- data/staff-accounts.json');
  const input = JSON.parse(await readFile(file, 'utf8'));
  if (!Array.isArray(input) || !input.length || input.length > 100) throw new Error('帳號檔案須為 1 至 100 筆陣列。');
  for (const a of input) {
    if (!a || typeof a.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email.trim()) || a.email.length > 256 || !['admin', 'stage'].includes(a.role) || typeof a.password !== 'string' || a.password.trim().length < 8 || a.password.length > 128) throw new Error('帳號須包含有效 email、admin/stage role 與 8 至 128 字元密碼。');
  }
  const accounts = [];
  for (const a of input) accounts.push({ id: randomUUID(), email: a.email.trim().toLowerCase(), role: a.role, password_hash: await hashPassword(a.password) });
  const result = await setup({ action: 'accounts', accounts });
  console.log(`已設定 ${result.count} 個 Cloudflare 工作人員帳號。`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
