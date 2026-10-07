const titles = { enable: '启用', title: '标题', subtitle: '副标题', description: '页面介绍', name: '名称', bio: '个人简介', avatar: '头像地址', site: '网站地址', lang: '语言', timeZone: '时区', content: '正文', text: '文字', icon: '图标', url: '链接地址', external: '在新窗口打开', links: '链接列表', preset: '预设', children: '子菜单', banner: '首页横幅', homeText: '首页文字', src: '图片来源', desktop: '电脑端', mobile: '手机端', themeColor: '主题配色', hue: '色相', fixed: '固定主题色', style: '样式', spec: '配色规范', toc: '文章目录', depth: '目录深度', displaySettings: '访客显示设置', arrangement: '侧栏布局', side: '侧栏位置', slot: '停靠位置', column: '所属栏', pages: '显示页面', collapseAfter: '折叠阈值', startOfWeek: '每周起始日', lazy: '延迟加载', provider: '服务提供方', favicon: '网站图标', base: '基础路径', topAppBar: '顶部导航', contentAlign: '内容对齐', wallpaperMode: '页面背景', defaultMode: '默认模式', typewriter: '打字效果', speed: '速度', loop: '循环', carousel: '轮播', interval: '间隔', waves: '波浪效果', dim: '图片遮罩', opacity: '不透明度', type: '类型', closable: '允许关闭', closeDuration: '关闭后隐藏时长', link: '行动链接', texture: '背景纹理', progressIndicator: '页面加载进度', imageOptimization: '正文图片', ogImage: '分享预览图' };
const widgets = { profile: ['博主资料', '头像、名称、个人简介与社交链接'], music: ['音乐播放器', '在侧栏展示音乐播放控制'], announcement: ['公告', '公告文字在「文字介绍 → 公告」中编辑'], categories: ['分类列表', '展示文章分类与折叠入口'], tags: ['标签云', '展示标签与标签索引入口'], series: ['文章系列', '展示系列专题与文章集合'], stats: ['站点统计', '文章数、字数和站点运行情况'], calendar: ['文章日历', '按日期浏览已发布的文章'], toc: ['文章目录', '文章页的章节导航，也受站点目录总开关影响'] };
const pages = ['home', 'archive', 'post', 'about', 'moments', 'friends', 'anime', 'skills', 'projects', 'devices', 'games', 'timeline', 'albums', 'compass', 'categories', 'tags', 'series', 'rss', 'atom', 'notFound'];
const pageLabels = { home: '首页', archive: '归档', post: '文章', about: '关于', moments: '瞬间', friends: '友链', anime: '番剧', skills: '技能', projects: '项目', devices: '设备', games: '游戏', timeline: '时间线', albums: '相册', compass: '罗盘', categories: '分类', tags: '标签', series: '系列', rss: 'RSS', atom: 'Atom', notFound: '404' };
const copy = value => value === undefined ? undefined : structuredClone(value);
const get = (value, path) => path.reduce((current, key) => current?.[key], value);
function set(value, path, next) { let current = value; path.slice(0, -1).forEach((key, index) => { current[key] ??= typeof path[index + 1] === 'number' ? [] : {}; current = current[key]; }); current[path.at(-1)] = next; }
function schemaFor(schema, value) {
  if (!schema?.anyOf) return schema || {};
  const branches = schema.anyOf;
  if (branches.every(b => b.enum && b.type === branches[0].type)) return { type: branches[0].type, enum: [...new Set(branches.flatMap(b => b.enum))], description: schema.description };
  return branches.find(b => b.type === (Array.isArray(value) ? 'array' : typeof value) && (!b.properties?.type?.enum || b.properties.type.enum.includes(value?.type))) || branches[0];
}
function emptyValue(schema) {
  const actual = schemaFor(schema);
  if (actual.enum) return actual.enum[0];
  if (actual.type === 'array') return [];
  if (actual.type === 'boolean') return false;
  if (actual.type === 'number') return 0;
  if (actual.type === 'object') return Object.fromEntries(Object.entries(actual.properties || {}).filter(([key, s]) => ['name', 'url', 'icon', 'preset', 'type', 'enable', 'slot', 'src', 'alt'].includes(key)).map(([key, s]) => [key, emptyValue(s)]));
  return '';
}

