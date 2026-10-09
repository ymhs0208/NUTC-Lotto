import { config } from 'dotenv';
import { readFile } from 'node:fs/promises';
import { projectDto } from '../server/credentials';
import { validateProjects, validateDomains } from '../server/store';
import { openLocalDatabase } from '../server/localDatabase';
config({ path: '.env.local' }); config();
async function migrate() {
  const source = JSON.parse(await readFile(process.argv[2] || 'data/server-db.json', 'utf8'));
  const projects = source.projects.map(projectDto); // Never import plaintext or old credentials.
  validateProjects(projects); validateDomains(source.domainConfigs);
  const local = openLocalDatabase(process.env.SQLITE_PATH || 'data/lottery.sqlite');
  try {
    const current = await local.database.call('load', {});
    if (current.projects.length || current.version !== 0) throw new Error('SQLite 已有資料或已被操作，停止移轉以避免覆蓋。');
    const saved = await local.database.call('save', { state: { ...current, projects, domainConfigs: source.domainConfigs }, expectedVersion: 0 });
    console.log(`已移轉 ${saved.projects.length} 筆專題至本機 SQLite；學生密碼須於後台重新設定。`);
  } finally { local.close(); }
}
migrate().catch(error => { console.error(error.message); process.exitCode = 1; });
