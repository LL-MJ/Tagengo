import { test } from 'node:test';
import { request } from 'node:http';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { GitStore } from '../scripts/git-store.mjs';
import { createGitApi } from '../scripts/git-api.mjs';
import { blank, revise, heads } from '../lib/records.ts';
const run = promisify(execFile);
async function git(cwd, ...args) {
  return (
    await run('git', ['-c', `safe.directory=${cwd}`, ...args], {
      cwd,
      windowsHide: true,
    })
  ).stdout.trim();
}
async function fixtures() {
  const output = path.resolve('outputs');
  await mkdir(output, { recursive: true });
  const root = await mkdtemp(path.join(output, 'git-test-'));
  const remote = path.join(root, 'remote.git');
  await git(root, 'init', '--bare', '--initial-branch=main', remote);
  const stores = [];
  for (const name of ['pc-a', 'pc-b']) {
    const dir = path.join(root, name);
    await git(root, 'clone', remote, dir);
    await git(dir, 'config', 'user.name', 'Tagengo test');
    await git(dir, 'config', 'user.email', 'test@example.invalid');
    stores.push(new GitStore(dir, remote));
  }
  return { stores, root };
}
test('real Git roundtrip: empty repo, offline edits, semantic conflict, resolution, delete', async () => {
  const {
    stores: [a, b],
  } = await fixtures();
  await a.initialize();
  await a.sync();
  await git(b.directory, 'fetch', 'origin');
  await git(b.directory, 'checkout', '-B', 'main', 'origin/main');
  await b.initialize();
  const first = revise(
    { ...blank('words'), title: '食べる', meaning: '吃' },
    [],
  );
  await a.save([first]);
  await a.sync();
  assert.equal((await b.sync()).records.length, 1);
  const left = revise({ ...first.entry, meaning: '吃饭' }, [first.id]),
    right = revise({ ...first.entry, meaning: '进食' }, [first.id]);
  await a.save([left]);
  await b.save([right]);
  await a.sync();
  const merged = (await b.sync()).records;
  assert.equal(heads(merged).get(first.entry.id).length, 2);
  assert.equal((await a.sync()).records.length, 3);
  const resolved = revise(left.entry, [left.id, right.id]);
  await b.save([resolved]);
  await b.sync();
  assert.equal(heads((await a.sync()).records).get(first.entry.id).length, 1);
  const deleted = revise({ ...resolved.entry, deleted: true }, [resolved.id]);
  await a.save([deleted]);
  await a.sync();
  assert.equal(
    heads((await b.sync()).records).get(first.entry.id)[0].entry.deleted,
    true,
  );
  const before = await git(b.directory, 'rev-parse', 'HEAD');
  await b.sync();
  assert.equal(await git(b.directory, 'rev-parse', 'HEAD'), before);
});
test('validation rejects malformed batch before writing and protects existing revision files', async () => {
  const {
    stores: [a],
  } = await fixtures();
  await a.initialize();
  const r = revise({ ...blank('grammar'), title: '〜たい' }, []);
  await assert.rejects(a.save([r, { ...r, id: '../../escape' }]));
  assert.equal((await a.read()).length, 0);
  await a.save([r]);
  await assert.rejects(
    a.save([{ ...r, entry: { ...r.entry, title: 'changed' } }]),
  );
  assert.equal((await a.read())[0].entry.title, '〜たい');
  const file = path.join(a.directory, 'grammar', r.entry.id, r.id + '.json');
  assert.equal(JSON.parse(await readFile(file, 'utf8')).entry.title, '〜たい');
  await git(
    a.directory,
    'remote',
    'set-url',
    'origin',
    'https://github.com/not-the-requested/repo.git',
  );
  await assert.rejects(a.save([r]), /origin/);
});
test('failed upload preserves local commits and can be retried', async () => {
  const {
    stores: [a],
  } = await fixtures();
  await a.initialize();
  const r = revise({ ...blank('words'), title: '見る' }, []);
  await a.save([r]);
  const original = a.git.bind(a);
  a.git = async (...args) => {
    if (args[0] === 'push') throw Error('network down');
    return original(...args);
  };
  await assert.rejects(a.sync(), /本地提交已保留/);
  assert.equal((await a.read()).length, 1);
  assert.ok(await original('rev-parse', 'HEAD'));
  a.git = original;
  await a.sync();
});
function httpFetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      { method: options.method || 'GET', headers: options.headers },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            json: async () => JSON.parse(Buffer.concat(chunks).toString()),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end(options.body);
  });
}
test('local API rejects foreign origins, rebinding hosts and missing tokens', async () => {
  const store = {
    directory: 'test',
    exclusive: (fn) => fn(),
    read: async () => [],
    save: async (r) => r,
    sync: async () => ({ records: [] }),
  };
  const server = createGitApi(store);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/git/`;
  try {
    assert.equal(
      (await httpFetch(url + 'state', { headers: { Host: 'evil.example' } }))
        .status,
      403,
    );
    assert.equal(
      (
        await httpFetch(url + 'state', {
          headers: { Host: 'localhost:3000', Origin: 'https://evil.example' },
        })
      ).status,
      403,
    );
    const state = await (
      await httpFetch(url + 'state', { headers: { Host: 'localhost:3000' } })
    ).json();
    assert.ok(state.token);
    assert.equal(
      (
        await httpFetch(url + 'sync', {
          method: 'POST',
          headers: {
            Host: 'localhost:3000',
            'Content-Type': 'application/json',
          },
          body: '{}',
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await httpFetch(url + 'sync', {
          method: 'POST',
          headers: {
            Host: 'localhost:3000',
            Origin: 'http://localhost:3000',
            'Content-Type': 'application/json',
            'X-Tagengo-Token': state.token,
          },
          body: '{}',
        })
      ).status,
      200,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
