import fs from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { parseDocument } from 'yaml';
import { CONFIG_DOMAINS } from '../content/config-domains.mjs';
import { createConfigSchemas } from '../content/generate-config-schemas.mjs';
import { DEFAULT_DEPLOYMENT_POLICY, validateDeploymentPolicy } from '../content/deployment-policy.mjs';
import { AdminError } from './store.mjs';

const labels = { site: '站点与首页', profile: '博主资料', sidebar: '侧栏布局', announcement: '公告', about: '关于页设置', moments: '瞬间页面', skills: '技能页面', projects: '项目页面', timeline: '时间线', devices: '设备展示', games: '游戏展示', friends: '友链', albums: '相册', anime: '番剧收藏', compass: '站点罗盘', series: '文章系列', music: '音乐播放器', comment: '评论', 'nav-bar': '导航菜单', footer: '页脚开关', 'context-menu': '右键菜单', fab: '悬浮按钮', font: '字体', license: '文章许可', article: '文章详情', 'post-list': '文章列表', 'expressive-code': '代码显示', 'image-bloom': '图片效果', permalink: '文章地址', llms: 'AI 索引', umami: '访问统计', i18n: '多语言文案' };
const pageDomains = new Set(['about', 'moments', 'skills', 'projects', 'timeline', 'devices', 'games', 'friends', 'albums', 'anime', 'compass', 'series']);
let schemas;
const defaultsCache = new Map();
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
export function mergeSettings(base, override) {
  if (!plain(base) || !plain(override)) return override;
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) result[key] = mergeSettings(base[key], value);
  return result;
}
function serializable(value, seen = new Set(), depth = 0) {
  if (depth > 35 || value === null) throw new AdminError('配置不能含空值或超过 35 层；清空文字请填空字符串。');
  if (['string', 'boolean'].includes(typeof value)) return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object' || seen.has(value)) throw new AdminError('配置含无效或循环值。');
  seen.add(value);
  for (const [key, item] of Object.entries(value)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new AdminError('配置键名不合法。');
    serializable(item, seen, depth + 1);
  }
  seen.delete(value);
}
export function validateSchema(schema, value, location = '设置') {
  if (schema.anyOf) {
    if (!schema.anyOf.some(branch => { try { validateSchema(branch, value, location); return true; } catch { return false; } })) throw new AdminError(`${location} 的类型或选项有误。`);
    return;
  }
  if (schema.enum && !schema.enum.includes(value)) throw new AdminError(`${location} 必须选用：${schema.enum.join('、')}。`);
  if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length > 300) throw new AdminError(`${location} 必须为最多 300 项的列表。`);
    value.forEach((item, index) => validateSchema(schema.items || {}, item, `${location}[${index + 1}]`));
  } else if (schema.type === 'object') {
    if (!plain(value)) throw new AdminError(`${location} 必须为对象。`);
    for (const [key, item] of Object.entries(value)) {
      const property = schema.properties?.[key];
      if (!property && schema.additionalProperties === false) throw new AdminError(`${location}.${key} 不在网站配置契约中。`);
      validateSchema(property || (plain(schema.additionalProperties) ? schema.additionalProperties : {}), item, `${location}.${key}`);
    }
  } else if (schema.type && typeof value !== schema.type) throw new AdminError(`${location} 必须为 ${schema.type}。`);
}
function parseYaml(raw) {
  const doc = parseDocument(raw || '{}\n');
  if (doc.errors.length) throw new AdminError('YAML 格式有误：' + doc.errors[0].message);
  const data = doc.toJS({ maxAliasCount: 50 });
  if (!plain(data)) throw new AdminError('配置顶层必须为对象。');
  serializable(data);
  return { doc, data };
}
async function loadDefaults(themeRoot) {
  const imports = [], values = [];
  for (const domain of CONFIG_DOMAINS.filter(d => d.key !== 'navBar')) {
    const file = path.join(themeRoot, 'src/config', domain.key + 'Config.ts');
    if (!await fs.stat(file).catch(() => null)) continue;
    imports.push(`import { ${domain.key}Config } from ${JSON.stringify(file)};`);
    values.push(`${JSON.stringify(domain.file)}: ${domain.key}Config`);
  }
  const result = await build({ absWorkingDir: themeRoot, stdin: { contents: imports.join('\n') + `\nexport default {${values.join(',')}};`, resolveDir: themeRoot, loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent', plugins: [{ name: 'theme-defaults', setup(builder) {
    builder.onLoad({ filter: /[\\/]utils[\\/]config-overlay\.ts$/ }, () => ({ contents: 'export const withUserConfig = (_, defaults) => defaults; export const getUserConfig = () => undefined;', loader: 'js' }));
  } }] });
  const defaults = (await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'))).default;
  defaults['nav-bar'] = { links: [{ preset: 'Home' }, { preset: 'Archive' }, { preset: 'Tags' }, { preset: 'About' }] };
  return defaults;
}
export async function createSettings(store, themeRoot) {
  schemas ??= createConfigSchemas();
  if (!defaultsCache.has(themeRoot)) defaultsCache.set(themeRoot, loadDefaults(themeRoot));
  const defaults = await defaultsCache.get(themeRoot);
  const spec = name => {
    if (name === 'about-content') return { file: 'content/spec/about.md', format: 'markdown', label: '关于页正文' };
    if (name === 'footer-content') return { file: 'config/footer.html', format: 'html', label: '页脚文字与 HTML' };
    if (name === 'deployment') return { file: 'deployment.json', format: 'json', label: '部署管理' };
    if (!CONFIG_DOMAINS.some(d => d.file === name)) throw new AdminError('设置分组不存在。', 404);
    return { file: `config/${name}.yaml`, format: 'yaml', label: labels[name] || name };
  };
  const read = async name => {
    const meta = spec(name);
    if (meta.format === 'yaml') {
      const other = await store.readDocument(meta.file.replace(/\.yaml$/, '.yml'));
      const primary = await store.readDocument(meta.file);
      if (primary.revision !== null && other.revision !== null) throw new AdminError('同一配置存在 yaml 和 yml 两份文件，请先在文件管理器中保留一份。');
      if (primary.revision === null && other.revision !== null) meta.file = other.path;
    }
    const current = await store.readDocument(meta.file);
    let data, override, error;
    if (meta.format === 'yaml') {
      try { override = parseYaml(current.raw).data; data = mergeSettings(defaults[name] || {}, override); }
      catch (issue) { error = issue.message; override = {}; data = defaults[name] || {}; }
    }
    if (meta.format === 'json') { try { override = current.revision === null ? { ...DEFAULT_DEPLOYMENT_POLICY } : validateDeploymentPolicy(JSON.parse(current.raw)); data = override; } catch (error) { throw new AdminError(error.message); } }
    return { name, ...meta, ...current, schema: schemas[name], data, override, error, defaults: defaults[name] || {} };
  };
  const save = async input => {
    const current = await read(input.name);
    if (current.revision !== input.revision) throw new AdminError('配置已变化，请重新载入后保存。', 409);
    let raw;
    if (current.format === 'yaml') {
      if (current.error && input.raw === undefined) throw new AdminError('现有配置格式有误，请修复并保存高级 YAML，避免覆盖原始配置。');
      if (input.raw !== undefined) {
        if (typeof input.raw !== 'string' || input.raw.length > 2_000_000) throw new AdminError('配置文本过长或格式有误。');
        const parsed = parseYaml(input.raw); validateSchema(current.schema, parsed.data);
        raw = input.raw;
      } else {
        serializable(input.data); validateSchema(current.schema, input.data);
        const parsed = parseYaml(current.raw);
        const update = (before, after, keys = []) => {
          if (JSON.stringify(before) === JSON.stringify(after)) return;
          if (plain(before) && plain(after)) {
            for (const key of Object.keys(before)) if (!Object.hasOwn(after, key)) parsed.doc.deleteIn([...keys, key]);
            for (const [key, value] of Object.entries(after)) update(before[key], value, [...keys, key]);
          } else parsed.doc.setIn(keys, after);
        };
        update(current.data, input.data);
        raw = parsed.doc.toString({ lineWidth: 0 });
        validateSchema(current.schema, parseYaml(raw).data);
      }
    } else if (current.format === 'json') {
      try { raw = JSON.stringify(validateDeploymentPolicy(input.data), null, 2) + '\n'; } catch (error) { throw new AdminError(error.message); }
    } else {
      if (typeof input.raw !== 'string' || input.raw.length > 2_000_000) throw new AdminError('页面文字格式有误。');
      raw = input.raw;
    }
    await store.writeDocument({ path: current.path, revision: current.revision, raw });
    return read(input.name);
  };
  return { read, save, async list() {
    return { entries: await Promise.all(CONFIG_DOMAINS.map(async domain => {
      const entry = await read(domain.file).catch(error => ({ error: error.message }));
      return { name: domain.file, label: labels[domain.file] || domain.file, page: pageDomains.has(domain.file), enabled: typeof entry.data?.enable === 'boolean' ? entry.data.enable : null, error: entry.error };
    })) };
  } };
}
