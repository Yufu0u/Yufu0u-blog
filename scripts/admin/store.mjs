import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { parseDocument } from 'yaml';
import sharp from 'sharp';
import { managedDocument } from './managed-files.mjs';

export class AdminError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export const digest = value => createHash('sha256').update(value).digest('hex');
const kinds = new Set(['posts', 'moments']);
const imageExtensions = /\.(png|jpe?g|webp|avif|gif)$/i;
const exists = async file => fs.lstat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });

// Check every existing component: junctions and symlinks must not escape the content root.
export async function safePath(root, relative) {
  if (typeof relative !== 'string' || relative.includes('\\') || relative.includes('\0') || path.isAbsolute(relative)
    || relative.split('/').some(s => !s || s === '.' || s === '..' || /[:<>"|?*]/.test(s))) throw new AdminError('文件路径不合法。');
  const absolute = path.resolve(root, relative);
  if (!absolute.startsWith(path.resolve(root) + path.sep)) throw new AdminError('文件超出内容目录。');
  let current = root;
  for (const segment of relative.split('/')) {
    current = path.join(current, segment);
    const stat = await exists(current);
    if (stat?.isSymbolicLink()) throw new AdminError('后台不读写符号链接或目录联接。');
  }
  return absolute;
}

function contentPath(kind, id) {
  if (!kinds.has(kind) || typeof id !== 'string' || !/^[\w/-]+\.(md|mdx)$/.test(id)
    || id.split('/').some(s => /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(s))) throw new AdminError('文件名只允许英文、数字、下划线和短横线，扩展名为 md 或 mdx。');
  if (kind === 'moments' && !id.endsWith('.md')) throw new AdminError('瞬间只支持 Markdown 文件。');
  return `content/${kind}/${id}`;
}

function parseContent(raw) {
  const match = raw.replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!match) throw new AdminError('内容缺少 YAML 元数据，请先修复文件。');
  const document = parseDocument(match[1]);
  if (document.errors.length) throw new AdminError('YAML 元数据格式有误：' + document.errors[0].message);
  const data = document.toJSON();
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new AdminError('元数据必须为对象。');
  return { document, data, body: match[2].replace(/^\r?\n/, '') };
}

function string(value, label, limit = 300) {
  if (typeof value !== 'string' || value.length > limit) throw new AdminError(`${label}格式有误或长度超过 ${limit}。`);
  return value;
}

function published(value, kind) {
  string(value, '发布时间', 40);
  const date = /^\d{4}-\d{2}-\d{2}/.exec(value)?.[0];
  const parsedDate = new Date(date + 'T00:00:00Z');
  if (!date || !Number.isFinite(parsedDate.valueOf()) || parsedDate.toISOString().slice(0, 10) !== date
    || !Number.isFinite(Date.parse(value)) || (kind === 'posts' && value !== date)
    || (kind === 'moments' && value !== date && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})$/.test(value))) throw new AdminError('请填写有效日期；瞬间的精确时间需要包含时区。');
  return value;
}

function validateMetadata(kind, input) {
  if (!input || typeof input !== 'object') throw new AdminError('缺少元数据。');
  const data = { published: published(input.published, kind) };
  for (const key of ['draft', 'pinned']) {
    if (typeof input[key] !== 'boolean') throw new AdminError(`${key} 必须为开关值。`);
    data[key] = input[key];
  }
  if (!Array.isArray(input.tags) || input.tags.length > 40 || input.tags.some(t => typeof t !== 'string' || !t.trim() || t.length > 60)) throw new AdminError('标签最多 40 个，每个不超过 60 字。');
  data.tags = [...new Set(input.tags.map(t => t.trim()))];
  if (kind === 'posts') {
    data.title = string(input.title, '标题').trim();
    if (!data.title) throw new AdminError('请先填写文章标题。');
    for (const key of ['description', 'category', 'image']) data[key] = string(input[key] ?? '', key, key === 'description' ? 1000 : 500);
    data.lang = string(input.lang ?? 'zh_CN', '语言', 30);
    if (typeof input.comment !== 'boolean') throw new AdminError('评论必须为开关值。');
    data.comment = input.comment;
  } else {
    for (const key of ['location', 'mood']) data[key] = string(input[key] ?? '', key);
    if (!Array.isArray(input.images) || input.images.length > 30) throw new AdminError('瞬间最多 30 张图片。');
    data.images = input.images.map(img => ({ src: string(img.src, '图片地址', 1500), alt: string(img.alt ?? '', '图片说明') }));
  }
  return data;
}