export function createSettingsUI({ api, toast, dialog, esc, icon, button, refreshBoot, navigate, busy }) {
  Object.assign(titles, { autoDeploy: '允许新部署', locked: '锁定发布', reason: '控制原因' });
  const state = { tab: 'texts', entry: null, draft: null, raw: '', dirty: false, entries: [], saving: false, view: 'settings', generation: 0 };
  const main = () => document.querySelector('#main');
  const key = path => esc(JSON.stringify(path));
  const label = path => typeof path.at(-1) === 'number' ? '项目内容' : titles[path.at(-1)] || path.at(-1);
  const field = (schema, value, path, depth = 0) => {
    const actual = schemaFor(schema, value), title = label(path), hint = schema?.description || actual.description || '';
    const heading = `<span>${esc(title)}</span>${hint ? `<small>${esc(hint)}</small>` : ''}`;
    if (depth > 8 || !actual.type) return `<label class="field setting-field">${heading}<textarea data-setting-path="${key(path)}" data-setting-type="json" rows="3">${esc(JSON.stringify(value ?? {}, null, 2))}</textarea></label>`;
    if (actual.type === 'object') return `<details class="setting-object" ${depth < 1 ? 'open' : ''}><summary>${esc(title)}${hint ? `<small>${esc(hint)}</small>` : ''}</summary><div class="settings-fields">${Object.entries(actual.properties || {}).map(([name, child]) => field(child, value?.[name], [...path, name], depth + 1)).join('')}${actual.additionalProperties && Object.keys(actual.properties || {}).length === 0 ? field({}, value || {}, path, 9) : ''}</div></details>`;
    if (actual.type === 'array') return `<div class="setting-list"><div class="setting-list-heading"><strong>${esc(title)}</strong>${button('setting-array-add', '添加一项', 'add', 'text', `data-path="${key(path)}"`)}</div>${hint ? `<p class="field-hint">${esc(hint)}</p>` : ''}${(value || []).map((item, index) => `<div class="setting-list-item"><div class="setting-item-tools"><span>第 ${index + 1} 项</span>${button('setting-array-up', '上移', null, 'text', `data-path="${key(path)}" data-index="${index}" ${index === 0 ? 'disabled' : ''}`)}${button('setting-array-down', '下移', null, 'text', `data-path="${key(path)}" data-index="${index}" ${index === value.length - 1 ? 'disabled' : ''}`)}${button('setting-array-remove', '移除', 'close', 'text', `data-path="${key(path)}" data-index="${index}"`)}</div>${field(actual.items, item, [...path, index], depth + 1)}</div>`).join('') || '<p class="field-hint">当前列表为空。</p>'}</div>`;
    if (actual.type === 'boolean') return `<label class="setting-switch"><span>${heading}</span><input type="checkbox" role="switch" data-setting-path="${key(path)}" data-setting-type="boolean" ${value ? 'checked' : ''}><span class="switch-track" aria-hidden="true"></span></label>`;
    if (actual.enum?.length > 1) return `<label class="field setting-field">${heading}<select data-setting-path="${key(path)}" data-setting-type="${actual.type}">${actual.enum.map(option => `<option value="${esc(option)}" ${option === value ? 'selected' : ''}>${esc(option)}</option>`).join('')}</select></label>`;
    if (actual.enum?.length === 1) return `<label class="field setting-field">${heading}<input value="${esc(value ?? actual.enum[0])}" readonly></label>`;
    const long = ['description', 'bio', 'content', 'text', 'subtitle'].includes(path.at(-1)) || typeof value === 'string' && value.length > 120;
    return `<label class="field setting-field">${heading}${long && actual.type === 'string' ? `<textarea rows="3" data-setting-path="${key(path)}" data-setting-type="string">${esc(value ?? '')}</textarea>` : `<input type="${actual.type === 'number' ? 'number' : 'text'}" ${actual.type === 'number' ? 'step="any"' : ''} value="${esc(value ?? '')}" data-setting-path="${key(path)}" data-setting-type="${actual.type}">`}</label>`;
  };
  const header = () => `<div class="page-heading"><div><div class="eyebrow">SITE CONTROL</div><h1>${state.view === 'deployment' ? '让每次上线都由你决定' : '让网站更像你'}</h1><p>${state.view === 'deployment' ? '控制新部署，继续安心写作。当前线上网站会保持可访问。' : '文字、页面和侧栏在这里调整，保存后通过发布中心同步到网站。'}</p></div></div>`;
  function frame() {
    main().innerHTML = header() + (state.view === 'deployment' ? '' : `<div class="settings-tabs" role="group" aria-label="设置分类">${[['texts', '文字介绍'], ['sidebar', '侧栏布局'], ['features', '页面与功能'], ['navigation', '导航菜单'], ['all', '详细配置']].map(([tab, title]) => `<button class="btn m3-state-layer ${tab === state.tab ? 'primary' : 'tonal'}" type="button" data-action="setting-tab" data-tab="${tab}">${title}</button>`).join('')}</div>`) + '<div id="settings-content"><section class="panel"><p class="loading">正在读取站点配置…</p></section></div>';
  }
  async function mount(view = 'settings') {
    state.view = view; state.entry = null; state.dirty = false;
    frame();
    const generation = ++state.generation;
    state.entries = (await api('settings')).entries;
    if (generation !== state.generation || !document.querySelector('#settings-content')) return;
    if (view === 'deployment') return open('deployment');
    if (state.tab === 'sidebar') return open('sidebar');
    if (state.tab === 'navigation') return open('nav-bar');
    if (state.tab === 'features') return renderFeatures();
    renderCatalog();
    await open(state.tab === 'texts' ? 'site' : 'site', false);
  }
  function catalog() {
    const names = state.tab === 'texts' ? ['site', 'profile', 'announcement', 'about-content', 'footer-content'] : state.entries.map(e => e.name);
    const extras = { 'about-content': '关于页正文', 'footer-content': '页脚文字与 HTML' };
    return `<aside class="settings-catalog" aria-label="配置文件">${names.map(name => `<button type="button" class="setting-domain ${name === state.entry?.name ? 'active' : ''}" data-action="setting-open" data-name="${name}">${esc(extras[name] || state.entries.find(e => e.name === name)?.label || name)}</button>`).join('')}</aside>`;
  }
  function renderCatalog() { document.querySelector('#settings-content').innerHTML = `<div class="settings-layout">${catalog()}<section class="panel settings-editor" id="setting-editor"><p class="loading">请选择一组设置。</p></section></div>`; }
  async function open(name, guard = true) {
    if (guard && !await leave()) return;
    const generation = ++state.generation;
    const entry = await api('setting?name=' + encodeURIComponent(name));
    if (generation !== state.generation || !document.querySelector('#settings-content')) return;
    state.entry = entry; state.draft = copy(entry.data); state.raw = entry.raw; state.dirty = false; state.rawEdited = false;
    if (['texts', 'all'].includes(state.tab) && state.view !== 'deployment') renderCatalog();
    else document.querySelector('#settings-content').innerHTML = '<section class="panel settings-editor" id="setting-editor"></section>';
    renderEditor();
  }
  function toolbar() {
    return `<div class="setting-toolbar"><div><h2>${esc(state.entry.label)}</h2><small id="setting-status">${state.dirty ? '有修改尚未保存' : '本机文件已载入'}</small></div><div>${button('setting-reload', '重新载入', 'refresh', 'tonal')}${button('setting-save', '保存到本机', 'save', 'primary', state.saving || busy() ? 'disabled' : '')}</div></div>`;
  }
  function renderEditor() {
    const entry = state.entry;
    if (entry.error) {
      document.querySelector('#setting-editor').innerHTML = toolbar() + `<div class="notice error">${esc(entry.error)}<br>请修复下方 YAML。保存前仍会校验网站配置。</div><textarea id="setting-yaml" class="yaml-repair" spellcheck="false" rows="20">${esc(state.raw)}</textarea>${button('setting-save-raw', '校验并保存 YAML', 'save', 'primary')}`;
      bind(); return;
    }
    document.querySelector('#setting-editor').innerHTML = toolbar() + (entry.name === 'deployment' ? deploymentMarkup() : entry.name === 'sidebar' ? sidebarMarkup() : entry.format === 'yaml' ? `<div class="settings-fields">${Object.entries(entry.schema.properties || {}).map(([name, schema]) => field(schema, state.draft[name], [name])).join('')}</div><details class="setting-object advanced-yaml"><summary>高级 YAML 编辑</summary><p>编辑并使用下方按钮保存。表单与 YAML 分开保存，避免意外覆盖。</p><textarea id="setting-yaml" spellcheck="false" rows="16">${esc(state.raw)}</textarea>${button('setting-save-raw', '保存 YAML', 'save', 'outlined')}</details>` : `<div class="notice">${entry.format === 'markdown' ? '这里的 Markdown 正文会出现在网站关于页。' : '这里的 HTML 在开启自定义页脚后进入网页，请只填写你希望公开的内容。'}</div><label class="field setting-field"><span>${entry.format === 'markdown' ? '关于页 Markdown 正文' : '页脚 HTML'}</span><textarea id="setting-document" spellcheck="false" rows="20">${esc(state.raw)}</textarea></label>${entry.format === 'markdown' ? button('setting-preview', '预览正文', 'visibility', 'tonal') + '<div class="preview markdown" id="setting-preview"></div>' : ''}`) + (entry.name === 'deployment' ? '' : '<p class="setting-footer">保存会保留历史备份。要更新线上网站，请前往发布中心检查并推送。</p>');
    bind(); preview();
  }
  function dirty() { state.dirty = true; document.querySelector('#setting-status').textContent = '有修改尚未保存'; preview(); }
  function bind() {
    document.querySelector('#setting-editor').oninput = event => {
      const input = event.target;
      try {
        if (input.dataset.settingPath) {
          const path = JSON.parse(input.dataset.settingPath), type = input.dataset.settingType;
          let value = type === 'boolean' ? input.checked : type === 'number' ? Number(input.value) : type === 'json' ? JSON.parse(input.value) : input.value;
          if (type === 'number' && (!input.value.trim() || !Number.isFinite(value))) throw new Error('请填写有效数字');
          set(state.draft, path, value); input.setCustomValidity(''); dirty();
        } else if (input.id === 'setting-document' || input.id === 'setting-yaml') { state.raw = input.value; state.rawEdited = input.id === 'setting-yaml'; dirty(); }
        else if (input.dataset.widget) {
          let item = state.draft.components.find(c => c.type === input.dataset.widget);
          if (!item) { item = { type: input.dataset.widget, enable: input.checked, slot: 'sticky', ...(input.dataset.widget === 'toc' ? { pages: ['post'] } : {}) }; state.draft.components.push(item); }
          item.enable = input.checked; dirty(); renderEditor();
        } else if (input.dataset.widgetPages !== undefined) {
          state.draft.components[Number(input.dataset.widgetPages)].pages = [...document.querySelectorAll(`[data-widget-pages="${input.dataset.widgetPages}"]:checked`)].map(box => box.value); dirty();
        }
      } catch (error) { input.setCustomValidity(error.message); input.reportValidity(); }
    };
  }
  function sidebarMarkup() {
    const data = state.draft;
    const summary = [['enable', { type: 'boolean' }], ['arrangement', { type: 'string', enum: ['single', 'dual'] }], ['side', { type: 'string', enum: ['left', 'right'] }]].map(([name, schema]) => field(schema, data[name], [name])).join('');
    const order = [...data.components.map(item => item.type), ...Object.keys(widgets).filter(type => !data.components.some(item => item.type === type))];
    return `<div class="sidebar-settings-top"><div class="settings-fields">${summary}</div><div class="sidebar-live-preview" id="sidebar-preview"></div></div><div class="notice">先启用侧栏总开关，再逐项启用模块。页面筛选留空表示全站；上移、下移可调整顺序。</div><div class="widget-grid">${order.map(type => {
      const index = data.components.findIndex(c => c.type === type), item = data.components[index], [title, note] = widgets[type] || [type, '侧栏模块'];
      return `<section class="widget-card"><label class="setting-switch"><span><strong>${title}</strong><small>${note}</small></span><input type="checkbox" role="switch" data-widget="${type}" ${item?.enable ? 'checked' : ''}><span class="switch-track" aria-hidden="true"></span></label>${item ? `<details class="setting-object"><summary>布局与显示页面</summary><div class="settings-fields">${field({ type: 'string', enum: ['top', 'sticky'] }, item.slot, ['components', index, 'slot'])}${field({ type: 'string', enum: ['primary', 'secondary'] }, item.column || 'primary', ['components', index, 'column'])}${['categories', 'tags', 'series'].includes(type) ? field({ type: 'number' }, item.collapseAfter ?? 5, ['components', index, 'collapseAfter']) : ''}${type === 'calendar' ? field({ type: 'string', enum: ['mon', 'sun'] }, item.startOfWeek || 'mon', ['components', index, 'startOfWeek']) : ''}</div><fieldset class="widget-pages"><legend>仅在这些页面展示（不选为全部）</legend>${pages.map(page => `<label><input type="checkbox" data-widget-pages="${index}" value="${page}" ${(item.pages || []).includes(page) ? 'checked' : ''}>${pageLabels[page]}</label>`).join('')}</fieldset><div class="widget-order">${button('setting-widget-up', '上移', null, 'text', `data-index="${index}" ${index === 0 ? 'disabled' : ''}`)}${button('setting-widget-down', '下移', null, 'text', `data-index="${index}" ${index === data.components.length - 1 ? 'disabled' : ''}`)}</div></details>` : '<p class="field-hint">当前未添加，启用后可配置位置与显示页面。</p>'}</section>`;
    }).join('')}</div>`;
  }
  function preview() {
    const target = document.querySelector('#sidebar-preview');
    if (target) target.innerHTML = `<small>侧栏布局预览</small>${state.draft.enable ? state.draft.components.filter(item => item.enable).map(item => `<span>${esc(widgets[item.type]?.[0] || item.type)}<em>${item.slot === 'top' ? '顶部' : '跟随滚动'}${item.column === 'secondary' ? ' · 副栏' : ''}</em></span>`).join('') || '<p>没有启用的模块</p>' : '<p>侧栏已关闭</p>'}`;
    const banner = document.querySelector('.deployment-banner');
    if (banner) { banner.classList.toggle('locked', state.draft.locked); banner.querySelector('h3').textContent = state.draft.locked ? '部署已锁定' : state.draft.autoDeploy ? '自动部署已开启' : '新部署已暂停'; }
  }
  function deploymentMarkup() {
    const data = state.draft;
    return `<div class="deployment-banner ${data.locked ? 'locked' : ''}"><span class="release-icon">${icon(data.locked ? 'visibility' : 'cloud-upload')}</span><div><h3>${data.locked ? '部署已锁定' : data.autoDeploy ? '自动部署已开启' : '新部署已暂停'}</h3><p>本机保存后立即约束后台；同步到远端后约束 GitHub 触发和生产构建。</p></div></div><div class="settings-fields">${field({ type: 'boolean', description: '关闭后可继续推送内容，但 GitHub 部署 Hook 和生产构建会暂停。' }, data.autoDeploy, ['autoDeploy'])}${field({ type: 'boolean', description: '开启后还会阻止本机后台推送文章与配置；部署控制本身仍可单独同步，以便解除锁定。' }, data.locked, ['locked'])}<label class="field setting-field"><span>暂停或锁定原因（可选）</span><textarea data-setting-path="${key(['reason'])}" data-setting-type="string" maxlength="500" rows="3">${esc(data.reason)}</textarea></label></div><div class="deployment-sync"><h3>把控制状态同步到远端</h3><p>仅提交并推送 deployment.json，其他待发布内容会继续留在本机。重新开启或解除锁定后，同步操作会触发一次构建。</p>${button('setting-sync-policy', '保存并同步部署控制', 'cloud-upload', 'primary', busy() || state.saving ? 'disabled' : '')}${button('setting-go-publish', '前往发布中心', 'arrow-outward', 'tonal')}<div id="policy-remote-status"></div></div><div class="notice">暂停不会撤回已发出的构建请求，也不会关闭已经上线的网站。生产构建锁需要主题使用更新后的构建脚本。</div>`;
  }
  function renderFeatures() {
    document.querySelector('#settings-content').innerHTML = `<section class="panel feature-intro"><h2>页面与网站功能</h2><p>开关会保存到本机配置，随后在发布中心统一推送。关闭页面时，网站导航会自动隐藏相应入口。</p></section><div class="feature-grid">${state.entries.filter(e => e.enabled !== null || e.error).map(entry => `<section class="panel feature-card"><label class="setting-switch"><span><strong>${esc(entry.label)}</strong><small>${entry.page ? '独立页面与导航入口' : '网站功能'}${entry.error ? ' · 配置待修复' : ''}</small></span><input type="checkbox" role="switch" data-feature-name="${entry.name}" ${entry.enabled ? 'checked' : ''} ${entry.error || busy() ? 'disabled' : ''}><span class="switch-track" aria-hidden="true"></span></label>${button('setting-open', '详细设置', 'arrow-outward', 'text', `data-name="${entry.name}"`)}</section>`).join('')}</div>`;
    document.querySelector('#settings-content').addEventListener('change', async event => {
      const input = event.target; if (!input.dataset.featureName) return;
      input.disabled = true;
      try { const entry = await api('setting?name=' + input.dataset.featureName); entry.data.enable = input.checked; await api('settings/save', { name: entry.name, revision: entry.revision, data: entry.data }); state.entries.find(e => e.name === entry.name).enabled = input.checked; toast('已保存功能开关，待发布后生效'); }
      catch (error) { input.checked = !input.checked; toast(error.message, true); }
      finally { input.disabled = false; }
    });
  }
  async function save(rawMode = false) {
    if (state.saving || busy()) return false;
    if (state.entry?.error && !rawMode) { toast('请修复 YAML 后使用「校验并保存 YAML」', true); return false; }
    if (!state.entry || [...document.querySelectorAll('#setting-editor input,#setting-editor textarea')].some(input => !input.reportValidity())) return false;
    if (state.rawEdited && !rawMode) { toast('高级 YAML 已编辑，请使用「保存 YAML」或重新载入', true); return false; }
    const input = { name: state.entry.name, revision: state.entry.revision };
    if (rawMode || ['markdown', 'html'].includes(state.entry.format)) input.raw = state.raw;
    else input.data = state.draft;
    state.saving = true;
    try {
      const entry = await api('settings/save', input);
      state.entry = entry; state.draft = copy(entry.data); state.raw = entry.raw; state.dirty = false; state.rawEdited = false;
      await refreshBoot(); state.saving = false; renderEditor(); preview();
      toast('已保存到本机并保留备份'); return true;
    } catch (error) { toast(error.message, true); return false; }
    finally { state.saving = false; document.querySelector('[data-action="setting-save"]')?.removeAttribute('disabled'); }
  }
  async function leave() {
    if (state.saving) return false;
    if (!state.dirty) return true;
    const choice = await dialog('保存这次设置修改？', '<p>配置修改不会自动保存。保存到本机后，可在发布中心统一推送。</p>', [{ label: '继续编辑', value: 'cancel' }, { label: '放弃修改', value: 'discard' }, { label: '保存后离开', value: 'save', primary: true }]);
    if (!choice || choice === 'cancel') return false;
    if (choice === 'save' && !await save(state.rawEdited)) return false;
    state.dirty = false; state.rawEdited = false; return true;
  }
  async function perform(action, element) {
    if (action === 'setting-tab') { if (!await leave()) return; state.tab = element.dataset.tab; return mount(); }
    if (action === 'setting-open') return open(element.dataset.name);
    if (action === 'setting-reload') { if (await leave()) return open(state.entry.name, false); return; }
    if (action === 'setting-save') return save();
    if (action === 'setting-save-raw') return save(true);
    if (action === 'setting-go-publish') return navigate('publish');
    if (action === 'setting-preview') { document.querySelector('#setting-preview').innerHTML = (await api('preview', { body: state.raw })).html; return; }
    if (action.startsWith('setting-array-')) {
      const path = JSON.parse(element.dataset.path), index = Number(element.dataset.index), value = get(state.draft, path) || [];
      if (action === 'setting-array-add') {
        let schema = state.entry.schema;
        for (const part of path) schema = typeof part === 'number' ? schemaFor(schema).items : schemaFor(schema).properties[part];
        value.push(state.entry.name === 'nav-bar' && path.at(-1) === 'links' ? { preset: 'Home' } : emptyValue(schemaFor(schema).items));
      } else if (action === 'setting-array-remove') value.splice(index, 1);
      else { const target = index + (action === 'setting-array-up' ? -1 : 1); if (target >= 0 && target < value.length) [value[index], value[target]] = [value[target], value[index]]; }
      set(state.draft, path, value); dirty(); renderEditor(); return;
    }
    if (action === 'setting-widget-up' || action === 'setting-widget-down') {
      const list = state.draft.components, index = Number(element.dataset.index), target = index + (action.endsWith('up') ? -1 : 1);
      if (target >= 0 && target < list.length) [list[index], list[target]] = [list[target], list[index]];
      dirty(); renderEditor(); preview(); return;
    }
    if (action === 'setting-sync-policy') {
      if (!await save()) return;
      const plan = await api('pending?controlOnly=true');
      if (!plan.entries.length && !plan.ahead) { toast('部署控制已与上次同步的远端一致'); return; }
      if (!await dialog('同步部署控制到私有仓？', '<p>只推送部署控制文件，其他文章和设置继续留在本机。暂停或锁定时保持当前网站版本；开启且解锁时将触发新构建。</p>', [{ label: '取消', value: false }, { label: '同步控制状态', value: true, primary: true }])) return;
      const job = await api('publish', { controlOnly: true, fingerprint: plan.fingerprint, message: 'deploy: update deployment policy' });
      await navigate('publish'); return job;
    }
  }
  return { mount: async view => { try { await mount(view); preview(); if (view === 'deployment') { const plan = await api('pending?controlOnly=true'); const target = document.querySelector('#policy-remote-status'); if (target) target.innerHTML = `<p>远端状态（上次 Git 同步）：${plan.remoteDeployment ? plan.remoteDeployment.locked ? '已锁定' : plan.remoteDeployment.autoDeploy ? '自动部署开启' : '部署暂停' : '无法读取'}</p>`; } } catch (error) { if (document.querySelector('#settings-content')) document.querySelector('#settings-content').innerHTML = `<section class="panel"><div class="notice error">${esc(error.message)}</div></section>`; } }, perform, leave, get dirty() { return state.dirty; } };
}
