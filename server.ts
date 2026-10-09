import { config } from 'dotenv';
config({ path: '.env.local' });
config();
import { createServer as createHttpServer } from 'node:http';
import { createServer as createViteServer } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openLocalDatabase } from './server/localDatabase';
import { withRuntime } from './server/runtime';
import { app } from './server/app';
import { serveFrontend } from './server/frontendAssets';
import { startSessionCleanup } from './server/sessionCleanup';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);

async function startServer() {
  const local = openLocalDatabase(process.env.SQLITE_PATH || 'data/lottery.sqlite', { email: process.env.ADMIN_EMAIL, passwordHash: process.env.ADMIN_PASSWORD_HASH });
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({ server: { middlewareMode: true, host: '0.0.0.0' }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    serveFrontend(app, path.resolve(__dirname, 'dist'));
  }
  const server = createHttpServer((req, res) => withRuntime({ ...process.env, DATABASE: local.database }, () => app(req, res))).listen(PORT, '0.0.0.0', () => {
    console.log(`Server: http://localhost:${PORT} (SQLite)`);
    if (process.env.NODE_ENV === 'production') {
      const stopCleanup = withRuntime({ ...process.env, DATABASE: local.database }, () => startSessionCleanup());
      server.once('close', stopCleanup);
    }
  });
}
startServer().catch(err => { console.error(err); process.exit(1); });
