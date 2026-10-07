import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { resolveContentSource, WORKING_COPY_DIR } from './resolve-source.mjs';
import { readDeploymentPolicy, assertDeploymentAllowed } from './deployment-policy.mjs';

const root = process.cwd();
const production = process.argv.includes('--production');
let resolved = resolveContentSource(root);
if (resolved.mode === 'local') {
  if (production) {
    console.error('[content] Production requires CONTENT_DIR or CONTENT_REPO_URL. No example deployment was generated.');
    process.exit(1);
  }
  process.env.CONTENT_DIR = path.join(root, 'examples/content');
  process.env.SHIRONE_CONTENT_SYNC = '1';
  resolved = resolveContentSource(root);
}
const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
// Keep credentials out of Git URLs, command arguments and .git/config.
if (resolved.source.type === 'git') {
  const url = resolved.source.url;
  if (/^https?:\/\/[^/]*@/.test(url)) {
    console.error('[content] Use a credential-free URL and CONTENT_ACCESS_TOKEN instead of a token in the URL.');
    process.exit(1);
  }
  if (env.CONTENT_ACCESS_TOKEN) {
    if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?\/?$/.test(url)) {
      console.error('[content] CONTENT_ACCESS_TOKEN is only supported for a GitHub HTTPS repository URL.');
      process.exit(1);
    }
    const index = Number(env.GIT_CONFIG_COUNT || '0');
    if (!Number.isSafeInteger(index) || index < 0) throw new Error('Invalid GIT_CONFIG_COUNT');
    env.GIT_CONFIG_COUNT = String(index + 1);
    env[`GIT_CONFIG_KEY_${index}`] = `http.${url}.extraHeader`;
    env[`GIT_CONFIG_VALUE_${index}`] = `AUTHORIZATION: basic ${Buffer.from('x-access-token:' + env.CONTENT_ACCESS_TOKEN).toString('base64')}`;
  }
}
const result = spawnSync(process.execPath, [path.join(root, 'scripts/content/sync.mjs')], { cwd: root, env, stdio: 'inherit' });
if (result.status === 0 && production) {
  try {
    const contentRoot = resolved.source.type === 'path' ? path.resolve(root, resolved.source.path) : path.join(root, WORKING_COPY_DIR);
    assertDeploymentAllowed(await readDeploymentPolicy(contentRoot));
  } catch (error) { console.error('[content] ' + error.message); process.exit(1); }
}
process.exit(result.status ?? 1);