export function createStore(contentRoot, stateRoot) {
  let queue = Promise.resolve();
  const serial = fn => { const task = queue.then(fn); queue = task.catch(() => {}); return task; };
  const read = async (kind, id) => {
    const relative = contentPath(kind, id);
    const file = await safePath(contentRoot, relative);
    const raw = await fs.readFile(file, 'utf8').catch(error => { if (error.code === 'ENOENT') throw new AdminError('内容已不存在，请刷新列表。', 404); throw error; });
    const parsed = parseContent(raw);
    const metadata = { draft: false, pinned: false, tags: [], ...(kind === 'posts' ? { description: '', category: '', image: '', lang: 'zh_CN', comment: true } : { location: '', mood: '', images: [] }), ...parsed.data };
    validateMetadata(kind, { ...metadata, category: metadata.category ?? '' });
    return { kind, id, metadata, body: parsed.body, revision: digest(raw), modified: (await fs.stat(file)).mtime.toISOString() };
  };
  const walk = async relative => {
    const folder = await safePath(contentRoot, relative);
    const entries = await fs.readdir(folder, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
    const files = [];
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const rel = `${relative}/${entry.name}`;
      if (entry.isDirectory()) files.push(...await walk(rel));
      else if (entry.isFile()) files.push(rel);
    }
    return files;
  };
  const backup = async (relative, raw, action) => {
    const folder = path.join(stateRoot, 'backups');
    await fs.mkdir(folder, { recursive: true });
    const key = `${Date.now()}-${randomUUID()}`;
    await fs.writeFile(path.join(folder, key + '.json'), JSON.stringify({ relative, raw, action, at: new Date().toISOString() }), { flag: 'wx' });
  };
  const readDocument = async relative => {
    if (!managedDocument(relative)) throw new AdminError('此文件不能通过设置管理。');
    const file = await safePath(contentRoot, relative);
    const raw = await fs.readFile(file, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    return { path: relative, raw: raw ?? '', revision: raw === null ? null : digest(raw) };
  };
  return {
    root: contentRoot,
    read,
    readDocument,
    writeDocument(input) { return serial(async () => {
      const { path: relative, raw, revision } = input;
      string(raw, '配置文本', 2_000_000);
      const current = await readDocument(relative);
      if (current.revision !== revision) throw new AdminError('配置已被其他窗口或编辑器修改，请重新载入后保存。', 409);
      const file = await safePath(contentRoot, relative);
      if (current.revision !== null) await backup(relative, current.raw, 'save');
      await fs.mkdir(path.dirname(file), { recursive: true });
      const temp = path.join(path.dirname(file), `.${randomUUID()}.tmp`);
      try { await fs.writeFile(temp, raw, { flag: 'wx' }); await fs.rename(temp, file); }
      finally { await fs.rm(temp, { force: true }); }
      return readDocument(relative);
    }); },
    async list() {
      const items = [], errors = [];
      for (const kind of kinds) for (const relative of await walk(`content/${kind}`)) {
        if (!/\.(md|mdx)$/.test(relative)) continue;
        const id = relative.slice(`content/${kind}/`.length);
        try { items.push(await read(kind, id)); } catch (error) { errors.push({ kind, id, error: error.message }); }
      }
      items.sort((a, b) => (Date.parse(b.metadata.published) || 0) - (Date.parse(a.metadata.published) || 0));
      return { items, errors };
    },
    save(input) { return serial(async () => {
      const { kind, id, revision, body, metadata } = input;
      string(body, '正文', 2_000_000);
      const values = validateMetadata(kind, metadata);
      const relative = contentPath(kind, id);
      const file = await safePath(contentRoot, relative);
      const previous = await fs.readFile(file, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (previous !== null ? revision !== digest(previous) : revision !== null) throw new AdminError('文件已被其他窗口或编辑器修改。请导出当前正文，再重新打开，避免覆盖。', 409);
      const document = previous === null ? parseDocument('') : parseContent(previous).document;
      for (const [key, value] of Object.entries(values)) document.set(key, value);
      if (kind === 'posts' && previous !== null && !values.draft) {
        const now = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
        document.set('updated', now);
        document.set('updatedAt', new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai', hourCycle: 'h23' }).replace(' ', 'T') + '+08:00');
      }
      if (kind === 'posts' && document.has('publishedAt') && String(document.get('publishedAt')).slice(0, 10) !== values.published) document.delete('publishedAt');
      const raw = `---\n${document.toString({ lineWidth: 0 })}---\n\n${body.replace(/\r\n/g, '\n')}`;
      await fs.mkdir(path.dirname(file), { recursive: true });
      if (previous !== null) await backup(relative, previous, 'save');
      const temp = path.join(path.dirname(file), `.${randomUUID()}.tmp`);
      try { await fs.writeFile(temp, raw, { flag: 'wx' }); await fs.rename(temp, file); }
      finally { await fs.rm(temp, { force: true }); }
      return read(kind, id);
    }); },
    remove(input) { return serial(async () => {
      const { kind, id, revision } = input;
      const current = await read(kind, id);
      if (current.revision !== revision) throw new AdminError('文件已变化，请重新打开后删除。', 409);
      const relative = contentPath(kind, id);
      const file = await safePath(contentRoot, relative);
      await backup(relative, await fs.readFile(file, 'utf8'), 'delete');
      await fs.unlink(file);
      return { ok: true };
    }); },
    async media() {
      const files = (await walk('public/images')).filter(file => imageExtensions.test(file));
      return Promise.all(files.map(async relative => { const stat = await fs.stat(await safePath(contentRoot, relative)); return { url: '/' + relative.slice(7), name: path.basename(relative), bytes: stat.size, modified: stat.mtime.toISOString() }; })).then(items => items.sort((a, b) => b.modified.localeCompare(a.modified)));
    },
    upload(bytes, kind) { return serial(async () => {
      if (!kinds.has(kind)) throw new AdminError('请选择文章或瞬间图片。');
      if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new AdminError('单张图片最大 20 MB。', 413);
      let image, info;
      try {
        image = sharp(bytes, { animated: true, limitInputPixels: 40_000_000 });
        info = await image.metadata();
      } catch { throw new AdminError('无法读取这张图片，请上传 JPG、PNG、WebP、AVIF 或 GIF。'); }
      if (!['jpeg', 'png', 'webp', 'avif', 'gif'].includes(info.format)) throw new AdminError('不支持此图片格式。');
      const animated = (info.pages ?? 1) > 1;
      let result;
      try { result = animated ? bytes : await image.rotate().resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer(); }
      catch { throw new AdminError('图片解码或压缩失败，可能尺寸过大。'); }
      const extension = animated ? (info.format === 'jpeg' ? 'jpg' : info.format) : 'webp';
      const name = `${new Date().toISOString().slice(0, 10)}-${digest(result).slice(0, 16)}.${extension}`;
      const relative = `public/images/${kind}/${name}`;
      const file = await safePath(contentRoot, relative);
      await fs.mkdir(path.dirname(file), { recursive: true });
      try { await fs.writeFile(file, result, { flag: 'wx' }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      return { url: '/' + relative.slice(7), name, bytes: result.length, originalBytes: bytes.length, width: info.width, height: info.height };
    }); },
    async backups() {
      const folder = path.join(stateRoot, 'backups');
      const names = await fs.readdir(folder).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
      const items = await Promise.all(names.filter(n => n.endsWith('.json')).map(async name => { const data = JSON.parse(await fs.readFile(path.join(folder, name), 'utf8')); return { key: name, relative: data.relative, action: data.action, at: data.at }; }));
      return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 100);
    },
    restore(key) { return serial(async () => {
      if (typeof key !== 'string' || !/^\d+-[\da-f-]+\.json$/.test(key)) throw new AdminError('备份编号有误。');
      const data = JSON.parse(await fs.readFile(path.join(stateRoot, 'backups', key), 'utf8'));
      const [, kind, ...segments] = data.relative.split('/');
      const id = segments.join('/');
      if (!managedDocument(data.relative)) contentPath(kind, id);
      const file = await safePath(contentRoot, data.relative);
      const previous = await fs.readFile(file, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (previous !== null) await backup(data.relative, previous, 'restore');
      await fs.mkdir(path.dirname(file), { recursive: true });
      const temp = path.join(path.dirname(file), `.${randomUUID()}.tmp`);
      try { await fs.writeFile(temp, data.raw, { flag: 'wx' }); await fs.rename(temp, file); }
      finally { await fs.rm(temp, { force: true }); }
      return managedDocument(data.relative) ? readDocument(data.relative) : read(kind, id);
    }); },
  };
}
