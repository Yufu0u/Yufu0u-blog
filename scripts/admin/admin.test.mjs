import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { request } from 'node:http';
import sharp from 'sharp';
import { createStore, safePath } from './store.mjs';
import { createAdminServer } from './server.mjs';
import { createPublisher } from './publish.mjs';
import { createSettings, validateSchema } from './settings.mjs';
import { readDeploymentPolicy, assertDeploymentAllowed } from '../content/deployment-policy.mjs';

async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'blog-admin-test-'));
  const root = path.join(base, 'content'), theme = path.join(base, 'theme'), state = path.join(base, 'state');
  await fs.mkdir(path.join(root, 'content/posts'), { recursive: true });
  await fs.mkdir(path.join(root, 'content/moments'), { recursive: true });
  await fs.mkdir(path.join(theme, 'src/config'), { recursive: true });
  await fs.writeFile(path.join(theme, 'src/config/siteConfig.ts'), 'const config = { themeColor: { hue: 315, style: "tonalSpot", spec: "2025" } };');
  t.after(async () => { // Verify the recursive cleanup target is the fixture created in this test.
    assert.ok(path.resolve(base).startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(base).startsWith('blog-admin-test-'));
    await fs.rm(base, { recursive: true, force: true });
  });
  return { root, theme, state, base, store: createStore(root, state) };
}
const input = (kind = 'posts', id = 'new.md') => ({ kind, id, revision: null, body: '## 记录\n\n正文。\n', metadata: { published: kind === 'posts' ? '2026-10-06' : '2026-10-06T15:00:00+08:00', draft: true, pinned: false, tags: ['笔记'], ...(kind === 'posts' ? { title: '标题：测试', category: '学习日志', description: '引号 " 和冒号：', image: '', lang: 'zh_CN', comment: true } : { images: [], location: '', mood: '' }) } });

test('CRUD preserves unknown frontmatter and comments, rejects conflicting edits, and restores deleted content', async t => {
  const { store, root } = await fixture(t);
  await fs.writeFile(path.join(root, 'content/posts/original.md'), '---\ntitle: 原标题 # 保留注释\npublished: 2026-10-02\nseries: robotics\nseriesOrder: 3\npermalink: /original/\ndraft: false\n---\n\n原正文\n');
  const original = await store.read('posts', 'original.md');
  const data = input('posts', 'original.md'); data.revision = original.revision;
  const saved = await store.save(data);
  const raw = await fs.readFile(path.join(root, 'content/posts/original.md'), 'utf8');
  assert.match(raw, /保留注释/); assert.equal(saved.metadata.series, 'robotics'); assert.equal(saved.metadata.permalink, '/original/');
  await assert.rejects(store.save(data), error => error.status === 409);
  await assert.rejects(store.save({ ...data, revision: null }), error => error.status === 409);
  await assert.rejects(store.remove({ kind: 'posts', id: saved.id, revision: original.revision }), error => error.status === 409);
  await store.remove({ kind: 'posts', id: saved.id, revision: saved.revision });
  await assert.rejects(store.read('posts', saved.id), error => error.status === 404);
  const backup = (await store.backups()).find(item => item.action === 'delete');
  const restored = await store.restore(backup.key); assert.equal(restored.body, saved.body);
  assert.equal((await store.list()).items.length, 1);
});

test('writes real post/moment metadata, validates dates, and serializes competing creates', async t => {
  const { store } = await fixture(t);
  const candidates = await Promise.allSettled([store.save(input()), store.save(input())]);
  assert.equal(candidates.filter(r => r.status === 'fulfilled').length, 1);
  const moment = await store.save(input('moments'));
  assert.equal(moment.metadata.published, '2026-10-06T15:00:00+08:00');
  assert.deepEqual(moment.metadata.images, []);
  for (const date of ['2026-02-30', 'nonsense', '2026-99-99']) await assert.rejects(store.save({ ...input('posts', 'invalid.md'), metadata: { ...input().metadata, published: date } }), error => error.status === 400);
  await assert.rejects(store.save({ ...input(), id: '../outside.md' }), error => error.status === 400);
  await assert.rejects(store.save({ ...input(), id: 'CON.md' }), error => error.status === 400);
});

