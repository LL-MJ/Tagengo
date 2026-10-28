import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  mkdir,
  readFile,
  readdir,
  writeFile,
  rename,
  lstat,
  realpath,
} from 'node:fs/promises';
import path from 'node:path';
import { mergeRevisions, validateRevision } from '../lib/records.ts';
const run = promisify(execFile);
export const DATA_REMOTE = 'https://github.com/LL-MJ/Tagengo-data.git';
const categories = ['words', 'sentences', 'grammar'];
const repoReadme = `# Tagengo 私人学习记录\n\n此仓库只保存学习数据，与 Tagengo 程序源码分开。\n\n- words/<词条编号>/<版本编号>.json\n- sentences/<例句编号>/<版本编号>.json\n- grammar/<语法编号>/<版本编号>.json\n\n每次编辑新增一个版本文件，parents 指向此前版本。不同电脑修改同一记录时保留两个分支，在学习库中选择版本。删除使用 deleted 标记，历史版本不会丢失。请通过学习库编辑记录，不要直接改写历史版本文件。\n`;
export class GitStore {
  constructor(directory, remote = DATA_REMOTE) {
    this.directory = path.resolve(directory);
    this.remote = remote;
    this.queue = Promise.resolve();
  }
  exclusive(action) {
    const next = this.queue.then(action);
    this.queue = next.catch(() => {});
    return next;
  }
  async git(...args) {
    try {
      return (
        await run(
          'git',
          [
            '-c',
            `safe.directory=${this.directory}`,
            '-c',
            'core.hooksPath=/dev/null',
            ...args,
          ],
          {
            cwd: this.directory,
            windowsHide: true,
            timeout: 60000,
            maxBuffer: 8 * 1024 * 1024,
            env: {
              ...process.env,
              GIT_TERMINAL_PROMPT: '0',
              GCM_INTERACTIVE: 'Never',
            },
          },
        )
      ).stdout.trim();
    } catch (e) {
      throw Error(
        `Git ${args[0]} 失败：${String(e.stderr || e.message).slice(0, 1800)}`,
      );
    }
  }
  async assertRepo() {
    if ((await realpath(this.directory)) !== this.directory)
      throw Error('数据目录不能是符号链接');
    const origin = await this.git('remote', 'get-url', 'origin');
    if (origin !== this.remote)
      throw Error('数据仓库 origin 与配置不一致，已停止');
    if ((await this.git('branch', '--show-current')) !== 'main')
      throw Error('数据仓库必须在 main 分支');
    const unmerged = await this.git('ls-files', '-u');
    if (unmerged) throw Error('Git 文件冲突尚未解决，本机数据已保留');
  }
  async initialize() {
    await this.assertRepo();
    try {
      await lstat(path.join(this.directory, 'README.md'));
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      await writeFile(path.join(this.directory, 'README.md'), repoReadme, {
        flag: 'wx',
      });
    }
    for (const category of categories)
      await mkdir(path.join(this.directory, category), { recursive: true });
    return this.read();
  }
  async read() {
    await this.assertRepo();
    const records = [];
    for (const category of categories) {
      const base = path.join(this.directory, category);
      let folders;
      try {
        if ((await lstat(base)).isSymbolicLink()) throw Error('不支持符号链接');
        folders = await readdir(base, { withFileTypes: true });
      } catch (e) {
        if (e.code === 'ENOENT') continue;
        throw e;
      }
      for (const folder of folders) {
        if (
          !folder.isDirectory() ||
          folder.isSymbolicLink() ||
          !/^[a-zA-Z0-9_-]{1,100}$/.test(folder.name)
        )
          throw Error('数据目录含有无效条目');
        const dir = path.join(base, folder.name);
        for (const f of await readdir(dir, { withFileTypes: true })) {
          if (f.name.endsWith('.tmp')) continue;
          if (!f.isFile() || !/^[a-zA-Z0-9_-]{1,100}\.json$/.test(f.name))
            throw Error('数据目录含有无效文件');
          const file = path.join(dir, f.name);
          if ((await lstat(file)).size > 2 * 1024 * 1024)
            throw Error('记录文件超过 2MB');
          const r = validateRevision(JSON.parse(await readFile(file, 'utf8')));
          if (
            r.entry.kind !== category ||
            r.entry.id !== folder.name ||
            r.id + '.json' !== f.name
          )
            throw Error('文件路径与记录编号不一致');
          records.push(r);
        }
      }
    }
    return mergeRevisions(records);
  }
  async saveUnlocked(batch) {
    if (!Array.isArray(batch) || batch.length > 10000)
      throw Error('单次保存最多 10000 个版本');
    const existing = await this.read();
    const merged = mergeRevisions(existing, batch);
    const ids = new Set(existing.map((r) => r.id));
    for (const r of merged) {
      if (ids.has(r.id)) continue;
      const dir = path.join(this.directory, r.entry.kind, r.entry.id);
      await mkdir(dir, { recursive: true });
      if ((await lstat(dir)).isSymbolicLink()) throw Error('不支持符号链接');
      const file = path.join(dir, r.id + '.json');
      const temp = file + '.tmp';
      await writeFile(temp, JSON.stringify(r, null, 2) + '\n', { flag: 'wx' });
      await rename(temp, file);
    }
    return merged;
  }
  save(batch) {
    return this.exclusive(() => this.saveUnlocked(batch));
  }
  async commit() {
    await this.git('add', '--', 'README.md', ...categories, ':(exclude,glob)**/*.tmp');
    if (await this.git('diff', '--cached', '--name-only'))
      await this.git('commit', '-m', 'Save learning records');
  }
  sync() {
    return this.exclusive(async () => {
      await this.read();
      await this.commit();
      await this.git('fetch', 'origin');
      const branch = await this.git(
        'for-each-ref',
        '--format=%(refname)',
        'refs/remotes/origin/main',
      );
      if (branch) {
        try {
          await this.git('merge', '--no-edit', 'origin/main');
        } catch (e) {
          await this.git('merge', '--abort').catch(() => {});
          throw Error(
            'Git 文件合并失败，本地提交已保留。请先处理数据仓库中的冲突。',
          );
        }
      }
      const records = await this.read();
      try {
        await this.git('push', '-u', 'origin', 'main');
      } catch {
        throw Error(
          '上传失败（网络、权限或另一台电脑刚有更新）。本地提交已保留，请再次点击同步。',
        );
      }
      return { records, commit: await this.git('rev-parse', 'HEAD') };
    });
  }
}
