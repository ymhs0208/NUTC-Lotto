import { config } from 'dotenv';
import { spawn } from 'node:child_process';
import { constants } from 'node:os';

// Match server.ts precedence: shell > .env.local > .env.
config({ path: '.env.local', quiet: true });
config({ quiet: true });

// Set the crypto pool in the child's environment before Node starts.
// Setting it inside server.ts can be too late because imports already use libuv.
const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts', ...process.argv.slice(2)], {
  env: { ...process.env, UV_THREADPOOL_SIZE: process.env.UV_THREADPOOL_SIZE || '8' },
  stdio: 'inherit',
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
child.once('error', error => {
  console.error('Unable to start server:', error.message);
  process.exit(1);
});
child.once('exit', (code, signal) => {
  process.exit(code ?? (signal ? 128 + constants.signals[signal] : 1));
});