test('path traversal and directory junctions cannot read or write outside content', async t => {
  const { root, base } = await fixture(t);
  await assert.rejects(safePath(root, '../secret.txt'));
  await assert.rejects(safePath(root, 'public/images/../../secret.txt'));
  await assert.rejects(safePath(root, 'C:\\secret.txt'));
  const outside = path.join(base, 'outside'); await fs.mkdir(outside);
  await fs.symlink(outside, path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(safePath(root, 'linked/file.txt'), /符号链接/);
});

test('uploads resize and deduplicate actual images; animated GIF is preserved; invalid data is rejected', async t => {
  const { store, root } = await fixture(t);
  const image = await sharp({ create: { width: 2400, height: 1200, channels: 3, background: '#795087' } }).png().toBuffer();
  const a = await store.upload(image, 'posts'), b = await store.upload(image, 'posts');
  assert.equal(a.url, b.url); assert.match(a.url, /^\/images\/posts\/.+\.webp$/);
  const metadata = await sharp(await fs.readFile(path.join(root, 'public', a.url))).metadata();
  assert.equal(metadata.width, 2000); assert.equal(metadata.height, 1000);
  assert.equal((await store.media()).length, 1);
  const gif = await sharp(Buffer.concat([Buffer.alloc(12, 80), Buffer.alloc(12, 230)]), { raw: { width: 2, height: 4, channels: 3, pageHeight: 2 } }).gif({ loop: 0, delay: [100, 100] }).toBuffer();
  const animated = await store.upload(gif, 'moments'); assert.ok(animated.url.endsWith('.gif'));
  await assert.rejects(store.upload(Buffer.from('<svg><script/></svg>'), 'posts'));
  await assert.rejects(store.upload(Buffer.alloc(20 * 1024 * 1024 + 1), 'posts'), error => error.status === 413);
});

test('HTTP APIs require local Host, session and CSRF; previews do not execute embedded HTML', async t => {
  const { root, theme, state } = await fixture(t);
  const fake = { busy: false, pending: async () => ({}), status: () => null };
  const { server } = await createAdminServer({ contentRoot: root, themeRoot: theme, stateRoot: state, publisherFactory: () => fake });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(origin + '/api/content')).status, 401);
  const badHostStatus = await new Promise((resolve, reject) => { const req = request(origin + '/admin/', { headers: { Host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode); }); req.on('error', reject); req.end(); });
  assert.equal(badHostStatus, 403);
  const page = await fetch(origin + '/admin/'); assert.equal(page.status, 200);
  const cookie = page.headers.get('set-cookie').split(';')[0];
  const boot = await (await fetch(origin + '/api/bootstrap', { headers: { Cookie: cookie } })).json();
  assert.equal((await fetch(origin + '/api/save', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(input()) })).status, 403);
  const headers = { Cookie: cookie, Origin: origin, 'X-Admin-CSRF': boot.csrf, 'Content-Type': 'application/json' };
  const preview = await (await fetch(origin + '/api/preview', { method: 'POST', headers, body: JSON.stringify({ body: '<script>alert(1)</script>\n\n![图](/images/demo.png)\n\n[x](javascript:alert(1))' }) })).json();
  assert.doesNotMatch(preview.html, /<script|href="javascript:/); assert.match(preview.html, /\/media\/images\/demo.png/);
  const saved = await fetch(origin + '/api/save', { method: 'POST', headers, body: JSON.stringify(input()) }); assert.equal(saved.status, 200);
  fake.busy = true;
  assert.equal((await fetch(origin + '/api/save', { method: 'POST', headers, body: JSON.stringify(input('posts', 'another.md')) })).status, 409);
  assert.equal((await fetch(origin + '/media/../.env', { headers: { Cookie: cookie } })).status, 404);
});

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
async function waitJob(publisher) {
  const deadline = Date.now() + 30_000;
  while (publisher.busy && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 30));
  assert.notEqual(publisher.status().status, 'running'); return publisher.status();
}
async function gitFixture(t) {
  const fixtureData = await fixture(t); const { root, theme, base, store } = fixtureData;
  const remote = path.join(base, 'remote.git'); await fs.mkdir(remote); git(remote, 'init', '--bare', '--initial-branch=main');
  git(root, 'init', '--initial-branch=main'); git(root, 'config', 'user.name', 'Admin Test'); git(root, 'config', 'user.email', 'admin@example.invalid');
  await store.save(input('posts', 'existing.md')); await fs.writeFile(path.join(root, 'README.md'), 'original');
  git(root, 'add', '.'); git(root, 'commit', '-m', 'initial'); git(root, 'remote', 'add', 'origin', remote); git(root, 'push', '-u', 'origin', 'main');
  git(theme, 'init', '--initial-branch=main'); git(theme, 'remote', 'add', 'origin', 'https://example.invalid/theme.git');
  // Isolate Git transport tests from the real site's build. Actual site build is verified separately.
  const files = ['scripts/content/prepare.mjs', 'node_modules/astro/bin/astro.mjs', 'scripts/icons/generate-local-icons.mjs', 'scripts/images/generate-moment-thumbnails.mjs', 'node_modules/pagefind/lib/runner/bin.cjs', 'scripts/verify-build.mjs'];
  for (const file of files) { await fs.mkdir(path.dirname(path.join(theme, file)), { recursive: true }); await fs.writeFile(path.join(theme, file), 'console.log("fixture build passed")'); }
  return { ...fixtureData, remote, publisher: createPublisher(root, theme, store) };
}

