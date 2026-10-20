(() => {
  'use strict';
  const byId = (id) => document.getElementById(id);
  const nodes = {
    search: byId('library-search'), clearSearch: byId('clear-search'),
    categories: byId('category-nav'), filters: byId('quick-filters'),
    history: byId('history-only'), list: byId('library-list'),
    count: byId('results-count'), error: byId('load-error'),
    empty: byId('empty-state'), retry: byId('retry-load')
  };
  const filterNames = {all:'全部', report:'完整报告', module:'研究模块', finance:'财报研报', new:'新增研究', corrected:'校正版', contract:'原始合同'};
  const params = new URLSearchParams(window.location.search);
  const state = {
    query: params.get('q') || '', category: params.get('category') || 'all',
    filter: Object.hasOwn(filterNames, params.get('filter')) ? params.get('filter') : 'all',
    historyOnly: params.get('history') === '1', items: [], loaded: false
  };
  const asText = (value) => value == null ? '' : String(value);
  const normalize = (value) => asText(value).normalize('NFKC').toLocaleLowerCase('zh-CN');
  const isHistory = (item) => /^L(?:0[1-9]|[1-4]\d|5[0-3])$/i.test(asText(item.id));
  const tags = (item) => Array.isArray(item.tags) ? item.tags.map(asText).filter(Boolean) : [];
  const categoryOf = (item) => asText(item.category) || '未分类';
  const searchable = (item) => [item.id, item.title, item.category, item.kind, item.summary, item.originalName, item.status, correctionOf(item), ...tags(item)].map(asText).join(' ');
  const sourceLinks = (item) => Array.isArray(item.sourceLinks) ? item.sourceLinks : [];
  function correctionOf(item) {
    if (!item.correction) return '';
    if (typeof item.correction === 'string') return item.correction;
    if (Array.isArray(item.correction)) return item.correction.map(asText).join('；');
    if (typeof item.correction === 'object') return asText(item.correction.message || item.correction.summary || item.correction.text || item.correction.note || '本材料含重要纠错，请先阅读正文说明。');
    return '本材料含重要纠错，请先阅读正文说明。';
  }
  function safeUrl(value) {
    const raw = asText(value).trim();
    if (!raw) return null;
    try {
      const url = new URL(raw, window.location.href);
      return (['http:', 'https:'].includes(url.protocol) || (window.location.protocol === 'file:' && url.protocol === 'file:' && raw.startsWith('materials/'))) ? url.href : null;
    } catch { return null; }
  }
  function filterMatches(item, key) {
    const text = searchable(item);
    switch (key) {
      case 'report': return /完整报告|综合报告|总报告|整合重写|总体报告/.test(text) || /研究报告/.test(categoryOf(item));
      case 'module': return /研究模块|模块[一二三四五六七八九十\d]/.test(text) || /模块/.test(categoryOf(item));
      case 'finance': return /财报|研报|招股|上市|年报|半年报|中期报告|\bSEC\b|\b20-F\b|\b424B3\b/i.test(text);
      case 'new': return !isHistory(item) || /新增研究|新增深度研究/.test(categoryOf(item));
      case 'corrected': return Boolean(correctionOf(item)) || /校正版|已校正|已纠错/.test([item.category, item.status, ...tags(item)].map(asText).join(' '));
      case 'contract': return /原始合同|合同原件|协议原件/.test(text) || (/合同|协议/.test(text) && /DOCX|PDF|原始|原件/i.test([item.kind, item.category, item.originalName, ...tags(item)].map(asText).join(' ')));
      default: return true;
    }
  }
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function formatChars(value) {
    const count = Number(value);
    if (!Number.isFinite(count) || count < 0) return '体量未标注';
    if (count === 0) return '附件或外部来源';
    return `${new Intl.NumberFormat('zh-CN').format(count)} 字`;
  }
  function updateUrl() {
    const url = new URL(window.location.href);
    ['q', 'category', 'filter', 'history'].forEach((key) => url.searchParams.delete(key));
    if (state.query.trim()) url.searchParams.set('q', state.query.trim());
    if (state.category !== 'all') url.searchParams.set('category', state.category);
    if (state.filter !== 'all') url.searchParams.set('filter', state.filter);
    if (state.historyOnly) url.searchParams.set('history', '1');
    window.history.replaceState(null, '', url);
  }
  function renderCategories() {
    const counts = new Map();
    state.items.forEach((item) => counts.set(categoryOf(item), (counts.get(categoryOf(item)) || 0) + 1));
    if (state.category !== 'all' && !counts.has(state.category)) state.category = 'all';
    const fragment = document.createDocumentFragment();
    [['all', state.items.length], ...counts.entries()].forEach(([category, count]) => {
      const active = state.category === category;
      const button = element('button', `category-button${active ? ' is-active' : ''}`);
      button.type = 'button'; button.dataset.category = category;
      button.setAttribute('aria-pressed', String(active));
      button.append(element('span', '', category === 'all' ? '全部材料' : category), element('span', 'category-count', String(count)));
      fragment.append(button);
    });
    nodes.categories.replaceChildren(fragment);
  }
  function renderItem(item) {
    const row = element('article', 'document-row');
    row.dataset.materialId = asText(item.id);
    const id = element('div', 'document-id', item.id || '—');
    const content = element('div', 'document-content');
    const heading = element('h2', 'document-title');
    const path = safeUrl(item.path);
    if (path) { const link = element('a', '', item.title || item.originalName || '未命名材料'); link.href = path; heading.append(link); }
    else heading.textContent = item.title || item.originalName || '未命名材料';
    content.append(heading);
    if (item.summary) content.append(element('p', 'document-summary', item.summary));
    const tagRow = element('div', 'document-tags');
    const labels = [item.status, categoryOf(item), ...tags(item)].map(asText).filter(Boolean);
    [...new Set(labels)].forEach((label, index) => tagRow.append(element('span', `document-tag${index === 0 && item.status ? ' is-status' : ''}`, label)));
    content.append(tagRow);
    if (item.originalName) { const original = element('p', 'document-original'); original.append(element('span', '', '原文件'), document.createTextNode(asText(item.originalName))); content.append(original); }
    const correction = correctionOf(item);
    if (correction) { const note = element('p', 'document-correction'); note.append(element('strong', '', '纠错提示：'), document.createTextNode(correction)); content.append(note); }
    const links = sourceLinks(item).filter((source) => safeUrl(source.url));
    if (links.length) {
      const details = element('details', 'document-sources');
      details.append(element('summary', '', `原始来源 · ${links.length}`));
      const list = element('ul');
      links.forEach((source) => { const li = element('li'); const a = element('a', '', source.label || '打开原始来源'); a.href = safeUrl(source.url); a.target = '_blank'; a.rel = 'noopener noreferrer'; a.append(document.createTextNode(' ↗')); li.append(a); list.append(li); });
      details.append(list); content.append(details);
    }
    const facts = element('div', 'document-facts');
    facts.append(element('span', 'document-kind', item.kind || '文档'));
    const time = element('time', '', item.date || '未标日期');
    if (/^\d{4}-\d{2}-\d{2}$/.test(asText(item.date))) time.dateTime = item.date;
    facts.append(time, element('span', '', formatChars(item.chars)));
    if (path) { const open = element('a', 'document-open', '阅读'); open.href = path; open.setAttribute('aria-label', `阅读：${item.title || item.originalName || item.id}`); open.append(element('span', '', '→')); facts.append(open); }
    else facts.append(element('span', 'document-missing', '查看原始来源'));
    row.append(id, content, facts);
    return row;
  }
  function render() {
    if (!state.loaded) return;
    const words = normalize(state.query).trim().split(/\s+/).filter(Boolean);
    const matches = state.items.filter((item) =>
      (state.category === 'all' || categoryOf(item) === state.category) &&
      (!state.historyOnly || isHistory(item)) && filterMatches(item, state.filter) &&
      words.every((word) => normalize(searchable(item)).includes(word))
    );
    const fragment = document.createDocumentFragment();
    matches.forEach((item) => fragment.append(renderItem(item)));
    nodes.list.replaceChildren(fragment);
    nodes.list.hidden = matches.length === 0;
    nodes.empty.hidden = matches.length !== 0;
    nodes.list.setAttribute('aria-busy', 'false');
    nodes.count.replaceChildren(element('strong', '', String(matches.length)), document.createTextNode(` 条材料 / 共 ${state.items.length} 条`));
    nodes.clearSearch.hidden = !state.query;
    nodes.history.checked = state.historyOnly;
    nodes.filters.querySelectorAll('[data-filter]').forEach((button) => { const active = button.dataset.filter === state.filter; button.classList.toggle('is-active', active); button.setAttribute('aria-pressed', String(active)); });
    nodes.categories.querySelectorAll('[data-category]').forEach((button) => { const active = button.dataset.category === state.category; button.classList.toggle('is-active', active); button.setAttribute('aria-pressed', String(active)); });
    updateUrl();
  }
  function updateMeta(meta) {
    if (meta.title) { byId('page-title').textContent = asText(meta.title); document.title = `${asText(meta.title)} · 资料目录`; }
    if (meta.builtDate) { byId('built-date').textContent = asText(meta.builtDate); if (/^\d{4}-\d{2}-\d{2}$/.test(asText(meta.builtDate))) byId('built-date').dateTime = meta.builtDate; }
    byId('total-count').textContent = String(state.items.length);
    byId('original-count').textContent = asText(meta.originalInventoryCount ?? state.items.filter(isHistory).length);
    byId('body-count').textContent = asText(meta.bodyPages ?? state.items.filter((item) => safeUrl(item.path)).length);
    const sources = Array.isArray(meta.originalSourceLinks) ? meta.originalSourceLinks.length : meta.originalSourceLinks;
    byId('source-count').textContent = asText(sources ?? state.items.reduce((sum, item) => sum + sourceLinks(item).length, 0));
  }
  async function loadLibrary() {
    nodes.error.hidden = true; nodes.retry.disabled = true;
    nodes.count.textContent = '正在载入逐条材料目录…';
    nodes.list.setAttribute('aria-busy', 'true');
    try {
      const embedded = byId('library-data');
      let data;
      if (embedded) {
        data = JSON.parse(embedded.textContent);
      } else {
        const response = await fetch('./library.json', {cache:'no-store'});
        if (!response.ok) throw new Error('directory_unavailable');
        data = await response.json();
      }
      if (!data || !Array.isArray(data.items)) throw new Error('directory_invalid');
      state.items = data.items.filter((item) => item && typeof item === 'object');
      state.loaded = true;
      updateMeta(data.meta || {}); renderCategories(); render();
    } catch {
      nodes.error.hidden = false;
      nodes.list.setAttribute('aria-busy', 'false');
      if (!state.loaded) { nodes.list.hidden = true; nodes.empty.hidden = true; nodes.count.textContent = '目录暂未载入，可重试或使用上方阅读入口'; }
    } finally { nodes.retry.disabled = false; }
  }
  function resetFilters() {
    state.query = ''; state.category = 'all'; state.filter = 'all'; state.historyOnly = false;
    nodes.search.value = ''; render(); nodes.search.focus();
  }
  nodes.search.value = state.query;
  nodes.search.addEventListener('input', () => { state.query = nodes.search.value; render(); });
  nodes.clearSearch.addEventListener('click', () => { state.query = ''; nodes.search.value = ''; render(); nodes.search.focus(); });
  nodes.history.addEventListener('change', () => { state.historyOnly = nodes.history.checked; render(); });
  nodes.filters.addEventListener('click', (event) => { const button = event.target.closest('[data-filter]'); if (!button) return; state.filter = button.dataset.filter; render(); });
  nodes.categories.addEventListener('click', (event) => { const button = event.target.closest('[data-category]'); if (!button) return; state.category = button.dataset.category; render(); });
  byId('reset-filters').addEventListener('click', resetFilters);
  nodes.retry.addEventListener('click', loadLibrary);
  const inventory = byId("original-inventory");
  if (inventory && (state.query || state.category !== "all" || state.filter !== "all" || state.historyOnly || window.location.hash === "#library-main")) inventory.open = true;
  loadLibrary();
})();
