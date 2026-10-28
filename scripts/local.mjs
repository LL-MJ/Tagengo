import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, lstat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { GitStore, DATA_REMOTE } from './git-store.mjs';
import { createGitApi } from './git-api.mjs';
const run = promisify(execFile),
  root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const parent = path.join(root, '.local-data'),
  directory = path.join(parent, 'Tagengo-data');
await mkdir(parent, { recursive: true });
try {
  await lstat(directory);
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
  await run('git', ['clone', DATA_REMOTE, directory], {
    cwd: root,
    windowsHide: true,
    timeout: 120000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
}
const store = new GitStore(directory);
await store.initialize();
if (process.argv.includes('--sync-only')) {
  const result = await store.sync();
  console.log(`已同步 ${result.records.length} 个学习版本至 ${DATA_REMOTE}`);
  process.exit(0);
}
const server = createGitApi(store);
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(4319, '127.0.0.1', resolve);
});
const dev = spawn(
  process.execPath,
  [
    path.join(root, 'node_modules/vinext/dist/cli.js'),
    'dev',
    '--host',
    '127.0.0.1',
  ],
  {
    cwd: root,
    windowsHide: true,
    stdio: 'inherit',
    env: { ...process.env, TAGENGO_LOCAL_GIT: '1' },
  },
);
console.log('本地 Git 学习库：http://localhost:3000/（点击页面右上角同步）');
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  dev.kill();
  server.close();
  setTimeout(() => process.exit(), 1500).unref();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
dev.on('exit', (code) => {
  server.close();
  process.exitCode = code || 0;
});
dev.on('error', (e) => {
  console.error(e.message);
  stop();
});
