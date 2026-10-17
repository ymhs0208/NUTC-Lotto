import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2];
if (!['check', 'deploy'].includes(mode)) throw new Error('Expected check or deploy');
const cli = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
for (let i = 0; i < 4; i++) {
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, 'deploy', '--config', `wrangler.password-${i}.jsonc`, ...(mode === 'check' ? ['--dry-run'] : [])], { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve(signal ? 1 : code ?? 1));
  });
  if (code !== 0) process.exit(code);
}
