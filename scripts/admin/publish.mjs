import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AdminError, digest, safePath } from './store.mjs';
import { managedDocument } from './managed-files.mjs';
import { DEFAULT_DEPLOYMENT_POLICY, validateDeploymentPolicy } from '../content/deployment-policy.mjs';

const exec = promisify(execFile);
export const publishable = name => managedDocument(name) || /^(content\/(posts|moments)\/[\w/-]+\.(md|mdx)|public\/images\/[\w/.-]+\.(png|jpe?g|webp|avif|gif))$/i.test(name);
const scrub = value => String(value).replace(/\x1b\[[\d;]*m/g, '').replace(/(https?:\/\/)[^/\s@]+@/g, '$1***@').replace(/(?:github_pat_|gh[pousr]_)[\w]+/g, '[credential]');

export function createPublisher(root, themeRoot, store) {
  let job = null;
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never', GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND || 'ssh -o BatchMode=yes', CONTENT_DIR: root };
  const run = async (command, args, cwd = root, timeout = 120_000) => {
    try { return (await exec(command, args, { cwd, env, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout, windowsHide: true })).stdout; }
    catch (error) { throw new AdminError(scrub(error.stderr || error.stdout || error.message).slice(-5000), 400); }
  };
  const git = (...args) => run('git', args);
  const policy = async () => {
    const file = await store.readDocument('deployment.json');
    try { return file.revision === null ? { ...DEFAULT_DEPLOYMENT_POLICY } : validateDeploymentPolicy(JSON.parse(file.raw)); }
    catch (error) { throw new AdminError(error.message); }
  };
  const pending = async ({ controlOnly = false } = {}) => {
    const tracked = (await git('diff', '--name-only', '-z', 'HEAD', '--')).split('\0').filter(Boolean);
    const untracked = (await git('ls-files', '--others', '--exclude-standard', '-z')).split('\0').filter(Boolean);
    const eligible = name => controlOnly ? name === 'deployment.json' : publishable(name);
    const files = [...new Set([...tracked, ...untracked])].filter(eligible).sort();
    const entries = [];
    for (const file of files) {
      const absolute = await safePath(root, file);
      const bytes = await fs.readFile(absolute).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      entries.push({ path: file, status: bytes === null ? 'deleted' : untracked.includes(file) ? 'added' : 'modified', bytes: bytes?.length ?? 0, hash: bytes === null ? 'deleted' : digest(bytes) });
    }
    const head = (await git('rev-parse', 'HEAD')).trim();
    const branch = (await git('branch', '--show-current')).trim();
    const remote = (await git('remote', 'get-url', 'origin')).trim();
    // Never send credentials to the UI, or publish a repository embedded in the theme checkout.
    if (/^https?:\/\/[^/]*@/.test(remote)) throw new AdminError('origin 含内嵌凭证，请改用 SSH 或 Git 凭据管理器。');
    const ahead = Number((await git('rev-list', '--count', 'origin/main..HEAD').catch(() => '0')).trim());
    const deployment = await policy();
    let remoteDeployment = { ...DEFAULT_DEPLOYMENT_POLICY };
    const remoteRaw = await git('show', 'origin/main:deployment.json').catch(() => null);
    if (remoteRaw !== null) { try { remoteDeployment = validateDeploymentPolicy(JSON.parse(remoteRaw)); } catch { remoteDeployment = null; } }
    return { entries, branch, remote: scrub(remote), head, ahead, deployment, remoteDeployment, controlOnly, fingerprint: digest(JSON.stringify({ head, branch, remote, entries, deployment, controlOnly })) };
  };
  const validate = async () => {
    const content = await store.list();
    if (content.errors.length) throw new AdminError('内容文件存在错误：' + content.errors.map(e => e.id + '：' + e.error).join('\n'));
    const steps = [
      ['同步内容（本机检查）', 'scripts/content/prepare.mjs'],
      ['检查内容与类型', 'node_modules/astro/bin/astro.mjs', 'check'],
      ['生成图标', 'scripts/icons/generate-local-icons.mjs'],
      ['处理瞬间图片', 'scripts/images/generate-moment-thumbnails.mjs'],
      ['构建生产网站', 'node_modules/astro/bin/astro.mjs', 'build'],
      ['生成搜索索引', 'node_modules/pagefind/lib/runner/bin.cjs', '--site', 'dist'],
      ['检查构建结果', 'scripts/verify-build.mjs'],
    ];
    for (const [label, file, ...args] of steps) {
      job.step = label;
      job.log.push(label + '…');
      const output = await run(process.execPath, [path.join(themeRoot, file), ...args], themeRoot, 300_000);
      job.log.push(scrub(output).slice(-2500));
    }
  };
  const launch = (type, task) => {
    if (job?.status === 'running') throw new AdminError('已有检查或发布任务正在运行。', 409);
    job = { id: Date.now().toString(), type, status: 'running', step: '准备', log: [], started: new Date().toISOString() };
    const current = job;
    task().then(result => { current.status = 'success'; current.result = result; current.step = '完成'; })
      .catch(error => { current.status = 'error'; current.error = error.message; current.step = '未完成'; });
    return { ...current };
  };
  return {
    pending,
    get busy() { return job?.status === 'running'; },
    status: () => job,
    check: () => launch('check', async () => { await validate(); return { message: '检查与生产构建通过，可以推送。' }; }),
    publish(input) {
      return launch('publish', async () => {
        const controlOnly = input.controlOnly === true;
        let plan = await pending({ controlOnly });
        if (!controlOnly && plan.deployment.locked) throw new AdminError('部署已锁定，文章与配置暂时不能推送。请在部署管理中解除锁定；仍可本地编辑和检查。', 423);
        if (input.fingerprint !== plan.fingerprint) throw new AdminError('待发布内容已变化，请重新查看发布清单。', 409);
        if (plan.branch !== 'main') throw new AdminError('请切换到内容仓 main 分支后发布。');
        if (!plan.entries.length && !plan.ahead) throw new AdminError('没有待推送的修改。');
        if ((await git('diff', '--cached', '--name-only')).trim()) throw new AdminError('内容仓存在已暂存修改，请先在 Git 中处理，防止混入其他内容。');
        // Reject a public theme remote: private content must never be pushed there.
        const themeRemote = (await run('git', ['remote', 'get-url', 'origin'], themeRoot)).trim();
        const canonical = url => url.toLowerCase().replace(/^git@([^:]+):/, 'https://$1/').replace(/\.git\/?$/, '').replace(/\/$/, '');
        if (canonical(themeRemote) === canonical(plan.remote)) throw new AdminError('内容仓和主题仓 origin 相同，已停止发布。');
        job.step = '检查远端分支';
        await git('fetch', 'origin', 'main');
        const behind = Number((await git('rev-list', '--count', 'HEAD..origin/main')).trim());
        if (behind) throw new AdminError('远端有尚未同步的提交，请先在内容仓执行 git pull --ff-only 并检查修改，然后重试。');
        if (!controlOnly) {
          const remotePolicy = await git('show', 'origin/main:deployment.json').catch(() => null);
          if (remotePolicy !== null && validateDeploymentPolicy(JSON.parse(remotePolicy)).locked) throw new AdminError('远端部署仍已锁定，请先在部署管理中单独同步解锁状态，再推送文章与配置。', 423);
        }
        // A failed push can be retried; refuse to upload unrelated previous commits.
        const outgoing = (await git('log', '--format=', '--name-only', '--no-renames', 'origin/main..HEAD')).trim().split('\n').filter(Boolean);
        if (outgoing.some(file => controlOnly ? file !== 'deployment.json' : !publishable(file))) throw new AdminError('未推送提交还包含其他配置或文件，请通过 Git 手动检查并发布。');
        if (!controlOnly) await validate();
        const current = await pending({ controlOnly });
        if (current.fingerprint !== plan.fingerprint) throw new AdminError('检查期间内容被外部修改，请重新查看清单后发布。', 409);
        if ((await git('diff', '--cached', '--name-only')).trim()) throw new AdminError('检查期间暂存区发生变化，请先处理。');
        if (plan.entries.length) {
          job.step = '提交内容';
          const message = typeof input.message === 'string' && input.message.trim() ? input.message.trim().slice(0, 200) : controlOnly ? 'deploy: update deployment policy' : 'content: update content and settings';
          const paths = plan.entries.map(e => e.path);
          await git('add', '-A', '--', ...paths);
          try { await git('commit', '--only', '-m', message, '--', ...paths); }
          catch (error) { await git('reset', '--', ...paths); throw error; }
        }
        job.step = '推送私有内容仓';
        const committed = (await git('rev-parse', 'HEAD')).trim();
        try { await git('push', 'origin', 'HEAD:main'); }
        catch (error) { throw new AdminError('本地提交已保留，推送未完成。修复网络或 Git 登录后可重试。\n' + error.message); }
        return { commit: committed, message: plan.deployment.locked || !plan.deployment.autoDeploy ? '已推送到私有内容仓，部署暂停或锁定中；不会触发新的生产构建。' : '已推送内容仓，EdgeOne 自动构建由现有 Hook 触发。线上结果请在 EdgeOne 查看。' };
      });
    },
  };
}