test('reviewed publishing commits new/deleted files to a local bare remote and leaves unrelated changes out', async t => {
  const { root, remote, store, publisher } = await gitFixture(t);
  await store.save(input('moments', 'new-moment.md'));
  const original = await store.read('posts', 'existing.md'); await store.remove({ ...original });
  await fs.writeFile(path.join(root, 'README.md'), 'private unrelated changes');
  const plan = await publisher.pending(); assert.equal(plan.entries.length, 2);
  publisher.publish({ fingerprint: plan.fingerprint, message: 'content: fixture publish' });
  const job = await waitJob(publisher); assert.equal(job.status, 'success', job.error);
  assert.match(git(remote, 'ls-tree', '-r', '--name-only', 'main'), /new-moment.md/);
  assert.doesNotMatch(git(remote, 'ls-tree', '-r', '--name-only', 'main'), /existing.md/);
  assert.equal(git(remote, 'show', 'main:README.md'), 'original');
  assert.match(git(root, 'status', '--short'), /README.md/);
  assert.equal(git(root, 'diff', '--cached', '--name-only'), '');
});

test('publishing refuses stale review, staged changes and a remote that has advanced', async t => {
  const { root, base, remote, store, publisher } = await gitFixture(t);
  await store.save(input('posts', 'new.md')); const stale = await publisher.pending();
  await store.save(input('moments', 'after-review.md'));
  publisher.publish({ fingerprint: stale.fingerprint }); assert.match((await waitJob(publisher)).error, /已变化/);
  git(root, 'add', 'content/posts/new.md');
  publisher.publish({ fingerprint: (await publisher.pending()).fingerprint }); assert.match((await waitJob(publisher)).error, /暂存/);
  git(root, 'reset');
  const other = path.join(base, 'other'); git(base, 'clone', remote, other); git(other, 'config', 'user.name', 'Other'); git(other, 'config', 'user.email', 'other@example.invalid');
  await fs.writeFile(path.join(other, 'README.md'), 'changed remotely'); git(other, 'add', '.'); git(other, 'commit', '-m', 'remote update'); git(other, 'push');
  publisher.publish({ fingerprint: (await publisher.pending()).fingerprint }); assert.match((await waitJob(publisher)).error, /远端/);
  assert.equal(git(root, 'log', '-1', '--format=%s'), 'initial');
});

