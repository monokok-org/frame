import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function canLoadBetterSqlite3() {
  try {
    require('better-sqlite3');
    return true;
  } catch (error) {
    return error;
  }
}

const initial = canLoadBetterSqlite3();
if (initial === true) {
  process.exit(0);
}

const rebuildArgs = ['rebuild', 'better-sqlite3', '--build-from-source'];
const execPath = process.env.npm_execpath;
const userAgent = process.env.npm_config_user_agent || '';
const isYarn = userAgent.startsWith('yarn/');
const command = execPath ? process.execPath : (isYarn ? 'yarn' : 'npm');
const args = execPath ? [execPath, ...rebuildArgs] : rebuildArgs;

const result = spawnSync(command, args, {
  stdio: 'inherit',
  shell: process.platform === 'win32'
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const after = canLoadBetterSqlite3();
if (after !== true) {
  console.error('[SQLite] better-sqlite3 rebuild completed, but bindings are still missing.');
  console.error('[SQLite] Ensure build tools are installed (python3, make, g++ / Xcode CLT).');
  if (after instanceof Error) {
    console.error(`[SQLite] ${after.message}`);
  }
  process.exit(1);
}
