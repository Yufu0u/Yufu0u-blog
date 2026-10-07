import { resolveScheme } from '../../src/utils/mc-utils.ts';
import { createSettingsUI } from './settings-client.js';

const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
const button = (action, label, glyph, cls = '', extra = '') => `<button type="button" class="btn m3-state-layer ${cls}" data-action="${action}" ${extra}>${glyph ? icon(glyph) : ''}<span>${label}</span></button>`;
const iconButton = (action, label, glyph, extra = '') => `<button type="button" class="icon-btn m3-state-layer" data-action="${action}" aria-label="${label}" title="${label}" ${extra}>${icon(glyph)}</button>`;
const state = { boot: null, items: [], errors: [], media: [], view: 'overview', filter: 'all', query: '', editor: null, plan: null, job: null, saveTask: null, uploading: 0, busy: false };
const formatDate = value => { const date = new Date(value); return Number.isFinite(date.valueOf()) ? new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', timeZone: 'Asia/Shanghai' }).format(date) : '未设置'; };
const formatTime = value => new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Shanghai' }).format(new Date(value));
const size = bytes => bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const titleOf = item => item.kind === 'posts' ? item.metadata.title : item.body.replace(/[#*`>\[\]]/g, '').trim().split('\n')[0] || '未命名瞬间';
const localImage = url => /^\/(?!\/)/.test(url || '') ? '/media' + url : /^https?:\/\//.test(url || '') ? url : '';
const today = () => new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Shanghai' }).format(new Date());
const nowLocal = () => new Intl.DateTimeFormat('sv-SE', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Shanghai', hourCycle: 'h23' }).format(new Date()).replace(' ', 'T');
const draftKey = (kind, id) => `blog-studio:${state.boot.contentRoot}:${kind}:${id}`;
let toastTimer, previewTimer, autoTimer, jobTimer, previewGeneration = 0;
const settingsUI = createSettingsUI({ api, toast, dialog, esc, icon, button, navigate, busy: () => state.busy, refreshBoot: async () => { state.boot = await api('bootstrap'); document.title = '写作空间 · ' + state.boot.title; applyTheme(); } });

function toast(message, error = false) {
  $('#toast').textContent = message; $('#toast').className = error ? 'visible error' : 'visible';
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').className = '', error ? 7000 : 4000);
}
async function api(route, data, options = {}) {
  const init = data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-CSRF': state.boot.csrf }, body: JSON.stringify(data) };
  const response = await fetch('/api/' + route, { ...init, ...options });
  const result = await response.json();
  if (!response.ok) { const error = new Error(result.error || '操作未完成'); error.status = response.status; throw error; }
  return result;
}
function applyTheme() {
  const mode = localStorage.getItem('studio-theme') || 'system';
  const dark = mode === 'dark' || mode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const scheme = resolveScheme(state.boot.hue, dark, state.boot.style, state.boot.spec);
  for (const [role, value] of Object.entries(scheme)) if (value) document.documentElement.style.setProperty('--' + role.replace(/[A-Z]/g, x => '-' + x.toLowerCase()), value);
  const control = $('[data-action="theme"]');
  if (control) { control.innerHTML = icon(dark ? 'light-mode' : 'dark-mode'); control.setAttribute('aria-label', dark ? '切换浅色模式' : '切换深色模式'); }
}
function statusBadge(draft) { return `<span class="badge ${draft ? 'draft' : ''}"><span class="dot"></span>${draft ? '草稿' : '可发布'}</span>`; }
const views = { overview: ['工作台', 'dashboard'], posts: ['文章', 'article'], moments: ['瞬间', 'chat-bubble'], drafts: ['草稿箱', 'edit-note'], media: ['媒体库', 'image'], settings: ['站点设置', 'edit-note'], deployment: ['部署管理', 'cloud-upload'], publish: ['发布中心', 'cloud-upload'], backups: ['历史备份', 'settings-backup-restore'] };
function shell() {
  $('#app').innerHTML = `<a class="skip" href="#main">跳到主要内容</a>
    <aside class="sidebar">
      <a class="brand" href="#overview" data-action="nav" data-view="overview"><span class="brand-icon">${icon('edit-note')}</span><span>写作空间<small>CONTENT STUDIO</small></span></a><button type="button" class="icon-btn mobile-close" data-action="mobile-nav" aria-label="收起导航">${icon('close')}</button>
      <div class="nav-label">你的内容</div>
      <nav aria-label="后台导航">${Object.entries(views).map(([view, [label, glyph]]) => `<button type="button" data-action="nav" data-view="${view}" class="nav-item m3-state-layer ${state.view === view ? 'active' : ''}">${icon(glyph)}<span>${label}</span>${['posts', 'moments'].includes(view) ? `<span class="nav-count">${state.items.filter(i => i.kind === view).length}</span>` : ''}</button>`).join('')}</nav>
      <div class="sidebar-bottom"><div class="local-note"><span class="dot"></span>本机工作空间<small>保存到私有内容仓</small></div><div class="profile">${state.boot.avatar ? `<img src="${esc(state.boot.avatar)}" alt="" />` : `<span class="avatar">${esc(state.boot.author[0])}</span>`}<span>${esc(state.boot.author)}<small>把学过的，慢慢写清楚。</small></span></div></div>
    </aside>
    <div class="workspace"><header class="topbar"><div class="breadcrumb">${iconButton('mobile-nav', '展开导航', 'menu', 'class="mobile-nav"')}<span>${esc(state.boot.title)}</span><span class="slash">/</span><strong id="crumb">${state.view === 'editor' ? '编辑内容' : views[state.view][0]}</strong></div><div class="top-actions"><span class="connection"><span class="dot"></span>本机已连接</span>${iconButton('theme', '切换深色模式', 'dark-mode')}${state.boot.siteUrl ? `<a class="btn tonal m3-state-layer visit" href="${esc(state.boot.siteUrl)}" target="_blank" rel="noopener">查看博客${icon('arrow-outward')}</a>` : ''}</div></header><main id="main" tabindex="-1"></main></div>`;
  applyTheme(); renderMain(); syncMobileNav();
}
function renderMain() {
  const main = $('#main'); main.className = state.view === 'editor' ? 'editor-main' : '';
  if (state.view === 'overview') renderOverview();
  else if (['posts', 'moments', 'drafts'].includes(state.view)) renderCollection();
  else if (state.view === 'media') renderMedia();
  else if (state.view === 'publish') renderPublish();
  else if (state.view === 'backups') renderBackups().catch(error => toast(error.message, true));
  else if (state.view === 'editor') renderEditor();
  else if (['settings', 'deployment'].includes(state.view)) settingsUI.mount(state.view);
}
function pageHeading(title, subtitle, actions = '') { return `<div class="page-heading"><div><div class="eyebrow">${state.view === 'overview' ? 'YOUR CREATIVE SPACE' : 'CONTENT STUDIO'}</div><h1>${title}</h1><p>${subtitle}</p></div><div class="heading-actions">${actions}</div></div>`; }
function renderOverview() {
  const posts = state.items.filter(i => i.kind === 'posts'), moments = state.items.filter(i => i.kind === 'moments'), drafts = state.items.filter(i => i.metadata.draft);
  $('#main').innerHTML = pageHeading('欢迎回来，' + esc(state.boot.author), `${today().replace(/-/g, ' / ')} · 今天也留下一点值得记住的东西。`)
    + `<section class="hero"><div class="hero-copy"><span class="hero-kicker">记录 · 整理 · 分享</span><h2>把学过的，<br>慢慢写清楚。</h2><p>一篇认真写的文章，或一个灵光乍现的瞬间。<br>从这里开始，让表达变得轻松一点。</p><div class="hero-actions">${button('new-post', '写篇文章', 'edit-note', 'primary')}${button('new-moment', '记录瞬间', 'add', 'hero-secondary')}</div></div><div class="hero-art" aria-hidden="true"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><div class="art-card"><span class="art-line wide"></span><span class="art-line"></span><span class="art-line short"></span>${icon('edit-note')}</div><span class="spark spark-one">✦</span><span class="spark spark-two">✦</span></div></section>`
    + `<div class="stats">${[['文章', posts.length, 'article', 'posts'], ['瞬间', moments.length, 'chat-bubble', 'moments'], ['草稿', drafts.length, 'edit-note', 'drafts']].map(([label, number, glyph, view]) => `<button type="button" class="stat-card m3-state-layer" data-action="stat" data-view="${view}"><span class="stat-icon">${icon(glyph)}</span><span><small>${label}</small><strong>${number}<em>${label === '瞬间' ? '条记录' : '篇内容'}</em></strong></span>${icon('arrow-outward')}</button>`).join('')}</div>`
    + `<div class="overview-grid"><section class="panel recent-panel"><div class="section-heading"><div><h2>最近的内容</h2><p>继续上一次的灵感。</p></div>${button('nav', '全部内容', 'arrow-outward', 'text', 'data-view="posts"')}</div>${state.errors.length ? `<div class="notice error">${state.errors.map(e => esc(e.id + '：' + e.error)).join('<br>')}</div>` : ''}${state.items.slice(0, 5).map(item => row(item)).join('') || empty('还没有内容', '写下第一篇文章或第一条瞬间吧。')}</section><aside class="side-panels"><section class="panel quick-panel"><div class="section-heading"><h2>创作捷径</h2>${icon('bolt')}</div>${[['new-post', '写一篇文章', '把经验整理成完整的故事', 'article'], ['new-moment', '随手记一刻', '一段文字，也值得留下', 'chat-bubble'], ['media', '上传图片', '拖拽或粘贴，自动压缩', 'image']].map(([action, title, text, glyph]) => `<button type="button" class="quick-link m3-state-layer" data-action="${action === 'media' ? 'nav' : action}" ${action === 'media' ? 'data-view="media"' : ''}><span class="quick-icon">${icon(glyph)}</span><span><strong>${title}</strong><small>${text}</small></span>${icon('arrow-outward')}</button>`).join('')}</section><section class="writing-note"><span class="note-icon">${icon('schedule')}</span><h3>灵感可以慢慢长大</h3><p>草稿会自动保存。写完后，在发布中心查看清单，再推送到博客。</p><span class="note-footer">每一次记录，都是一点进步。</span></section></aside></div>`;
}
function row(item) {
  const glyph = item.kind === 'posts' ? 'article' : 'chat-bubble';
  return `<div class="content-row"><button type="button" class="row-main m3-state-layer" data-action="edit" data-kind="${item.kind}" data-id="${esc(item.id)}"><span class="row-icon ${item.kind}">${icon(glyph)}</span><span class="row-copy"><strong>${esc(titleOf(item))}</strong><small>${item.kind === 'posts' ? '文章' : '瞬间'}<span>·</span>${formatDate(item.metadata.published)}${item.metadata.category ? '<span>·</span>' + esc(item.metadata.category) : ''}</small></span></button>${statusBadge(item.metadata.draft)}${iconButton('edit', '编辑内容', 'arrow-outward', `data-kind="${item.kind}" data-id="${esc(item.id)}"`)}</div>`;
}
function empty(title, description, glyph = 'edit-note') { return `<div class="empty">${icon(glyph)}<h3>${title}</h3><p>${description}</p></div>`; }
function filtered() {
  return state.items.filter(i => (state.view === 'drafts' ? i.metadata.draft : i.kind === state.view) && (state.filter === 'all' || Boolean(i.metadata.draft) === (state.filter === 'draft'))
    && `${titleOf(i)} ${i.id} ${(i.metadata.tags || []).join(' ')} ${i.metadata.category || ''} ${i.body}`.toLowerCase().includes(state.query.toLowerCase()));
}
function renderCollection() {
  const moment = state.view === 'moments';
  const filters = state.view === 'drafts' ? [['all', '全部草稿']] : [['all', '全部'], ['ready', '可发布'], ['draft', '草稿']];
  $('#main').innerHTML = pageHeading(state.view === 'drafts' ? '给灵感一点时间' : moment ? '记录每一个瞬间' : '让想法成为文章', state.view === 'drafts' ? '文章与瞬间的草稿，都在这里等你继续。' : moment ? '随手记录，留住那些小小的灵感和日常。' : '在这里管理文章、整理草稿，慢慢积累你的知识。', button(moment ? 'new-moment' : 'new-post', moment ? '记录瞬间' : '新建文章', 'add', 'primary'))
    + `<div class="collection-tools"><div class="segmented" role="group" aria-label="内容状态筛选">${filters.map(([key, label]) => `<button type="button" data-action="filter" data-filter="${key}" class="m3-state-layer ${state.filter === key ? 'selected' : ''}" aria-pressed="${state.filter === key}">${label}<span>${state.items.filter(i => (state.view === 'drafts' ? i.metadata.draft : i.kind === state.view) && (key === 'all' || Boolean(i.metadata.draft) === (key === 'draft'))).length}</span></button>`).join('')}</div><label class="search">${icon('search')}<input id="search" type="search" placeholder="${moment ? '搜索瞬间或标签' : '搜索文章、标签、分类'}" aria-label="搜索内容" value="${esc(state.query)}"></label></div><div id="collection-results"></div>`;
  renderResults();
  $('#search').addEventListener('input', event => { state.query = event.target.value; renderResults(); });
}
function renderResults() {
  const items = filtered();
  $('#collection-results').innerHTML = items.length ? state.view !== 'moments' ? `<section class="panel article-list"><div class="list-header"><span>标题 / 内容信息</span><span>状态</span><span>操作</span></div>${items.map(item => `<div class="article-entry">${row(item)}<div class="entry-actions">${iconButton('duplicate', '复制为草稿', 'content-copy', `data-kind="${item.kind}" data-id="${esc(item.id)}"`)}${iconButton('delete', '删除内容', 'delete', `data-kind="${item.kind}" data-id="${esc(item.id)}"`)}</div></div>`).join('')}</section>` : `<div class="moment-grid">${items.map(item => `<article class="panel moment-card"><div class="moment-meta"><span class="moment-avatar">${state.boot.avatar ? `<img src="${esc(state.boot.avatar)}" alt="" />` : icon('chat-bubble')}</span><span><strong>${esc(state.boot.author)}</strong><small>${formatDate(item.metadata.published)}${item.metadata.location ? ' · ' + esc(item.metadata.location) : ''}</small></span>${statusBadge(item.metadata.draft)}</div><button type="button" class="moment-body" data-action="edit" data-kind="moments" data-id="${esc(item.id)}">${esc(item.body.trim().slice(0, 220))}${item.body.trim().length > 220 ? '…' : ''}</button>${item.metadata.images?.length ? `<div class="moment-images">${item.metadata.images.slice(0, 3).map(img => `<img src="${esc(localImage(img.src))}" alt="${esc(img.alt)}" loading="lazy">`).join('')}</div>` : ''}<div class="moment-footer"><div class="tags">${(item.metadata.tags || []).map(tag => `<span># ${esc(tag)}</span>`).join('')}${item.metadata.pinned ? '<span>已置顶</span>' : ''}</div><div>${iconButton('edit', '编辑瞬间', 'edit-note', `data-kind="moments" data-id="${esc(item.id)}"`)}${iconButton('duplicate', '复制为草稿', 'content-copy', `data-kind="moments" data-id="${esc(item.id)}"`)}${iconButton('delete', '删除瞬间', 'delete', `data-kind="moments" data-id="${esc(item.id)}"`)}</div></div></article>`).join('')}</div>` : empty('这里暂时没有内容', state.query ? '试试其他关键词，或切换筛选条件。' : '点击右上角，开始第一条记录。', state.view === 'moments' ? 'chat-bubble' : 'article');
}
async function loadContent() { const data = await api('content'); state.items = data.items; state.errors = data.errors; }
async function leaveEditor() {
  if (!await settingsUI.leave()) return false;
  clearTimeout(autoTimer); clearTimeout(previewTimer);
  if (!state.editor) return true;
  if (state.saveTask) await state.saveTask;
  if (state.editor.dirty) {
    const choice = await dialog('还要继续这次写作吗？', '<p>当前修改已保留在浏览器恢复副本中。保存到文件后，后台和网站构建才能读取它。</p>', [{ label: '继续编辑', value: false }, { label: '保留副本并离开', value: 'leave' }, { label: '保存后离开', value: 'save', primary: true }]);
    if (choice === false || choice === null) return false;
    if (choice === 'save' && !await saveEditor()) return false;
  }
  state.editor = null; return true;
}
async function navigate(view, filter = 'all') {
  if (!await leaveEditor()) return;
  state.view = view; state.filter = filter; state.query = ''; state.plan = null;
  await loadContent(); shell(); history.replaceState(null, '', '#' + view);
  $('.sidebar')?.classList.remove('mobile-open');
  if (view === 'media') { state.media = (await api('media')).items; renderMedia(); }
  if (view === 'publish') await loadPlan();
}

function newItem(kind) {
  const id = `${today()}-${kind === 'posts' ? 'post' : 'moment'}-${crypto.randomUUID().slice(0, 6)}.md`;
  return { kind, id, revision: null, originalId: null, body: '', metadata: { published: kind === 'posts' ? today() : nowLocal() + '+08:00', tags: [], pinned: false, draft: true, ...(kind === 'posts' ? { title: '', description: '', category: '', image: '', lang: 'zh_CN', comment: true } : { location: '', mood: '', images: [] }) }, dirty: false, mode: 'split' };
}
async function openEditor(kind, id, duplicate = false) {
  if (!await leaveEditor()) return;
  const item = id ? await api(`item?kind=${kind}&id=${encodeURIComponent(id)}`) : newItem(kind);
  const editor = { ...item, originalId: id || null, dirty: false, mode: matchMedia('(max-width:1200px)').matches ? 'write' : 'split' };
  if (duplicate) { editor.id = newItem(kind).id; editor.originalId = null; editor.revision = null; editor.metadata.draft = true; if (kind === 'posts') editor.metadata.title += '（副本）'; editor.dirty = true; }
  let recovered;
  try { recovered = JSON.parse(localStorage.getItem(draftKey(kind, editor.id)) || 'null'); } catch { /* Invalid recovery data can be replaced by the next edit. */ }
  if (recovered && !duplicate) {
    const recover = await dialog('发现未保存的写作', `<p>这个文件有 ${esc(formatTime(recovered.at))} 的恢复副本。可以恢复继续编辑，也可以打开文件中的版本。</p>`, [{ label: '打开文件版本', value: false }, { label: '恢复写作', value: true, primary: true }]);
    if (recover) { editor.body = recovered.body; editor.metadata = recovered.metadata; editor.revision = recovered.revision; editor.dirty = true; }
    else if (recover !== null) localStorage.removeItem(draftKey(kind, editor.id));
  }
  state.editor = editor; state.view = 'editor'; shell(); history.replaceState(null, '', '#editor');
  schedulePreview(); if (duplicate) onEdit();
  (kind === 'posts' ? $('#post-title') : $('#body'))?.focus();
}
function metadataInput(name, label, type = 'text', hint = '') {
  const value = state.editor.metadata[name] ?? '';
  return `<label class="field"><span>${label}</span><input data-field="${name}" type="${type}" value="${esc(value)}">${hint ? `<small>${hint}</small>` : ''}</label>`;
}
function renderEditor() {
  const item = state.editor, moment = item.kind === 'moments';
  $('#main').innerHTML = `<div class="editor-top"><div class="editor-heading">${iconButton('editor-back', '返回内容列表', 'arrow-back')}<span><strong>${moment ? '记录瞬间' : item.revision ? '编辑文章' : '写一篇文章'}</strong><small id="save-status" aria-live="polite">${item.dirty ? '恢复副本 · 等待保存' : item.revision ? '已保存到文件' : '新的灵感，从这里开始'}</small></span></div><div class="editor-actions">${iconButton('export', '导出 Markdown', 'download')}${button('save', item.metadata.draft ? '保存草稿' : '保存修改', 'save', 'tonal')}${button('editor-publish', '发布', 'cloud-upload', 'primary')}</div></div>
    <div class="editor-layout"><section class="editor-paper panel">${moment ? `<div class="moment-author"><span class="moment-avatar">${state.boot.avatar ? `<img src="${esc(state.boot.avatar)}" alt="">` : icon('chat-bubble')}</span><span><strong>${esc(state.boot.author)}</strong><small>此刻的想法，值得留下。</small></span></div>` : `<div class="title-area"><input id="post-title" data-field="title" class="post-title" placeholder="给你的文章起个标题…" aria-label="文章标题" value="${esc(item.metadata.title)}"><input data-field="description" class="post-description" placeholder="用一句话介绍这篇文章（可选）" aria-label="文章简介" value="${esc(item.metadata.description || '')}"></div>`}
      <div class="editor-toolbar"><div class="format-actions">${[['heading', '标题', 'title'], ['bold', '粗体', 'format-bold'], ['italic', '斜体', 'format-italic'], ['quote', '引用', 'format-quote'], ['list', '列表', 'list'], ['code', '代码块', 'code'], ['link', '链接', 'link']].map(([format, label, glyph]) => iconButton('format', label, glyph, `data-format="${format}"`)).join('')}<span class="toolbar-divider"></span>${iconButton('pick-media', '从媒体库插入图片', 'image')}${iconButton('editor-upload', '上传图片', 'photo-camera')}</div><div class="editor-modes" role="group" aria-label="编辑器视图">${[['write', '写作'], ['split', '分屏'], ['preview', '预览']].map(([mode, label]) => `<button type="button" data-action="mode" data-mode="${mode}" aria-pressed="${item.mode === mode}" class="m3-state-layer ${item.mode === mode ? 'selected' : ''}">${label}</button>`).join('')}</div></div>
      <div id="editor-panes" class="editor-panes mode-${item.mode}"><div class="write-pane"><div class="pane-label">MARKDOWN</div><textarea id="body" placeholder="${moment ? '此刻在想什么？\n\n可以拖入图片，或者直接粘贴截图。' : '写下开头，剩下的慢慢来。\n\n支持 Markdown、拖拽图片和粘贴截图。'}" aria-label="Markdown 正文" spellcheck="false">${esc(item.body)}</textarea></div><div class="preview-pane"><div class="pane-label">阅读预览</div><article id="preview" class="markdown"><p class="preview-placeholder">写下文字，这里会呈现阅读时的样子。</p></article><p class="preview-note">Markdown 阅读预览；MDX、数学公式与主题扩展以网站构建结果为准。</p></div></div>
      <footer class="editor-footer"><span id="word-count">${item.body.replace(/\s/g, '').length} 字</span><span>Ctrl / ⌘ + S 保存 · 拖拽 / 粘贴上传图片</span><span id="upload-status"></span></footer></section>
      <aside class="inspector"><section class="panel"><h2>发布设置</h2><label class="switch-row"><span><strong>保留为草稿</strong><small>生产网站不展示草稿</small></span><input type="checkbox" role="switch" data-field="draft" ${item.metadata.draft ? 'checked' : ''}></label><label class="field"><span>文件名 / 地址</span><input id="slug" value="${esc(item.id.replace(/\.(md|mdx)$/, ''))}" ${item.originalId ? 'readonly' : ''} aria-label="文件名"><small>${item.originalId ? '保留原地址和评论关联' : '自动命名，可改成小写英文与短横线'}</small></label>${moment ? `<label class="field"><span>发布时间（北京时间）</span><input id="moment-date" type="datetime-local" step="1" value="${esc((item.metadata.published.length === 10 ? item.metadata.published + 'T00:00:00' : new Intl.DateTimeFormat('sv-SE', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Shanghai', hourCycle: 'h23' }).format(new Date(item.metadata.published)).replace(' ', 'T')).slice(0, 19))}"></label>` : metadataInput('published', '发布日期', 'date')}${moment ? metadataInput('location', '地点（可选）', 'text', '填写后会显示在博客中') : metadataInput('category', '分类（可选）')}
      <label class="field"><span>标签</span><input id="tags" value="${esc((item.metadata.tags || []).join(', '))}" placeholder="例如：学习日志, 嵌入式" aria-label="标签"><small>用逗号分隔，支持中文逗号</small></label><label class="switch-row"><span><strong>置顶${moment ? '瞬间' : '文章'}</strong></span><input type="checkbox" role="switch" data-field="pinned" ${item.metadata.pinned ? 'checked' : ''}></label>${moment ? metadataInput('mood', '心情图标（可选）', 'text', '填写 Iconify 图标名称') : `<label class="switch-row"><span><strong>允许评论</strong></span><input type="checkbox" role="switch" data-field="comment" ${item.metadata.comment !== false ? 'checked' : ''}></label>`}</section>
      <section class="panel"><div class="section-heading"><h2>${moment ? '瞬间配图' : '文章封面'}</h2>${iconButton('image-upload', '上传图片', 'add')}</div>${moment ? `<div id="moment-image-list">${momentImages()}</div><p class="field-hint">上传后直接成为瞬间配图，可编辑说明。</p>` : `<div id="cover-preview">${coverPreview()}</div><label class="field"><span>封面地址</span><input data-field="image" placeholder="/images/posts/…" value="${esc(item.metadata.image || '')}"></label>`}${button('pick-cover', '从媒体库选择', 'image', 'outlined full')}</section>
      <div class="editor-tip">${icon('keyboard')}<p>草稿在停止输入后自动保存。已发布内容的修改先保留恢复副本，点击保存写入文件。</p></div></aside></div><input id="editor-files" type="file" accept="image/png,image/jpeg,image/webp,image/avif,image/gif" multiple hidden>`;
  $$('[data-field]').forEach(input => input.addEventListener('input', event => { const { field } = event.target.dataset; state.editor.metadata[field] = event.target.type === 'checkbox' ? event.target.checked : event.target.value; if (field === 'image') $('#cover-preview').innerHTML = coverPreview(); onEdit(); }));
  $('#body').addEventListener('input', event => { state.editor.body = event.target.value; onEdit(); schedulePreview(); });
  $('#tags').addEventListener('input', event => { state.editor.metadata.tags = event.target.value.split(/[,，]/).map(tag => tag.trim()).filter(Boolean); onEdit(); });
  $('#slug').addEventListener('input', event => { if (!state.editor.originalId) { const oldKey = draftKey(item.kind, item.id); state.editor.id = event.target.value + '.md'; localStorage.removeItem(oldKey); onEdit(); } });
  $('#moment-date')?.addEventListener('input', event => { state.editor.metadata.published = event.target.value + '+08:00'; onEdit(); });
  $('#editor-files').addEventListener('change', event => { uploadFiles(event.target.files, state.uploadTarget || 'body'); event.target.value = ''; });
  bindImageAlts();
}
function coverPreview() { const url = state.editor.metadata.image; return url ? `<div class="cover-image"><img src="${esc(localImage(url))}" alt="封面预览">${iconButton('remove-cover', '移除封面', 'close')}</div>` : '<div class="cover-empty">' + icon('image') + '<span>一张图片，为文章添一点色彩</span></div>'; }
function momentImages() { return (state.editor.metadata.images || []).map((img, index) => `<div class="image-edit"><img src="${esc(localImage(img.src))}" alt="${esc(img.alt)}"><input data-image-alt="${index}" value="${esc(img.alt)}" placeholder="图片说明" aria-label="第 ${index + 1} 张图片说明">${iconButton('remove-image', '移除配图', 'close', `data-index="${index}"`)}</div>`).join('') || '<div class="cover-empty">' + icon('image') + '<span>留一张此刻的照片</span></div>'; }
function bindImageAlts() { $$('[data-image-alt]').forEach(input => input.addEventListener('input', event => { state.editor.metadata.images[Number(event.target.dataset.imageAlt)].alt = event.target.value; onEdit(); })); }
function onEdit() {
  const editor = state.editor; if (!editor) return;
  editor.dirty = true; $('#save-status').textContent = '恢复副本已保存 · 文件有未保存修改';
  $('#word-count').textContent = `${editor.body.replace(/\s/g, '').length} 字`;
  try { localStorage.setItem(draftKey(editor.kind, editor.id), JSON.stringify({ body: editor.body, metadata: editor.metadata, revision: editor.revision, at: new Date().toISOString() })); }
  catch { $('#save-status').textContent = '浏览器副本存储失败，请及时保存到文件'; }
  clearTimeout(autoTimer);
  if (!editor.conflict && editor.metadata.draft && editor.body.trim() && (editor.kind === 'moments' || editor.metadata.title.trim())) autoTimer = setTimeout(() => saveEditor(true), 1800);
}
async function saveEditor(quiet = false) {
  const editor = state.editor; if (!editor) return false;
  if (state.saveTask) { await state.saveTask; if (editor !== state.editor) return false; }
  if (!editor.dirty && editor.revision) { if (!quiet) toast('内容已保存'); return true; }
  if (state.uploading) { if (!quiet) toast('图片还在上传，请稍后保存'); return false; }
  const snapshot = JSON.stringify({ kind: editor.kind, id: editor.id, revision: editor.revision, body: editor.body, metadata: editor.metadata });
  const key = draftKey(editor.kind, editor.id);
  if ($('#slug')) $('#slug').readOnly = true;
  $('#save-status').textContent = '正在保存到文件…';
  state.saveTask = (async () => {
    try {
      const saved = await api('save', JSON.parse(snapshot));
      if (editor !== state.editor) return true;
      editor.revision = saved.revision; editor.originalId = saved.id;
      const current = JSON.stringify({ kind: editor.kind, id: editor.id, revision: JSON.parse(snapshot).revision, body: editor.body, metadata: editor.metadata });
      editor.dirty = current !== snapshot;
      const slug = $('#slug'); if (slug) slug.readOnly = true;
      if (!editor.dirty) localStorage.removeItem(key);
      else try { localStorage.setItem(key, JSON.stringify({ body: editor.body, metadata: editor.metadata, revision: editor.revision, at: new Date().toISOString() })); } catch { /* Explicit save still works when browser storage is full. */ }
      $('#save-status').textContent = editor.dirty ? '文件已保存 · 新修改待保存' : `已保存到文件 · ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
      if (!quiet) toast('已保存到私有内容仓');
      return true;
    } catch (error) { $('#save-status').textContent = error.status === 409 ? '文件有冲突 · 请导出后重新打开' : '保存未完成 · 恢复副本仍保留'; toast(error.message, true); if (error.status === 409) { clearTimeout(autoTimer); editor.conflict = true; } if (!editor.originalId && $('#slug')) $('#slug').readOnly = false; return false; }
  })();
  const success = await state.saveTask; state.saveTask = null; return success;
}
function schedulePreview() {
  clearTimeout(previewTimer); const generation = ++previewGeneration;
  previewTimer = setTimeout(async () => {
    if (!state.editor) return;
    const text = state.editor.body;
    try { const result = await api('preview', { body: text }); if (generation === previewGeneration && $('#preview')) $('#preview').innerHTML = result.html || '<p class="preview-placeholder">文字会在这里慢慢展开。</p>'; }
    catch (error) { if ($('#preview')) $('#preview').textContent = '预览未完成：' + error.message; }
  }, 250);
}
function insertText(before, after = '', placeholder = '文字') {
  const input = $('#body'), start = input.selectionStart, end = input.selectionEnd;
  const selected = input.value.slice(start, end) || placeholder;
  input.setRangeText(before + selected + after, start, end, 'select');
  state.editor.body = input.value; onEdit(); schedulePreview(); input.focus();
}
function format(name) {
  const formats = { heading: ['\n## ', '\n', '小标题'], bold: ['**', '**'], italic: ['*', '*'], quote: ['\n> ', '\n'], list: ['\n- ', '\n'], code: ['\n```\n', '\n```\n', '代码'], link: ['[', '](https://)', '链接说明'] };
  insertText(...formats[name]);
}
function insertImage(url, target, alt = '') {
  if (!state.editor) return;
  if (target === 'cover') { state.editor.metadata.image = url; $('[data-field="image"]').value = url; $('#cover-preview').innerHTML = coverPreview(); onEdit(); }
  else if (state.editor.kind === 'moments') { state.editor.metadata.images ||= []; state.editor.metadata.images.push({ src: url, alt }); $('#moment-image-list').innerHTML = momentImages(); bindImageAlts(); onEdit(); }
  else insertText('\n![' + alt + '](' + url + ')\n', '', '');
}
async function uploadFiles(files, target = 'library') {
  const images = [...files]; if (!images.length) return;
  if (state.busy) { toast('检查或发布期间暂停上传'); return; }
  const kind = state.editor?.kind || $('#upload-kind')?.value || 'posts';
  const owner = state.editor; state.uploading += images.length;
  let completed = 0;
  for (const file of images) {
    try {
      if (!/^image\/(png|jpeg|webp|avif|gif)$/.test(file.type) && !/\.(png|jpe?g|webp|avif|gif)$/i.test(file.name)) throw new Error('只接受 JPG、PNG、WebP、AVIF 和 GIF 图片。');
      if (file.size > 20 * 1024 * 1024) throw new Error(`${file.name} 超过 20 MB。`);
      toast(`正在上传 ${completed + 1} / ${images.length}：${file.name}`);
      const result = await api('upload?kind=' + kind, null, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Admin-CSRF': state.boot.csrf }, body: file });
      if (target !== 'library' && owner && state.editor === owner) insertImage(result.url, target);
      completed++;
    } catch (error) { toast(error.message, true); }
    finally { state.uploading--; if ($('#upload-status')) $('#upload-status').textContent = state.uploading ? `还在上传 ${state.uploading} 张` : ''; }
  }
  if (completed) toast(`${completed} 张图片已上传${owner && target !== 'library' ? '并插入' : ''}`);
  if (state.view === 'media') { state.media = (await api('media')).items; renderMedia(); }
  if (state.editor?.metadata.draft) onEdit();
}
function mediaTiles(items, pick = false, target = '') {
  return items.map(item => `<article class="media-card"><button type="button" class="media-image" data-action="${pick ? 'insert-media' : 'view-media'}" data-url="${esc(item.url)}" data-target="${target}"><img src="${esc(localImage(item.url))}" alt="${esc(item.name)}" loading="lazy"></button><div class="media-info"><span title="${esc(item.name)}">${esc(item.name)}</span><small>${size(item.bytes)} · ${formatDate(item.modified)}</small>${iconButton(pick ? 'insert-media' : 'copy-media', pick ? '插入图片' : '复制图片地址', pick ? 'add' : 'content-copy', `data-url="${esc(item.url)}" data-target="${target}"`)}</div></article>`).join('');
}
function renderMedia() {
  $('#main').innerHTML = pageHeading('给文字一点画面', '图片集中管理，上传后自动压缩，随时插入文章和瞬间。', button('media-upload', '上传图片', 'cloud-upload', 'primary'))
    + `<section class="dropzone" tabindex="0" role="button" aria-label="拖拽或选择图片上传" data-action="media-upload"><span class="drop-icon">${icon('cloud-upload')}</span><h2>把图片拖到这里</h2><p>或点击选择 · 支持粘贴截图 · 单张最大 20 MB</p><span>JPG / PNG / WebP / AVIF / GIF</span></section><div class="media-tools"><span><strong>${state.media.length}</strong> 张图片</span><label>上传到 <select id="upload-kind" aria-label="上传图片目录"><option value="posts">文章图片</option><option value="moments">瞬间图片</option></select></label></div><div class="media-grid">${mediaTiles(state.media)}</div>${!state.media.length ? empty('让第一张图片住进来', '上传图片后，这里会成为你的素材库。', 'image') : ''}<input id="media-files" type="file" accept="image/png,image/jpeg,image/webp,image/avif,image/gif" multiple hidden>`;
  $('#media-files').addEventListener('change', event => { uploadFiles(event.target.files); event.target.value = ''; });
}
async function pickMedia(target = 'body') {
  const images = (await api('media')).items;
  await dialog('选择一张图片', `<div class="media-grid picker-grid">${mediaTiles(images, true, target)}</div>${images.length ? '' : empty('媒体库还没有图片', '关闭窗口，点击编辑器中的相机图标上传。', 'image')}`, [{ label: '关闭', value: null }], 'wide');
}
async function loadPlan() {
  try { state.plan = await api('pending'); if (state.view === 'publish') renderPublish(); }
  catch (error) { if (state.view === 'publish') $('#plan-content').innerHTML = `<div class="notice error">${esc(error.message)}</div>`; }
}
function renderPublish() {
  const plan = state.plan;
  $('#main').innerHTML = pageHeading('让内容与世界见面', '保存完成后，在这里检查内容，再推送到私有内容仓。', button('refresh-plan', '刷新清单', 'refresh', 'tonal'))
    + `${plan?.deployment?.locked ? '<div class="notice error">部署已锁定。可继续本机检查，请在部署管理中解除并同步后推送。</div>' : plan?.deployment && !plan.deployment.autoDeploy ? '<div class="notice">新部署已暂停。内容仍可推送，线上网站保持当前版本。</div>' : ''}<div class="publish-grid"><section class="panel publish-panel"><div class="section-heading"><div><h2>待推送内容与设置</h2><p>文章、瞬间、图片、页面文字和网站配置。</p></div><span class="count-pill">${plan?.entries.length ?? '…'} 项</span></div><div id="plan-content">${!plan ? '<p class="loading">正在读取 Git 状态…</p>' : plan.entries.length ? plan.entries.map(entry => `<div class="change-row"><span class="change-status ${entry.status}">${{ added: '新增', modified: '修改', deleted: '删除' }[entry.status]}</span><code>${esc(entry.path)}</code><small>${size(entry.bytes)}</small></div>`).join('') : empty('所有内容已保存', plan.ahead ? '有本地提交尚未推送，可以重试发布。' : '没有需要推送的新修改。', 'check-circle')}</div>${plan ? `<div class="repo-info"><span>分支 <strong>${esc(plan.branch)}</strong></span><span>未推送提交 <strong>${plan.ahead}</strong></span><code>${esc(plan.remote)}</code></div>` : ''}</section><aside><section class="panel release-panel"><span class="release-icon">${icon('cloud-upload')}</span><h2>准备好了吗？</h2><p>后台会先检查内容并完成本机生产构建，通过后才提交和推送。</p><ol><li>检查内容与配置</li><li>构建网站与搜索索引</li><li>提交并推送内容仓</li></ol>${button('check', '只检查，不推送', 'check-circle', 'outlined full', state.busy ? 'disabled' : '')}${button('review-publish', '检查并推送', 'cloud-upload', 'primary full', !plan || (!plan.entries.length && !plan.ahead) || state.busy || plan.deployment?.locked ? 'disabled' : '')}${button('nav', '部署开关与锁定', 'visibility', 'text full', 'data-view="deployment"')}<small>推送后的实际部署结果以 EdgeOne 为准。</small></section><div class="notice">${icon('visibility')}<span>标为草稿的内容不会显示在生产网站；上传的图片随构建公开。</span></div></aside></div><section id="job-panel" class="panel job-panel" ${state.job ? '' : 'hidden'}>${jobMarkup()}</section>`;
}
function jobMarkup() {
  const job = state.job; if (!job) return '';
  return `<div class="section-heading"><h2>${job.type === 'publish' ? '发布进度' : '检查结果'}</h2><span class="badge ${job.status === 'error' ? 'error' : ''}">${job.status === 'running' ? '<span class="spinner"></span>' : icon(job.status === 'success' ? 'check-circle' : 'error')}${esc(job.step)}</span></div>${job.error ? `<div class="notice error">${esc(job.error)}</div>` : ''}${job.result ? `<div class="notice success">${esc(job.result.message)}${job.result.commit ? '<br>提交 ' + esc(job.result.commit.slice(0, 12)) : ''}</div>` : ''}<details ${job.status === 'error' ? 'open' : ''}><summary>查看检查日志</summary><pre class="job-log">${esc((job.log || []).join('\n'))}</pre></details>`;
}
async function startJob(type, data = {}) {
  state.job = await api(type, data); state.busy = true;
  state.view = 'publish'; shell(); pollJob();
}
async function pollJob() {
  clearTimeout(jobTimer);
  try {
    state.job = (await api('job')).job;
    state.busy = state.job?.status === 'running';
    if (state.view === 'publish' && state.job) { const panel = $('#job-panel'); panel.hidden = false; panel.innerHTML = jobMarkup(); }
    if (state.busy) jobTimer = setTimeout(pollJob, 1800);
    else { if (state.job) toast(state.job.status === 'success' ? state.job.result.message : state.job.error, state.job.status === 'error'); await loadPlan(); }
  } catch (error) { toast('无法读取任务状态：' + error.message, true); jobTimer = setTimeout(pollJob, 4000); }
}
async function reviewPublish() {
  await loadPlan(); const plan = state.plan; if (!plan) return;
  if (plan.deployment?.locked) { toast('部署已锁定，请先解除并同步控制状态', true); return; }
  const proceed = await dialog('检查并推送这些内容与设置', `<p>以下 ${plan.entries.length} 个文件将提交到私有内容仓 <strong>main</strong>，以及 ${plan.ahead} 个尚未推送的本地提交。${plan.deployment?.autoDeploy === false ? '部署已暂停，推送后仍保持当前网站版本。' : '推送会触发 EdgeOne 自动部署。'}</p><div class="review-files">${plan.entries.map(e => `<div><span>${{ added: '+', modified: '~', deleted: '−' }[e.status]}</span><code>${esc(e.path)}</code></div>`).join('')}</div><label class="field"><span>提交说明（可选）</span><input id="commit-message" value="content: update content and settings" maxlength="200"></label>`, [{ label: '继续检查内容', value: false }, { label: '检查并推送', value: true, primary: true }], '', () => $('#commit-message')?.value);
  if (proceed?.value) await startJob('publish', { fingerprint: plan.fingerprint, message: proceed.extra });
}
async function renderBackups() {
  $('#main').innerHTML = pageHeading('每一次修改都有来处', '修改与删除前自动保留本机备份，需要时恢复为文件版本。') + '<section class="panel" id="backup-content"><p class="loading">正在读取备份…</p></section>';
  const items = (await api('backups')).items;
  if (state.view !== 'backups') return;
  $('#backup-content').innerHTML = items.length ? items.map(item => `<div class="backup-row"><span class="row-icon">${icon('settings-backup-restore')}</span><span><strong>${esc(item.relative)}</strong><small>${formatTime(item.at)} · ${{ save: '修改前', delete: '删除前', restore: '恢复前' }[item.action]}</small></span>${button('restore', '恢复', 'settings-backup-restore', 'tonal', `data-key="${esc(item.key)}"`)}</div>`).join('') : empty('还不需要回头', '第一次修改或删除内容后，备份会自动出现在这里。', 'settings-backup-restore');
}
function dialog(title, content, actions, cls = '', getExtra = null) {
  const element = $('#dialog');
  element.className = cls;
  element.innerHTML = `<div class="dialog-heading"><h2>${title}</h2>${iconButton('close-dialog', '关闭窗口', 'close')}</div><div class="dialog-content">${content}</div><div class="dialog-actions">${actions.map((action, index) => `<button type="button" class="btn m3-state-layer ${action.primary ? 'primary' : 'tonal'}" data-dialog-index="${index}">${action.label}</button>`).join('')}</div>`;
  element.showModal();
  return new Promise(resolve => {
    let complete = false;
    const finish = value => { if (complete) return; complete = true; element.removeEventListener('click', click); element.removeEventListener('cancel', cancel); element.removeEventListener('close', closed); element.close(); resolve(value); };
    const click = event => { const button = event.target.closest('[data-dialog-index]'); if (button) finish(getExtra ? { value: actions[Number(button.dataset.dialogIndex)].value, extra: getExtra() } : actions[Number(button.dataset.dialogIndex)].value); else if (event.target.closest('[data-action="close-dialog"]')) finish(null); };
    const cancel = event => { event.preventDefault(); finish(null); };
    const closed = () => finish(null);
    element.addEventListener('click', click); element.addEventListener('cancel', cancel); element.addEventListener('close', closed);
  });
}
async function perform(action, element) {
  if (action.startsWith('setting-')) {
    const job = await settingsUI.perform(action, element);
    if (job?.status === 'running') { state.job = job; state.busy = true; if (state.view === 'publish') renderPublish(); pollJob(); }
    return;
  }
  const { kind, id, view, url, target } = element.dataset;
  if (action === 'nav') return navigate(view);
  if (action === 'stat') return navigate(view);
  if (action === 'mobile-nav') { $('.sidebar').classList.toggle('mobile-open'); syncMobileNav(); return; }
  if (action === 'theme') { localStorage.setItem('studio-theme', document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); applyTheme(); return; }
  if (action === 'new-post' || action === 'new-moment') return openEditor(action === 'new-post' ? 'posts' : 'moments');
  if (action === 'edit' || action === 'duplicate') return openEditor(kind, id, action === 'duplicate');
  if (action === 'filter') { state.filter = element.dataset.filter; renderCollection(); return; }
  if (action === 'editor-back') return navigate(state.editor.kind);
  if (action === 'save') return saveEditor();
  if (action === 'editor-publish') {
    if (state.uploading) { toast('请等待图片上传完成'); return; }
    state.editor.metadata.draft = false; $('[data-field="draft"]').checked = false; onEdit();
    if (await saveEditor()) { state.editor = null; await navigate('publish'); await reviewPublish(); } return;
  }
  if (action === 'mode') { state.editor.mode = element.dataset.mode; $('#editor-panes').className = 'editor-panes mode-' + state.editor.mode; $$('[data-action="mode"]').forEach(btn => { btn.classList.toggle('selected', btn.dataset.mode === state.editor.mode); btn.setAttribute('aria-pressed', String(btn.dataset.mode === state.editor.mode)); }); return; }
  if (action === 'format') return format(element.dataset.format);
  if (action === 'editor-upload' || action === 'image-upload') { state.uploadTarget = action === 'image-upload' && state.editor.kind === 'posts' ? 'cover' : 'body'; $('#editor-files').click(); return; }
  if (action === 'pick-media' || action === 'pick-cover') return pickMedia(action === 'pick-cover' && state.editor.kind === 'posts' ? 'cover' : 'body');
  if (action === 'insert-media') { insertImage(url, target); $('#dialog').close(); return; }
  if (action === 'remove-cover') { state.editor.metadata.image = ''; $('[data-field="image"]').value = ''; $('#cover-preview').innerHTML = coverPreview(); onEdit(); return; }
  if (action === 'remove-image') { state.editor.metadata.images.splice(Number(element.dataset.index), 1); $('#moment-image-list').innerHTML = momentImages(); bindImageAlts(); onEdit(); return; }
  if (action === 'media-upload') { $('#media-files').click(); return; }
  if (action === 'copy-media') { await navigator.clipboard.writeText(url); toast('图片地址已复制'); return; }
  if (action === 'view-media') return dialog('图片预览', `<img class="large-image" src="${esc(localImage(url))}" alt="图片预览"><code>${esc(url)}</code>`, [{ label: '关闭', value: null }], 'wide');
  if (action === 'refresh-plan') return loadPlan();
  if (action === 'check') return startJob('check');
  if (action === 'review-publish') return reviewPublish();
  if (action === 'export') {
    const editor = state.editor;
    const text = '---\n' + Object.entries(editor.metadata).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n') + '\n---\n\n' + editor.body;
    const blob = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' })); const link = document.createElement('a'); link.href = blob; link.download = editor.id.split('/').pop(); link.click(); setTimeout(() => URL.revokeObjectURL(blob), 1000); return;
  }
  if (action === 'delete') {
    const item = await api(`item?kind=${kind}&id=${encodeURIComponent(id)}`);
    if (await dialog('删除这条内容？', `<p><strong>${esc(titleOf(item))}</strong></p><p>删除会保存本机备份。图片会保留在媒体库；删除结果在下次推送后生效。</p>`, [{ label: '保留内容', value: false }, { label: '删除并留备份', value: true, primary: true }])) { await api('delete', { kind, id, revision: item.revision }); await loadContent(); shell(); toast('已删除，可以从历史备份恢复'); } return;
  }
  if (action === 'restore') {
    if (await dialog('恢复这个文件版本？', '<p>当前版本也会先备份，然后用历史内容恢复文件。恢复后不会自动推送。</p>', [{ label: '取消', value: false }, { label: '恢复版本', value: true, primary: true }])) { await api('restore', { key: element.dataset.key }); await loadContent(); renderBackups(); toast('已恢复到内容仓'); } return;
  }
}
document.addEventListener('click', async event => {
  const element = event.target.closest('[data-action]'); if (!element || element.disabled) return;
  event.preventDefault();
  try { await perform(element.dataset.action, element); } catch (error) { toast(error.message, true); }
});
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && ['settings', 'deployment'].includes(state.view)) { event.preventDefault(); settingsUI.perform('setting-save', { dataset: {} }).catch(error => toast(error.message, true)); return; }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && state.editor) { event.preventDefault(); saveEditor(); }
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && state.editor && !$('#dialog').open) { event.preventDefault(); perform('editor-publish', { dataset: {} }).catch(error => toast(error.message, true)); }
  if (event.key === 'Escape') { $('.sidebar')?.classList.remove('mobile-open'); syncMobileNav(); }
  if (event.key === 'Enter' && event.target.classList.contains('dropzone')) $('#media-files')?.click();
});
document.addEventListener('dragover', event => { if ((state.editor || state.view === 'media') && event.dataTransfer.types.includes('Files')) { event.preventDefault(); $('#main').classList.add('drag-over'); } });
document.addEventListener('dragleave', event => { if (!event.relatedTarget) $('#main')?.classList.remove('drag-over'); });
document.addEventListener('drop', event => { $('#main')?.classList.remove('drag-over'); if (event.dataTransfer.files.length && (state.editor || state.view === 'media')) { event.preventDefault(); uploadFiles(event.dataTransfer.files, state.editor ? 'body' : 'library').catch(error => toast(error.message, true)); } });
document.addEventListener('paste', event => { const files = [...(event.clipboardData?.items || [])].filter(item => item.kind === 'file').map(item => item.getAsFile()).filter(Boolean); if (files.length && (state.editor || state.view === 'media')) { event.preventDefault(); uploadFiles(files, state.editor ? 'body' : 'library').catch(error => toast(error.message, true)); } });
window.addEventListener('beforeunload', event => { if (state.editor?.dirty || settingsUI.dirty || state.uploading || state.busy) { event.preventDefault(); event.returnValue = ''; } });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (state.boot) applyTheme(); });
function syncMobileNav() { const sidebar = $('.sidebar'); if (sidebar) sidebar.inert = matchMedia('(max-width:700px)').matches && !sidebar.classList.contains('mobile-open'); }
matchMedia('(max-width:700px)').addEventListener('change', syncMobileNav);

async function boot() {
  state.boot = await api('bootstrap'); document.title = '写作空间 · ' + state.boot.title;
  await loadContent();
  const initial = location.hash.slice(1); if (views[initial]) state.view = initial;
  shell();
  if (state.view === 'publish') await loadPlan();
  if (state.view === 'media') { state.media = (await api('media')).items; renderMedia(); }
  const current = (await api('job')).job;
  if (current) { state.job = current; if (current.status === 'running') { state.busy = true; pollJob(); } }
}
boot().catch(error => { $('#app').innerHTML = `<div class="boot"><h1>暂时无法打开写作空间</h1><p>${esc(error.message)}</p><button type="button" id="reload" class="btn primary">请刷新页面重试</button></div>`; $('#reload').addEventListener('click', () => location.reload()); });