test('retry refuses unrelated outgoing history even when later commits revert the file', async t => {
  const { root, publisher } = await gitFixture(t);
  await fs.writeFile(path.join(root, 'README.md'), 'unrelated change');
  git(root, 'add', 'README.md'); git(root, 'commit', '-m', 'unrelated edit');
  await fs.writeFile(path.join(root, 'README.md'), 'original');
  git(root, 'add', 'README.md'); git(root, 'commit', '-m', 'revert unrelated edit');
  const plan = await publisher.pending(); assert.equal(plan.entries.length, 0); assert.equal(plan.ahead, 2);
  publisher.publish({ fingerprint: plan.fingerprint });
  assert.match((await waitJob(publisher)).error, /其他配置或文件/);
  assert.equal(git(root, 'rev-parse', 'origin/main'), git(root, 'rev-parse', 'HEAD~2'));
});

test('settings preserve YAML comments and inherited defaults, back up edits and reject conflicts', async t => {
  const { root, theme, store } = await fixture(t);
  await fs.mkdir(path.join(root, 'config'), { recursive: true });
  await fs.writeFile(path.join(root, 'config/profile.yaml'), 'name: 原名称 # 保留名称注释\nbio: 原简介\n');
  const settings = await createSettings(store, theme);
  const entry = await settings.read('profile');
  const changed = { ...entry.data, name: '新名称' };
  const saved = await settings.save({ name: 'profile', revision: entry.revision, data: changed });
  assert.match(saved.raw, /保留名称注释/); assert.equal(saved.data.name, '新名称');
  await assert.rejects(settings.save({ name: 'profile', revision: entry.revision, data: changed }), e => e.status === 409);
  const version = (await store.backups()).find(item => item.relative === 'config/profile.yaml');
  await store.restore(version.key);
  assert.equal((await settings.read('profile')).data.name, '原名称');
  const original = await settings.read('site');
  await assert.rejects(settings.save({ name: 'site', revision: original.revision, raw: 'unknownProperty: true\n' }), /不在网站配置契约/);
  await assert.rejects(settings.save({ name: 'site', revision: original.revision, raw: 'title: 123\n' }), /string/);
  await assert.rejects(settings.save({ name: 'sidebar', revision: null, raw: 'enable: "true"\n' }), /boolean/);
  await assert.rejects(settings.save({ name: 'site', revision: original.revision, raw: 'title:\n' }), /空值/);
});

test('settings write page text and footer HTML only through managed paths', async t => {
  const { store, theme } = await fixture(t);
  const settings = await createSettings(store, theme);
  for (const [name, raw] of [['about-content', '## 我是谁\n\n新介绍。'], ['footer-content', '<p>公开页脚</p>']]) {
    const entry = await settings.read(name);
    const saved = await settings.save({ name, revision: entry.revision, raw });
    assert.equal(saved.raw, raw);
  }
  await assert.rejects(settings.read('../.env'), e => e.status === 404);
  await assert.rejects(store.writeDocument({ path: '.github/workflows/trigger-edgeone.yml', revision: null, raw: 'no' }));
  await assert.rejects(store.readDocument('config/../../secret.yaml'));
});

test('malformed settings remain editable as raw YAML without a silent form overwrite', async t => {
  const { root, theme, store } = await fixture(t);
  await fs.mkdir(path.join(root, 'config'), { recursive: true });
  await fs.writeFile(path.join(root, 'config/profile.yaml'), 'name: [broken');
  const settings = await createSettings(store, theme);
  const current = await settings.read('profile');
  assert.match(current.error, /YAML/); assert.equal(current.raw, 'name: [broken');
  await assert.rejects(settings.save({ name: 'profile', revision: current.revision, data: { name: 'overwrite' } }), /修复/);
  const saved = await settings.save({ name: 'profile', revision: current.revision, raw: 'name: 已修复\n' });
  assert.equal(saved.data.name, '已修复'); assert.equal(saved.error, undefined);
});

test('all real effective settings use the existing TypeScript schema and minimal partial writes', async t => {
  const { store, root } = await fixture(t);
  const realTheme = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'));
  const settings = await createSettings(store, realTheme);
  for (const entry of (await settings.list()).entries) {
    const item = await settings.read(entry.name);
    validateSchema(item.schema, item.data, entry.name);
  }
  await fs.mkdir(path.join(root, 'config'), { recursive: true });
  await fs.writeFile(path.join(root, 'config/site.yaml'), 'title: 原标题 # 保留注释\n');
  const entry = await settings.read('site');
  await settings.save({ name: 'site', revision: entry.revision, data: { ...entry.data, title: '新标题' } });
  const raw = await fs.readFile(path.join(root, 'config/site.yaml'), 'utf8');
  assert.match(raw, /保留注释/); assert.doesNotMatch(raw, /banner:|themeColor:/);
});

