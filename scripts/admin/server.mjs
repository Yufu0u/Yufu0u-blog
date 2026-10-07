import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { parse } from 'yaml';
import MarkdownIt from 'markdown-it';
import sanitize from 'sanitize-html';
import { resolveContentSource, pathsOverlap } from '../content/resolve-source.mjs';
import { createStore, safePath, AdminError, digest } from './store.mjs';
import { createPublisher } from './publish.mjs';
import { createSettings } from './settings.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true });
const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif' };
const iconNames = ['dashboard', 'edit-note', 'chat-bubble', 'image', 'cloud-upload', 'add', 'search', 'dark-mode', 'light-mode', 'arrow-outward', 'arrow-back', 'close', 'check', 'save', 'schedule', 'article', 'more-horiz', 'delete', 'download', 'format-bold', 'format-italic', 'format-quote', 'code', 'link', 'title', 'list', 'refresh', 'photo-camera', 'location-on', 'push-pin', 'settings-backup-restore', 'folder-open', 'check-circle', 'error', 'menu', 'drag-indicator', 'visibility', 'content-copy', 'keyboard', 'bolt', 'expand-more'];
const rawIcons = require('@iconify-json/material-symbols/icons.json');
function icons() {
  return `<svg class="icon-defs" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs>${iconNames.map(name => {
    const icon = rawIcons.icons[name + '-rounded'] || rawIcons.icons[name + '-outline-rounded'];
    return icon ? `<symbol id="i-${name}" viewBox="0 0 24 24">${icon.body}</symbol>` : '';
  }).join('')}</defs></svg>`;
}
async function body(req, limit) {
  const chunks = []; let length = 0;
  for await (const chunk of req) { length += chunk.length; if (length > limit) throw new AdminError('请求内容超过大小限制。', 413); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
async function jsonBody(req) {
  if (!String(req.headers['content-type']).startsWith('application/json')) throw new AdminError('请求需要 JSON 格式。', 415);
  try { return JSON.parse((await body(req, 3_000_000)).toString('utf8')); } catch (error) { if (error instanceof AdminError) throw error; throw new AdminError('JSON 格式有误。'); }
}
async function yamlConfig(root, name) {
  try { return parse(await fs.readFile(await safePath(root, `config/${name}.yaml`), 'utf8')) ?? {}; }
  catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
}
export async function createAdminServer({ contentRoot, themeRoot, stateRoot, publisherFactory = createPublisher }) {
  contentRoot = await fs.realpath(contentRoot);
  themeRoot = await fs.realpath(themeRoot);
  if (pathsOverlap(contentRoot, themeRoot)) throw new AdminError('内容仓必须与主题仓分离，后台不编辑同步生成物。');
  const store = createStore(contentRoot, stateRoot);
  const publisher = publisherFactory(contentRoot, themeRoot, store);
  const settings = await createSettings(store, themeRoot);
  const csrf = randomBytes(32).toString('hex');
  const session = randomBytes(32).toString('hex');
  const bundle = (await build({ absWorkingDir: path.resolve(here, '../..'), entryPoints: [path.join(here, 'client.js')], bundle: true, format: 'esm', target: 'es2022', write: false, minify: true, logLevel: 'silent' })).outputFiles[0].text;
  const html = (await fs.readFile(path.join(here, 'index.html'), 'utf8')).replace('<!--ICONS-->', icons());
  const css = await fs.readFile(path.join(here, 'style.css'), 'utf8');
  const site = await yamlConfig(contentRoot, 'site');
  const profile = await yamlConfig(contentRoot, 'profile');
  const defaults = await fs.readFile(path.join(themeRoot, 'src/config/siteConfig.ts'), 'utf8').catch(() => '');
  const hue = site.themeColor?.hue ?? Number(defaults.match(/hue:\s*(\d+)/)?.[1] ?? 315);
  const style = site.themeColor?.style ?? defaults.match(/style:\s*"(\w+)"/)?.[1] ?? 'tonalSpot';
  const spec = site.themeColor?.spec ?? defaults.match(/spec:\s*"(\d+)"/)?.[1] ?? '2025';
  const siteUrl = /^https?:\/\//.test(site.site ?? '') ? site.site : '';
  const publicImage = async (req, res, pathname) => {
    const relative = pathname.startsWith('/media/') ? 'public/' + pathname.slice(7) : null;
    const currentProfile = await yamlConfig(contentRoot, 'profile');
    if (!relative || !(relative.startsWith('public/images/') || relative === 'public/' + (currentProfile.avatar ?? '').replace(/^\//, '')) || !mime[path.extname(relative).toLowerCase()]) throw new AdminError('图片不存在。', 404);
    const bytes = await fs.readFile(await safePath(contentRoot, relative));
    res.writeHead(200, { 'Content-Type': mime[path.extname(relative).toLowerCase()], 'Cache-Control': 'no-store' }); res.end(bytes);
  };
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: http: data: blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const send = (data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
    try {
      const address = server.address();
      const expectedHost = `127.0.0.1:${address.port}`;
      if (req.headers.host !== expectedHost) throw new AdminError('请通过 127.0.0.1 的本机后台地址访问。', 403);
      const origin = `http://${expectedHost}`;
      const url = new URL(req.url, origin);
      let pathname;
      try { pathname = decodeURIComponent(url.pathname); } catch { throw new AdminError('URL 编码有误。'); }
      const hasSession = String(req.headers.cookie ?? '').split(';').some(cookie => cookie.trim() === `blog_admin_session=${session}`);
      if ((pathname === '/' || pathname === '/admin/' || pathname === '/admin') && req.method === 'GET') {
        if (req.headers['sec-fetch-site'] === 'cross-site') throw new AdminError('请直接打开本机后台。', 403);
        res.setHeader('Set-Cookie', `blog_admin_session=${session}; HttpOnly; SameSite=Strict; Path=/`);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); return;
      }
      if (!hasSession) throw new AdminError('本机会话已过期，请刷新后台。', 401);
      if (req.method === 'GET' && ['/admin/client.js', '/admin/style.css'].includes(pathname)) {
        const js = pathname.endsWith('.js'); res.writeHead(200, { 'Content-Type': js ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8' }); res.end(js ? bundle : css); return;
      }
      if (req.method === 'GET' && pathname.startsWith('/admin/fonts/')) {
        const name = pathname.slice('/admin/fonts/'.length);
        const font = name === 'yozai.ttf' ? path.join(themeRoot, 'src/assets/fonts/Yozai-Medium.ttf')
          : /^outfit-(400|500|700)\.woff2$/.test(name) ? path.join(themeRoot, 'node_modules/@fontsource/outfit/files', `outfit-latin-${name.match(/\d+/)[0]}-normal.woff2`) : null;
        if (!font) throw new AdminError('字体不存在。', 404);
        const bytes = await fs.readFile(font);
        res.writeHead(200, { 'Content-Type': name.endsWith('.ttf') ? 'font/ttf' : 'font/woff2', 'Cache-Control': 'private, max-age=86400' }); res.end(bytes); return;
      }
      if (req.method === 'GET' && pathname.startsWith('/media/')) { await publicImage(req, res, pathname); return; }
      if (!pathname.startsWith('/api/')) throw new AdminError('页面不存在。', 404);
      if (req.method !== 'GET') {
        const token = Buffer.from(String(req.headers['x-admin-csrf'] ?? ''));
        if (req.headers.origin !== origin || token.length !== csrf.length || !timingSafeEqual(token, Buffer.from(csrf))) throw new AdminError('请求来源或会话无效，请刷新后台。', 403);
        if (publisher.busy && !['/api/preview'].includes(pathname)) throw new AdminError('检查或发布期间暂停修改，请稍后再试。', 409);
      }
      if (req.method === 'GET') {
        if (pathname === '/api/bootstrap') {
          const currentSite = await yamlConfig(contentRoot, 'site'), currentProfile = await yamlConfig(contentRoot, 'profile');
          send({ csrf, title: currentSite.title ?? '写作后台', author: currentProfile.name ?? '博主', avatar: /^\/(?!\/)/.test(currentProfile.avatar ?? '') ? '/media' + currentProfile.avatar : '', siteUrl: /^https?:\/\//.test(currentSite.site ?? '') ? currentSite.site : siteUrl, hue: currentSite.themeColor?.hue ?? hue, style: currentSite.themeColor?.style ?? style, spec: currentSite.themeColor?.spec ?? spec, contentRoot }); return;
        }
        if (pathname === '/api/settings') { send(await settings.list()); return; }
        if (pathname === '/api/setting') { send(await settings.read(url.searchParams.get('name'))); return; }
        if (pathname === '/api/content') { send(await store.list()); return; }
        if (pathname === '/api/item') { send(await store.read(url.searchParams.get('kind'), url.searchParams.get('id'))); return; }
        if (pathname === '/api/media') { send({ items: await store.media() }); return; }
        if (pathname === '/api/backups') { send({ items: await store.backups() }); return; }
        if (pathname === '/api/pending') { send(await publisher.pending({ controlOnly: url.searchParams.get('controlOnly') === 'true' })); return; }
        if (pathname === '/api/job') { send({ job: publisher.status() }); return; }
      }
      if (req.method === 'POST') {
        if (pathname === '/api/upload') {
          const bytes = await body(req, 20 * 1024 * 1024);
          if (publisher.busy) throw new AdminError('检查或发布期间暂停上传。', 409);
          send(await store.upload(bytes, url.searchParams.get('kind'))); return;
        }
        const data = await jsonBody(req);
        if (publisher.busy && pathname !== '/api/preview') throw new AdminError('检查或发布期间暂停修改，请稍后再试。', 409);
        if (pathname === '/api/save') { send(await store.save(data)); return; }
        if (pathname === '/api/settings/save') { send(await settings.save(data)); return; }
        if (pathname === '/api/delete') { send(await store.remove(data)); return; }
        if (pathname === '/api/restore') { send(await store.restore(data.key)); return; }
        if (pathname === '/api/preview') {
          if (typeof data.body !== 'string' || data.body.length > 2_000_000) throw new AdminError('正文格式有误。');
          const rendered = markdown.render(data.body);
          send({ html: sanitize(rendered, { allowedTags: [...sanitize.defaults.allowedTags, 'img', 'del'], allowedAttributes: { ...sanitize.defaults.allowedAttributes, img: ['src', 'alt', 'title'], code: ['class'] }, transformTags: { img: (tagName, attrs) => ({ tagName, attribs: { ...attrs, src: attrs.src?.startsWith('/') && !attrs.src.startsWith('//') ? '/media' + attrs.src : attrs.src } }), a: (tagName, attrs) => ({ tagName, attribs: { ...attrs, target: '_blank', rel: 'noopener noreferrer' } }) } }) }); return;
        }
        if (pathname === '/api/check') { send(publisher.check(), 202); return; }
        if (pathname === '/api/publish') { send(publisher.publish(data), 202); return; }
      }
      throw new AdminError('接口不存在。', 404);
    } catch (error) {
      if (res.headersSent) { res.end(); return; }
      if (error.code === 'ENOENT') send({ error: '文件不存在。' }, 404);
      else if (error instanceof AdminError) send({ error: error.message }, error.status);
      else { console.error('[admin]', error.code || error.name); send({ error: '操作失败，文件未被强制覆盖。请查看本机终端。' }, 500); }
    }
  });
  server.requestTimeout = 60_000;
  server.headersTimeout = 30_000;
  return { server, store, publisher };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const themeRoot = path.resolve(here, '../..');
  const resolved = resolveContentSource(themeRoot);
  if (resolved.source?.type !== 'path') { console.error('[admin] 请在 .env.local 配置 CONTENT_DIR，指向独立的本机私有内容仓。'); process.exit(1); }
  const contentRoot = path.resolve(themeRoot, resolved.source.path);
  const stateRoot = path.join(themeRoot, '.admin-state', digest(contentRoot).slice(0, 16));
  const port = Number(process.env.ADMIN_PORT || 4380);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new AdminError('ADMIN_PORT 应为 1024–65535。');
  const { server } = await createAdminServer({ contentRoot, themeRoot, stateRoot });
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `[admin] ${port} 端口已被占用。可打开已有后台，或通过 ADMIN_PORT 指定另一端口。` : '[admin] 后台启动失败：' + error.message); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}/admin/`;
    console.log(`[admin] 写作后台已启动：${url}\n[admin] 直接编辑本机内容仓；保存不推送。关闭此终端会停止后台。`);
    if (process.argv.includes('--open') && process.platform === 'win32') {
      const child = spawn('explorer.exe', [url], { windowsHide: true, stdio: 'ignore' });
      child.on('error', () => console.log('[admin] 请在浏览器中打开上方地址。'));
    }
  });
  process.on('SIGINT', () => server.close(() => process.exit(0)));
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
}
