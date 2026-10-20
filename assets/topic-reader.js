/* 主题资料阅读器：保留材料的完整 HTML、脚本与表格。 */
(() => {
  'use strict';

  function initTopicReader() {
    const dataNode = document.getElementById('topic-data');
    const tablist = document.getElementById('topic-tabs');
    const frame = document.getElementById('topic-frame');
    const currentTitle = document.getElementById('topic-current');
    const sourceLink = document.getElementById('topic-source');
    const status = document.getElementById('topic-status');
    if (!dataNode || !tablist || !frame) return;

    function setStatus(message, state = '') {
      if (!status) return;
      status.textContent = message;
      status.dataset.state = state;
    }
    if (status) {
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
    }

    let data;
    try { data = JSON.parse(dataNode.textContent); }
    catch {
      setStatus('材料目录暂时无法读取，请从主题页的原始材料链接打开。', 'error');
      return;
    }

    const seenIds = new Set();
    const tabs = (Array.isArray(data.tabs) ? data.tabs : []).filter((tab) => {
      if (!tab || !String(tab.id || '').trim() || seenIds.has(String(tab.id))) return false;
      seenIds.add(String(tab.id));
      return true;
    }).map((tab) => ({
      id: String(tab.id), label: String(tab.label || tab.title || tab.id),
      title: String(tab.title || tab.label || tab.id),
      href: String(tab.href || ''), html: typeof tab.html === 'string' ? tab.html : '',
      notice: String(tab.notice || ''), status: String(tab.status || '')
    }));
    if (!tabs.length) {
      setStatus('本主题暂时没有可阅读的材料。', 'empty');
      frame.hidden = true;
      return;
    }

    const tabMap = new Map(tabs.map((tab) => [tab.id, tab]));
    const buttons = new Map();
    const scrollPositions = new Map();
    const storageKey = `school-topic-scroll:${window.location.pathname}:${String(data.id || '')}`;
    try {
      const stored = JSON.parse(sessionStorage.getItem(storageKey) || '{}');
      Object.entries(stored).forEach(([id, position]) => {
        if (tabMap.has(id) && Number.isFinite(position) && position >= 0) scrollPositions.set(id, position);
      });
    } catch { /* 私密浏览或存储不可用时，当前页面内仍保留阅读位置。 */ }

    let activeId = '';
    let epoch = 0;
    let attachedEpoch = -1;
    let frameCleanup = () => {};
    let measureRequest = 0;
    let readinessTimer = 0;
    let slowTimer = 0;
    let restoreRequest = 0;
    let restorePending = false;
    let lastHeight = 0;

    tablist.setAttribute('role', 'tablist');
    tablist.setAttribute('aria-orientation', 'horizontal');
    if (!tablist.hasAttribute('aria-label')) tablist.setAttribute('aria-label', `${String(data.title || '主题')}材料`);
    frame.setAttribute('role', 'tabpanel');
    frame.setAttribute('scrolling', 'no');
    frame.setAttribute('referrerpolicy', 'no-referrer-when-downgrade');
    frame.classList.add('topic-frame');
    try { window.history.scrollRestoration = 'manual'; } catch { /* 浏览器不支持时保留默认行为。 */ }

    function safeUrl(value) {
      try {
        const url = new URL(value, document.baseURI);
        return ['http:', 'https:', 'file:'].includes(url.protocol) ? url.href : null;
      } catch { return null; }
    }
    function rememberPosition() {
      if (!activeId || restorePending) return;
      scrollPositions.set(activeId, Math.max(0, window.scrollY || 0));
      try { sessionStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(scrollPositions))); }
      catch { /* 无持久存储时只使用内存记录。 */ }
    }
    function currentHashId() {
      try { return decodeURIComponent(window.location.hash.slice(1)); }
      catch { return ''; }
    }
    function keepTabVisible(button) {
      const bounds = button.getBoundingClientRect();
      const parentBounds = tablist.getBoundingClientRect();
      if (bounds.left < parentBounds.left) tablist.scrollLeft -= parentBounds.left - bounds.left + 10;
      else if (bounds.right > parentBounds.right) tablist.scrollLeft += bounds.right - parentBounds.right + 10;
    }
    function escapeAttribute(value) {
      return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    function embeddedHtml(tab, absoluteHref) {
      const viewportHeight = Math.max(320, Math.min(1000, window.innerHeight - 90));
      const injected = `<base href="${escapeAttribute(absoluteHref)}">` +
        `<script>(()=>{const original=history.replaceState;history.replaceState=function(state,title,url){` +
        `if(arguments.length<3)return original.apply(this,arguments);` +
        `const next=location.protocol==='about:'&&typeof url==='string'&&url.startsWith('#')?new URL(url,location.href).href:url;` +
        `return original.call(this,state,title,next);};})();<\/script>` +
        `<meta name="topic-material-id" content="${escapeAttribute(tab.id)}">` +
        `<style id="topic-frame-adjustments">` +
        `html,body{height:auto!important;min-height:0!important;overflow-y:visible!important;scroll-behavior:auto!important}` +
        `#material-library-bar>a,.reader-topbar>a{display:none!important}` +
        `iframe,embed,object[type="application/pdf"]{max-height:${viewportHeight}px!important}` +
        `@media(max-width:720px){` +
        `table{display:block!important;width:100%!important;min-width:0!important;max-width:100%!important;overflow-x:auto!important}` +
        `th,td{min-width:100px!important}` +
        `.scroll,.rp .scroll{min-width:0!important;max-width:100%!important;overflow-x:auto!important}` +
        `.scroll table,.rp .scroll table{display:table!important;width:max-content!important;max-width:none!important}` +
        `}` +
        `</style>`;
      const head = /<head\b[^>]*>/i.exec(tab.html);
      if (head) return tab.html.slice(0, head.index + head[0].length) + injected + tab.html.slice(head.index + head[0].length);
      const html = /<html\b[^>]*>/i.exec(tab.html);
      if (html) return tab.html.slice(0, html.index + html[0].length) + `<head>${injected}</head>` + tab.html.slice(html.index + html[0].length);
      return `<head>${injected}</head>${tab.html}`;
    }
    function restorePosition() {
      if (!restorePending) return;
      restorePending = false;
      const top = scrollPositions.get(activeId) || 0;
      // 由外层页面承载纵向滚动，切换材料时恢复各自的阅读位置。
      window.scrollTo({top, left: 0, behavior: 'auto'});
    }
    function scheduleMeasure() {
      if (measureRequest || document.hidden) return;
      measureRequest = window.requestAnimationFrame(() => {
        measureRequest = 0;
        measureFrame();
      });
    }
    function measureFrame() {
      if (attachedEpoch !== epoch || document.hidden || frame.hidden) return;
      let doc;
      try { doc = frame.contentDocument; if (!doc || !doc.body) return; }
      catch { return; }
      const body = doc.body;
      const computed = frame.contentWindow.getComputedStyle(body);
      const margin = (parseFloat(computed.marginTop) || 0) + (parseFloat(computed.marginBottom) || 0);
      // 不取 documentElement.scrollHeight：它至少等于 iframe 旧高度，会阻止短页缩回。
      const height = Math.min(2000000, Math.max(320, Math.ceil(Math.max(
        body.scrollHeight, body.offsetHeight, body.getBoundingClientRect().height
      ) + margin + 2)));
      if (Math.abs(height - lastHeight) > 1) {
        lastHeight = height;
        frame.style.height = `${height}px`;
      }
      if (restorePending) {
        window.cancelAnimationFrame(restoreRequest);
        restoreRequest = window.requestAnimationFrame(restorePosition);
      }
    }

    function attachFrame(loadEpoch, loadEvent = false) {
      if (loadEpoch !== epoch) return false;
      if (attachedEpoch === loadEpoch) { scheduleMeasure(); return true; }
      const tab = tabMap.get(activeId);
      let doc;
      try {
        doc = frame.contentDocument;
        if (!doc) {
          if (loadEvent) throw new Error('inaccessible_frame');
          return false;
        }
        if (!doc.body || doc.readyState === 'loading') return false;
        if (!tab.html && doc.URL === 'about:blank') return false;
        const marker = doc.querySelector('meta[name="topic-material-id"]');
        if (tab.html && (!marker || marker.content !== activeId)) return false;
      } catch {
        // 跨域原始页面无法测高，保留可用的直达链接和原页面导航。
        attachedEpoch = loadEpoch;
        frame.style.height = `${Math.max(650, window.innerHeight)}px`;
        frame.style.visibility = 'visible';
        frame.setAttribute('scrolling', 'auto');
        frame.setAttribute('aria-busy', 'false');
        frame.removeAttribute('aria-hidden');
        frame.tabIndex = 0;
        window.clearTimeout(slowTimer);
        window.clearTimeout(readinessTimer);
        setStatus(tab.notice || tab.status || '已打开原始页面；如需独立阅读，可使用“打开原始材料”。', tab.notice ? 'notice' : 'fallback');
        restorePosition();
        return true;
      }
      attachedEpoch = loadEpoch;
      window.clearTimeout(readinessTimer);
      window.clearTimeout(slowTimer);
      const childWindow = frame.contentWindow;
      const disposers = [];

      // srcdoc 的相对资源通过首个 base 解析；页内锚点在外层滚动，避免重载材料。
      const onLinkClick = (event) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const anchor = event.target.closest && event.target.closest('a[href]');
        if (!anchor || anchor.hasAttribute('download')) return;
        const raw = anchor.getAttribute('href');
        if (!raw) return;
        let targetUrl;
        let materialUrl;
        try { targetUrl = new URL(raw, doc.baseURI); materialUrl = new URL(safeUrl(tab.href)); }
        catch { return; }
        if (!['http:', 'https:', 'file:'].includes(targetUrl.protocol)) return;
        const sameMaterial = targetUrl.origin === materialUrl.origin && targetUrl.pathname === materialUrl.pathname && targetUrl.search === materialUrl.search;
        if (targetUrl.hash && (raw.startsWith('#') || sameMaterial)) {
          let id;
          try { id = decodeURIComponent(targetUrl.hash.slice(1)); } catch { return; }
          const target = doc.getElementById(id) || doc.getElementsByName(id)[0];
          if (!target) return;
          event.preventDefault();
          restorePending = false;
          const top = window.scrollY + frame.getBoundingClientRect().top + target.getBoundingClientRect().top - tablist.getBoundingClientRect().height - 18;
          window.scrollTo({top: Math.max(0, top), behavior: 'auto'});
        } else if (!raw.startsWith('#') && !sameMaterial && !anchor.target) {
          // 来源链接另开，防止它们替换当前材料并引入一个新的嵌套阅读页。
          anchor.target = '_blank';
          anchor.rel = `${anchor.rel || ''} noopener noreferrer`.trim();
        }
      };
      doc.addEventListener('click', onLinkClick);
      disposers.push(() => doc.removeEventListener('click', onLinkClick));

      if (typeof ResizeObserver === 'function') {
        const resizeObserver = new ResizeObserver(scheduleMeasure);
        resizeObserver.observe(doc.body);
        resizeObserver.observe(doc.documentElement);
        disposers.push(() => resizeObserver.disconnect());
      }
      if (typeof MutationObserver === 'function') {
        const mutationObserver = new MutationObserver(scheduleMeasure);
        mutationObserver.observe(doc.body, {subtree: true, childList: true, attributes: true, characterData: true});
        disposers.push(() => mutationObserver.disconnect());
      }
      ['load', 'transitionend', 'animationend', 'toggle'].forEach((eventName) => {
        doc.addEventListener(eventName, scheduleMeasure, true);
        disposers.push(() => doc.removeEventListener(eventName, scheduleMeasure, true));
      });
      childWindow.addEventListener('resize', scheduleMeasure);
      disposers.push(() => childWindow.removeEventListener('resize', scheduleMeasure));
      if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(() => { if (loadEpoch === epoch) scheduleMeasure(); }).catch(() => {});

      frameCleanup = () => disposers.forEach((dispose) => dispose());
      frame.style.visibility = 'visible';
      frame.removeAttribute('aria-hidden');
      frame.setAttribute('aria-busy', 'false');
      frame.tabIndex = 0;
      setStatus(tab.notice || tab.status || '全文阅读', tab.notice ? 'notice' : 'ready');
      scheduleMeasure();
      return true;
    }

    function activate(id, historyMode = 'none') {
      const tab = tabMap.get(id) || tabs[0];
      if (activeId === tab.id) { keepTabVisible(buttons.get(tab.id)); return; }
      rememberPosition();
      frameCleanup(); frameCleanup = () => {};
      window.clearTimeout(readinessTimer);
      window.clearTimeout(slowTimer);
      window.cancelAnimationFrame(measureRequest); measureRequest = 0;
      window.cancelAnimationFrame(restoreRequest);
      activeId = tab.id;
      epoch += 1;
      const loadEpoch = epoch;
      attachedEpoch = -1;
      restorePending = true;
      lastHeight = 0;
      buttons.forEach((button, buttonId) => {
        const selected = buttonId === tab.id;
        button.setAttribute('aria-selected', String(selected));
        button.tabIndex = selected ? 0 : -1;
        button.classList.toggle('is-active', selected);
      });
      keepTabVisible(buttons.get(tab.id));
      const url = new URL(window.location.href);
      url.hash = tab.id;
      if (historyMode === 'push') window.history.pushState({topicTab: tab.id}, '', url);
      else if (historyMode === 'replace') window.history.replaceState({topicTab: tab.id}, '', url);

      const absoluteHref = safeUrl(tab.href);
      if (currentTitle) currentTitle.textContent = tab.title;
      if (sourceLink) {
        sourceLink.hidden = !absoluteHref;
        if (absoluteHref) sourceLink.href = absoluteHref;
        sourceLink.target = '_blank';
        sourceLink.rel = 'noopener noreferrer';
        if (!sourceLink.textContent.trim()) sourceLink.textContent = '打开原始材料 ↗';
      }
      frame.hidden = false;
      frame.style.visibility = 'hidden';
      frame.setAttribute('aria-hidden', 'true');
      frame.setAttribute('aria-busy', 'true');
      frame.setAttribute('scrolling', 'no');
      frame.setAttribute('aria-labelledby', buttons.get(tab.id).id);
      frame.title = tab.title;
      frame.tabIndex = -1;
      // 加载期间保留足够页面高度，防止旧材料较长时浏览器提前截断滚动位置。
      frame.style.height = `${Math.max(600, scrollPositions.get(tab.id) || 0, window.innerHeight)}px`;
      setStatus(tab.notice || tab.status || '全文阅读', tab.notice ? 'notice' : 'loading');
      if (!absoluteHref) {
        frame.hidden = true;
        restorePending = false;
        setStatus([tab.notice, '这份材料的原始链接不可用，请返回主题目录选择其他材料。'].filter(Boolean).join(' '), 'error');
        return;
      }
      frame.onload = () => attachFrame(loadEpoch, true);
      if (tab.html.trim()) {
        frame.removeAttribute('src');
        frame.srcdoc = embeddedHtml(tab, absoluteHref);
      } else {
        frame.removeAttribute('srcdoc');
        frame.src = absoluteHref;
      }
      // 不等待远程图片结束：DOM就绪即可显示全文，后续资源与内部Tab变化继续测高。
      let attempts = 0;
      const checkReady = () => {
        if (loadEpoch !== epoch || attachFrame(loadEpoch)) return;
        attempts += 1;
        if (attempts < 250) readinessTimer = window.setTimeout(checkReady, 80);
      };
      readinessTimer = window.setTimeout(checkReady, 0);
      slowTimer = window.setTimeout(() => {
        if (loadEpoch === epoch && attachedEpoch !== loadEpoch) setStatus(tab.notice || '材料载入时间较长，可先使用“打开原始材料”阅读。', tab.notice ? 'notice' : 'slow');
      }, 16000);
    }

    const fragment = document.createDocumentFragment();
    tabs.forEach((tab) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.id = `topic-tab-${encodeURIComponent(tab.id)}`;
      button.dataset.tabId = tab.id;
      button.className = 'topic-tab';
      button.textContent = tab.label;
      button.title = tab.title;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-controls', frame.id);
      button.setAttribute('aria-selected', 'false');
      button.tabIndex = -1;
      buttons.set(tab.id, button);
      fragment.append(button);
    });
    tablist.replaceChildren(fragment);
    tablist.addEventListener('click', (event) => {
      const button = event.target.closest('[role="tab"]');
      if (button && buttons.get(button.dataset.tabId) === button) activate(button.dataset.tabId, 'push');
    });
    tablist.addEventListener('keydown', (event) => {
      const button = event.target.closest('[role="tab"]');
      if (!button || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const currentIndex = tabs.findIndex((tab) => tab.id === button.dataset.tabId);
      const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 :
        (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      const next = tabs[nextIndex];
      buttons.get(next.id).focus({preventScroll: true});
      activate(next.id, 'push');
    });
    window.addEventListener('hashchange', () => activate(currentHashId(), tabMap.has(currentHashId()) ? 'none' : 'replace'));
    window.addEventListener('resize', scheduleMeasure, {passive: true});
    window.addEventListener('beforeunload', rememberPosition);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) rememberPosition();
      else scheduleMeasure();
    });
    const initialId = currentHashId();
    activate(initialId, tabMap.has(initialId) ? 'none' : 'replace');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initTopicReader, {once: true});
  else initTopicReader();
})();