test('deployment policy defaults to enabled, fails closed on invalid data, and blocks production', async t => {
  const { root, store, theme } = await fixture(t);
  assert.equal((await readDeploymentPolicy(root)).autoDeploy, true);
  const settings = await createSettings(store, theme);
  const entry = await settings.read('deployment');
  await settings.save({ name: 'deployment', revision: entry.revision, data: { autoDeploy: true, locked: true, reason: '维护' } });
  const policy = await readDeploymentPolicy(root);
  assert.throws(() => assertDeploymentAllowed(policy), /锁定/);
  assert.throws(() => assertDeploymentAllowed({ autoDeploy: false, locked: false, reason: '' }), /暂停/);
  await assert.rejects(settings.save({ name: 'deployment', revision: (await settings.read('deployment')).revision, data: { autoDeploy: 'false', locked: false, reason: '' } }), /格式/);
  await fs.writeFile(path.join(root, 'deployment.json'), '{broken');
  await assert.rejects(readDeploymentPolicy(root));
});

test('publishing includes reviewed settings and page text while refusing workflow and credential files', async t => {
  const { store, root, theme, publisher, remote } = await gitFixture(t);
  const settings = await createSettings(store, theme);
  await settings.save({ name: 'profile', revision: null, raw: 'name: 新博主\nbio: 新介绍\n' });
  await settings.save({ name: 'about-content', revision: null, raw: '## 新的关于页' });
  await fs.writeFile(path.join(root, '.env'), 'PRIVATE=must-stay-local');
  const plan = await publisher.pending();
  assert.deepEqual(plan.entries.map(item => item.path), ['config/profile.yaml', 'content/spec/about.md']);
  publisher.publish({ fingerprint: plan.fingerprint });
  const result = await waitJob(publisher); assert.equal(result.status, 'success', result.error);
  assert.match(git(remote, 'show', 'main:config/profile.yaml'), /新博主/);
  assert.doesNotMatch(git(remote, 'ls-tree', '-r', '--name-only', 'main'), /\.env/);
});

test('locked deployment refuses normal pushes but syncs only policy and supports unlocking', async t => {
  const { store, root, theme, publisher, remote } = await gitFixture(t);
  const settings = await createSettings(store, theme);
  await settings.save({ name: 'deployment', revision: null, data: { autoDeploy: true, locked: true, reason: '维护' } });
  await store.save(input('posts', 'unsent.md'));
  publisher.publish({ fingerprint: (await publisher.pending()).fingerprint });
  assert.match((await waitJob(publisher)).error, /锁定/);
  const plan = await publisher.pending({ controlOnly: true }); assert.deepEqual(plan.entries.map(item => item.path), ['deployment.json']);
  publisher.publish({ controlOnly: true, fingerprint: plan.fingerprint });
  let result = await waitJob(publisher); assert.equal(result.status, 'success', result.error);
  assert.equal(JSON.parse(git(remote, 'show', 'main:deployment.json')).locked, true);
  assert.doesNotMatch(git(remote, 'ls-tree', '-r', '--name-only', 'main'), /unsent.md/);
  assert.match(git(root, 'status', '--short'), /unsent.md/);
  const entry = await settings.read('deployment');
  await settings.save({ name: 'deployment', revision: entry.revision, data: { autoDeploy: true, locked: false, reason: '' } });
  publisher.publish({ fingerprint: (await publisher.pending()).fingerprint });
  assert.match((await waitJob(publisher)).error, /远端部署仍已锁定/);
  publisher.publish({ controlOnly: true, fingerprint: (await publisher.pending({ controlOnly: true })).fingerprint });
  result = await waitJob(publisher); assert.equal(result.status, 'success', result.error);
  assert.equal(JSON.parse(git(remote, 'show', 'main:deployment.json')).locked, false);
});
