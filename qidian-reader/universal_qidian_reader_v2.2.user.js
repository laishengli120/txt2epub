// ==UserScript==
// @name         通用小说阅读器 - 起点阅读页风格
// @namespace    local.novel.reader
// @version      2.2.0
// @description  将其他小说网站当前页面中已经正常展示的小说正文，重新渲染为接近起点阅读页结构的统一阅读界面。目录驱动导航、无刷新切章、自动连续阅读并缓存原站完整目录。
// @author       local
// @match        http://*/*
// @match        https://*/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      *
// ==/UserScript==

(function () {
    'use strict';

    const APP_ID = '__qidian_like_reader_v2__';
    const STYLE_ID = APP_ID + '_style';

    const ENABLED_HOSTS_KEY = 'uqr_enabled_hosts_v2';
    const SETTINGS_KEY = 'uqr_settings_v2';
    const SHELF_KEY = 'uqr_bookshelf_v2';
    const BOOKMARK_KEY = 'uqr_bookmarks_v2';
    const PROGRESS_KEY = 'uqr_progress_v2';
    const CATALOG_CACHE_KEY = 'uqr_catalog_cache_v211';
    const CATALOG_CACHE_TTL = 12 * 60 * 60 * 1000;
    const CATALOG_MAX_PAGES = 40;
    const CATALOG_MAX_CHAPTERS = 12000;

    const LEGACY_ENABLED_HOSTS_KEY = 'uqr_enabled_hosts_v1';
    const LEGACY_SETTINGS_KEY = 'uqr_settings_v1';

    const DEFAULT_SETTINGS = {
        theme: 'paper',
        fontSize: 19,
        lineHeight: 2.15,
        contentWidth: 925,
        fontFamily: 'qidian',
        autoOpen: true,
        autoNext: false
    };

    const SITE_RULES = [
        {
            name: '飘天文学',
            host: /(^|\.)piaotia\.com$/i,
            chapter: ['h1', '.chapter-title', '.title'],
            content: [
                '#content', '#chaptercontent', '#chapter-content',
                '.chapter-content', '.content', '#htmlContent'
            ],
            title: [
                'meta[property="og:novel:book_name"]',
                'meta[property="og:title"]'
            ],
            prev: ['a[rel="prev"]'],
            next: ['a[rel="next"]'],
            catalog: [],
            catalogChapterSelectors: [
                '#list a[href]', '.listmain a[href]', '.book_list a[href]',
                '.chapterlist a[href]', '.chapter-list a[href]',
                'dl dd a[href]', 'dd a[href]'
            ],
            catalogPageSelectors: [
                '.page a[href]', '.pages a[href]',
                '.pagination a[href]', '.pager a[href]'
            ]
        }
    ];

    const GENERIC_RULE = {
        name: '通用识别',
        title: ['[data-book-name]', '.book-name', '.book-title', '.novel-title'],
        chapter: [
            '[data-chapter-name]', '.chapter-title', '.chapter-name',
            '.read-title', '.content-title', 'article h1', 'main h1', 'h1'
        ],
        content: [
            '[data-chapter-content]', '#chapter-content', '#chaptercontent',
            '#content', '#htmlContent', '.chapter-content', '.read-content',
            '.reader-content', '.content', 'article', 'main'
        ],
        prev: ['a[rel="prev"]', 'a.prev', '.prev a'],
        next: ['a[rel="next"]', 'a.next', '.next a'],
        catalog: ['a.catalog', '.catalog a'],
        catalogChapterSelectors: [
            '#list a[href]', '.listmain a[href]', '.book-list a[href]',
            '.book_list a[href]', '.chapter-list a[href]', '.chapterlist a[href]',
            '.catalog-list a[href]', 'dl dd a[href]'
        ],
        catalogPageSelectors: [
            '.page a[href]', '.pages a[href]', '.pagination a[href]',
            '.pager a[href]', '.page-box a[href]'
        ]
    };

    let sourceBodyOverflow = '';
    let routeUrl = location.href;
    let progressTimer = null;
    const CHAPTER_MEMORY_CACHE_MAX = 6;
    const AUTO_NEXT_THRESHOLD = 720;
    const chapterMemoryCache = new Map();
    const readerState = {
        currentData: null,
        initialDocumentUrl: location.href,
        navigationBusy: false,
        appendBusy: false,
        chapterData: new Map(),
        lastActiveUrl: location.href
    };

    function gmGet(key, fallback) {
        try { return GM_getValue(key, fallback); } catch (_) { return fallback; }
    }

    function gmSet(key, value) {
        try { GM_setValue(key, value); } catch (_) {}
    }

    function migrateLegacyData() {
        const v2Hosts = gmGet(ENABLED_HOSTS_KEY, null);
        if (!Array.isArray(v2Hosts)) {
            const oldHosts = gmGet(LEGACY_ENABLED_HOSTS_KEY, []);
            gmSet(ENABLED_HOSTS_KEY, Array.isArray(oldHosts) ? oldHosts : []);
        }

        const v2Settings = gmGet(SETTINGS_KEY, null);
        if (!v2Settings || typeof v2Settings !== 'object') {
            const old = gmGet(LEGACY_SETTINGS_KEY, {});
            gmSet(SETTINGS_KEY, Object.assign({}, DEFAULT_SETTINGS, old || {}, {
                contentWidth: DEFAULT_SETTINGS.contentWidth,
                fontFamily: 'qidian'
            }));
        }
    }

    function getSettings() {
        return Object.assign({}, DEFAULT_SETTINGS, gmGet(SETTINGS_KEY, {}) || {});
    }

    function saveSettings(next) { gmSet(SETTINGS_KEY, next); }

    function getEnabledHosts() {
        const hosts = gmGet(ENABLED_HOSTS_KEY, []);
        return Array.isArray(hosts) ? hosts : [];
    }

    function isCurrentHostEnabled() { return getEnabledHosts().includes(location.hostname); }

    function enableCurrentHost() {
        const hosts = getEnabledHosts();
        if (!hosts.includes(location.hostname)) {
            hosts.push(location.hostname);
            gmSet(ENABLED_HOSTS_KEY, hosts);
        }
    }

    function disableCurrentHost() {
        gmSet(ENABLED_HOSTS_KEY, getEnabledHosts().filter(host => host !== location.hostname));
    }

    function escapeHTML(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function normalizeText(value) {
        return String(value || '')
            .replace(/\u00a0/g, ' ')
            .replace(/[ \t]+/g, ' ')
            .replace(/\r/g, '')
            .trim();
    }

    function normalizeHref(href) {
        if (!href) return '';
        try {
            const url = new URL(href, location.href);
            if (!/^https?:$/i.test(url.protocol)) return '';
            return url.href;
        } catch (_) { return ''; }
    }

    function textOf(el) {
        if (!el) return '';
        if (el.tagName === 'META') return normalizeText(el.getAttribute('content'));
        return normalizeText(el.textContent);
    }

    function firstElement(selectors, root = document) {
        for (const selector of selectors || []) {
            try { const el = root.querySelector(selector); if (el) return el; } catch (_) {}
        }
        return null;
    }

    function firstText(selectors, maxLength = 160) {
        for (const selector of selectors || []) {
            try {
                for (const node of document.querySelectorAll(selector)) {
                    const text = textOf(node);
                    if (text && text.length <= maxLength) return text;
                }
            } catch (_) {}
        }
        return '';
    }

    function chooseRule() {
        return SITE_RULES.find(rule => rule.host?.test(location.hostname)) || GENERIC_RULE;
    }

    function canonicalUrl(url) {
        try {
            const parsed = new URL(url, location.href);
            parsed.hash = '';
            parsed.search = '';
            let path = parsed.pathname.replace(/\/+/g, '/');
            if (path.length > 1) path = path.replace(/\/+$/, '');
            return `${parsed.origin}${path}`;
        } catch (_) { return ''; }
    }

    function getBookRootUrl(url) {
        try {
            const parsed = new URL(url, location.href);
            const parts = parsed.pathname.split('/');
            parts.pop();
            parsed.pathname = parts.join('/') + '/';
            parsed.search = '';
            parsed.hash = '';
            return parsed.href;
        } catch (_) { return ''; }
    }

    function catalogCacheKey(data) {
        const root = data.bookRoot || getBookRootUrl(data.sourceUrl);
        return `${canonicalUrl(root)}::${normalizeText(data.bookTitle).toLowerCase()}`;
    }

    function getCatalogCacheMap() {
        const cache = gmGet(CATALOG_CACHE_KEY, {});
        return cache && typeof cache === 'object' ? cache : {};
    }

    function getCachedCatalog(data) { return getCatalogCacheMap()[catalogCacheKey(data)] || null; }

    function saveCatalogCache(data, catalog) {
        const cache = getCatalogCacheMap();
        cache[catalogCacheKey(data)] = catalog;
        const entries = Object.entries(cache)
            .sort((a, b) => Number(b[1]?.fetchedAt || 0) - Number(a[1]?.fetchedAt || 0))
            .slice(0, 60);
        gmSet(CATALOG_CACHE_KEY, Object.fromEntries(entries));
    }

    function clearCatalogCacheForData(data) {
        const cache = getCatalogCacheMap();
        delete cache[catalogCacheKey(data)];
        gmSet(CATALOG_CACHE_KEY, cache);
    }

    function inferCatalogCandidates(data, rule) {
        const urls = [];
        const push = url => {
            const normalized = normalizeHref(url);
            if (normalized && !urls.includes(normalized)) urls.push(normalized);
        };
        const root = data.bookRoot || getBookRootUrl(data.sourceUrl);
        if (rule?.host?.test?.('piaotia.com') || /(^|\.)piaotia\.com$/i.test(location.hostname)) {
            push(root);
            try { push(new URL('index.html', root).href); push(new URL('index.htm', root).href); } catch (_) {}
            push(data.catalogUrlHint);
        } else {
            push(data.catalogUrlHint);
            push(root);
            try { push(new URL('index.html', root).href); push(new URL('index.htm', root).href); } catch (_) {}
        }
        return urls;
    }

    function normalizeCharsetName(value) {
        const charset = String(value || '').trim().replace(/["']/g, '').toLowerCase();
        if (!charset) return '';
        if (/^(gb2312|gbk|x-gbk|gb_2312-80|cp936|windows-936)$/.test(charset)) return 'gb18030';
        if (/^(utf8|utf-8)$/.test(charset)) return 'utf-8';
        if (/^(big5|big-5)$/.test(charset)) return 'big5';
        return charset;
    }

    function charsetFromHeaders(headers) {
        const raw = String(headers || '');
        const match = raw.match(/content-type\s*:[^\r\n]*charset\s*=\s*["']?([^;\s"']+)/i)
            || raw.match(/charset\s*=\s*["']?([^;\s"']+)/i);
        return normalizeCharsetName(match?.[1]);
    }

    function charsetFromMeta(bytes) {
        try {
            const head = new TextDecoder('windows-1252').decode(bytes.slice(0, Math.min(bytes.byteLength, 16384)));
            const match = head.match(/<meta[^>]+charset\s*=\s*["']?\s*([^\s"'/>;]+)/i)
                || head.match(/<meta[^>]+content\s*=\s*["'][^"']*charset\s*=\s*([^\s"';>]+)/i);
            return normalizeCharsetName(match?.[1]);
        } catch (_) { return ''; }
    }

    function mojibakeScore(text) {
        const value = String(text || '');
        if (!value) return 999999;
        const replacements = (value.match(/�/g) || []).length;
        const typical = (value.match(/锟斤拷|鏂囧瓧|绔犺妭|鐩綍|浣滆€?/g) || []).length;
        const controls = (value.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g) || []).length;
        const chinese = (value.match(/[\u3400-\u9fff]/g) || []).length;
        return replacements * 80 + typical * 40 + controls * 20 - Math.min(chinese, 300) * 0.05;
    }

    function decodeHTMLBytes(arrayBuffer, headers, url) {
        const bytes = new Uint8Array(arrayBuffer || new ArrayBuffer(0));
        if (!bytes.byteLength) return '';
        let host = '';
        try { host = new URL(url, location.href).hostname; } catch (_) {}
        const detected = charsetFromHeaders(headers) || charsetFromMeta(bytes);
        const candidates = [];
        const push = value => {
            value = normalizeCharsetName(value);
            if (value && !candidates.includes(value)) candidates.push(value);
        };
        if (/(^|\.)piaotia\.com$/i.test(host)) {
            if (detected === 'utf-8') push('utf-8'); else push('gb18030');
        }
        push(detected); push('utf-8'); push('gb18030'); push('big5');
        let bestText = '', bestScore = Infinity;
        for (const charset of candidates) {
            try {
                const text = new TextDecoder(charset, { fatal: false }).decode(bytes);
                const score = mojibakeScore(text);
                if (score < bestScore) { bestScore = score; bestText = text; }
            } catch (_) {}
        }
        if (!bestText) bestText = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
        return bestText;
    }

    async function requestDocumentText(url) {
        try {
            const response = await fetch(url, { method: 'GET', credentials: 'include', redirect: 'follow', cache: 'no-store' });
            if (response.ok) {
                const buffer = await response.arrayBuffer();
                const contentType = response.headers.get('content-type') || '';
                return {
                    text: decodeHTMLBytes(buffer, `Content-Type: ${contentType}`, response.url || url),
                    finalUrl: response.url || url
                };
            }
        } catch (_) {}

        if (typeof GM_xmlhttpRequest === 'function') {
            return await new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET', url, anonymous: false, timeout: 15000, responseType: 'arraybuffer',
                    onload: response => {
                        if (response.status >= 200 && response.status < 400) {
                            try {
                                const buffer = response.response instanceof ArrayBuffer
                                    ? response.response
                                    : new TextEncoder().encode(response.responseText || '').buffer;
                                resolve({
                                    text: decodeHTMLBytes(buffer, response.responseHeaders || '', response.finalUrl || url),
                                    finalUrl: response.finalUrl || url
                                });
                            } catch (error) { reject(error); }
                        } else reject(new Error(`HTTP ${response.status}`));
                    },
                    ontimeout: () => reject(new Error('页面请求超时')),
                    onerror: () => reject(new Error('页面请求失败'))
                });
            });
        }
        throw new Error('无法读取页面');
    }

    function parseHTMLDocument(html) { return new DOMParser().parseFromString(html, 'text/html'); }

    function cleanCatalogTitle(value) {
        return normalizeText(value).replace(/^\s*[»›>]+\s*/g, '').replace(/\s+/g, ' ').trim();
    }

    function isCatalogUtilityText(text) {
        const compact = String(text || '').replace(/\s/g, '');
        if (!compact) return true;
        return /^(首页|返回首页|返回书页|返回目录|章节目录|目录|上一章|下一章|上章|下章|上一页|下一页|尾页|末页|登录|注册|加入书架|手机阅读|下载客户端)$/.test(compact);
    }

    function looksLikeCatalogPageUrl(url) {
        try {
            const name = new URL(url).pathname.split('/').pop() || '';
            return /^(?:index|list|catalog|all|chapterlist)(?:[_-]?\d+)?\.(?:s?html?|xhtml)$/i.test(name);
        } catch (_) { return false; }
    }

    function looksLikeChapterHref(url, bookRoot, title) {
        try {
            const parsed = new URL(url), root = new URL(bookRoot), titleText = cleanCatalogTitle(title);
            if (parsed.origin !== root.origin || !parsed.pathname.startsWith(root.pathname)) return false;
            if (looksLikeCatalogPageUrl(parsed.href) || isCatalogUtilityText(titleText) || !titleText || titleText.length > 120) return false;
            const fileName = parsed.pathname.split('/').pop() || '';
            const isHtmlFile = /\.(?:s?html?|xhtml)$/i.test(fileName);
            const isLikelyChapterTitle =
                /第\s*[0-9零一二三四五六七八九十百千万两〇]+\s*[章节回卷集篇部]/.test(titleText) ||
                /^\s*\d+\s*[、.．:：\-\s]/.test(titleText) || /^\s*\d+\s*$/.test(titleText);
            if (isHtmlFile && parsed.pathname.startsWith(root.pathname)) return true;
            return isLikelyChapterTitle;
        } catch (_) { return false; }
    }

    function extractCatalogChapters(doc, pageUrl, data, rule) {
        const root = data.bookRoot || getBookRootUrl(data.sourceUrl), candidates = [], seenElements = new Set();
        const selectors = rule.catalogChapterSelectors || GENERIC_RULE.catalogChapterSelectors;
        for (const selector of selectors) {
            try {
                doc.querySelectorAll(selector).forEach(a => {
                    if (seenElements.has(a)) return;
                    seenElements.add(a); candidates.push(a);
                });
            } catch (_) {}
        }
        if (candidates.length < 3) {
            doc.querySelectorAll('a[href]').forEach(a => {
                if (!seenElements.has(a)) { seenElements.add(a); candidates.push(a); }
            });
        }
        const chapters = [];
        for (const a of candidates) {
            const title = cleanCatalogTitle(a.textContent || a.getAttribute('title') || '');
            if (!title || isCatalogUtilityText(title)) continue;
            let url = '';
            try { url = new URL(a.getAttribute('href') || '', pageUrl).href; } catch (_) { continue; }
            if (!looksLikeChapterHref(url, root, title)) continue;
            chapters.push({ title, url: canonicalUrl(url) });
            if (chapters.length >= CATALOG_MAX_CHAPTERS) break;
        }
        return chapters;
    }

    function extractCatalogPaginationUrls(doc, pageUrl, data, rule) {
        const root = data.bookRoot || getBookRootUrl(data.sourceUrl), result = [];
        const selectors = rule.catalogPageSelectors || GENERIC_RULE.catalogPageSelectors;
        for (const selector of selectors) {
            try {
                doc.querySelectorAll(selector).forEach(a => {
                    const text = normalizeText(a.textContent), href = a.getAttribute('href');
                    if (!href) return;
                    let url = '';
                    try { url = new URL(href, pageUrl).href; } catch (_) { return; }
                    try {
                        const parsed = new URL(url), rootUrl = new URL(root);
                        if (parsed.origin !== rootUrl.origin || !parsed.pathname.startsWith(rootUrl.pathname)) return;
                        const pageish = looksLikeCatalogPageUrl(url) || /上一页|下一页|首页|尾页|末页|^\d+$/.test(text);
                        if (pageish && !result.includes(url)) result.push(url);
                    } catch (_) {}
                });
            } catch (_) {}
        }
        return result;
    }

    function paginationOrder(url) {
        try {
            const name = new URL(url).pathname.split('/').pop() || '';
            const match = name.match(/(?:index|list|catalog|all|chapterlist)[_-]?(\d+)/i) || name.match(/(?:page|p)[_-]?(\d+)/i);
            return match ? Number(match[1]) : 0;
        } catch (_) { return 0; }
    }

    function dedupeCatalogChapters(chapters) {
        const seen = new Set(), result = [];
        for (const item of chapters) {
            const key = canonicalUrl(item.url);
            if (!key || seen.has(key)) continue;
            seen.add(key); result.push({ title: cleanCatalogTitle(item.title), url: key });
        }
        return result;
    }

    function normalizedChapterName(value) {
        return normalizeText(value).replace(/\s+/g, '').replace(/[《》【】[\]()（）]/g, '')
            .replace(/^.*?(?=第\s*[0-9零一二三四五六七八九十百千万两〇]+\s*[章节回卷集篇部])/, '').toLowerCase();
    }

    function findCurrentCatalogIndex(chapters, data) {
        const currentUrl = canonicalUrl(data.sourceUrl);
        let index = chapters.findIndex(item => canonicalUrl(item.url) === currentUrl);
        if (index >= 0) return index;
        try {
            const currentFile = new URL(currentUrl).pathname.split('/').pop();
            index = chapters.findIndex(item => {
                try { return new URL(item.url).pathname.split('/').pop() === currentFile; } catch (_) { return false; }
            });
            if (index >= 0) return index;
        } catch (_) {}
        const target = normalizedChapterName(data.chapter);
        if (target) {
            index = chapters.findIndex(item => {
                const name = normalizedChapterName(item.title);
                return name === target || (name.length > 3 && target.length > 3 && (name.includes(target) || target.includes(name)));
            });
        }
        return index;
    }

    function applyCatalogNavigation(data, catalog) {
        const chapters = catalog?.chapters || [], index = findCurrentCatalogIndex(chapters, data);
        data.catalogChapters = chapters; data.catalogIndex = index;
        data.catalogSourceUrl = catalog?.catalogUrl || data.catalogUrlHint || '';
        data.catalogFetchedAt = catalog?.fetchedAt || 0; data.catalogPageCount = catalog?.pageCount || 0;
        if (index >= 0) {
            data.prev = index > 0 ? chapters[index - 1].url : '';
            data.next = index < chapters.length - 1 ? chapters[index + 1].url : '';
            data.navigationSource = 'catalog';
            return true;
        }
        data.prev = data.sitePrev || ''; data.next = data.siteNext || ''; data.navigationSource = 'site-fallback';
        return false;
    }

    async function fetchCatalogFromCandidate(firstUrl, data, rule) {
        const visited = new Set(), queued = [], chapters = [];
        let detectedCatalogUrl = firstUrl;
        const enqueue = url => {
            const canonical = canonicalUrl(url);
            if (!canonical || visited.has(canonical) || queued.some(item => canonicalUrl(item) === canonical)) return;
            queued.push(url); queued.sort((a, b) => paginationOrder(a) - paginationOrder(b));
        };
        enqueue(firstUrl);
        while (queued.length && visited.size < CATALOG_MAX_PAGES) {
            const pageUrl = queued.shift(), key = canonicalUrl(pageUrl);
            if (!key || visited.has(key)) continue;
            visited.add(key);
            let response;
            try { response = await requestDocumentText(pageUrl); } catch (_) { continue; }
            const finalUrl = response.finalUrl || pageUrl;
            if (visited.size === 1) detectedCatalogUrl = finalUrl;
            const doc = parseHTMLDocument(response.text);
            chapters.push(...extractCatalogChapters(doc, finalUrl, data, rule));
            if (chapters.length >= CATALOG_MAX_CHAPTERS) break;
            extractCatalogPaginationUrls(doc, finalUrl, data, rule).forEach(enqueue);
        }
        const unique = dedupeCatalogChapters(chapters);
        if (unique.length < 2) throw new Error('目录页没有识别到足够章节');
        return { bookTitle:data.bookTitle, bookRoot:data.bookRoot, catalogUrl:detectedCatalogUrl,
            chapters:unique, fetchedAt:Date.now(), pageCount:visited.size };
    }

    async function ensureCatalog(data, options = {}) {
        if (!data?.ok) return null;
        const forceRefresh = Boolean(options.forceRefresh), cached = getCachedCatalog(data);
        if (cached?.chapters?.length && !forceRefresh) {
            const currentIndex = findCurrentCatalogIndex(cached.chapters, data);
            const fresh = Date.now() - Number(cached.fetchedAt || 0) < CATALOG_CACHE_TTL;
            if (currentIndex >= 0 && fresh) { applyCatalogNavigation(data, cached); return cached; }
        }
        const rule = chooseRuleForUrl(data.sourceUrl), candidates = inferCatalogCandidates(data, rule);
        let lastError = null;
        for (const candidate of candidates) {
            try {
                const catalog = await fetchCatalogFromCandidate(candidate, data, rule);
                if (findCurrentCatalogIndex(catalog.chapters, data) < 0) {
                    lastError = new Error('目录中未找到当前章节'); continue;
                }
                saveCatalogCache(data, catalog); applyCatalogNavigation(data, catalog); return catalog;
            } catch (error) { lastError = error; }
        }
        if (cached?.chapters?.length) {
            applyCatalogNavigation(data, cached);
            data.catalogRefreshError = String(lastError?.message || lastError || '');
            return cached;
        }
        data.prev = data.sitePrev || ''; data.next = data.siteNext || ''; data.navigationSource = 'site-fallback';
        data.catalogRefreshError = String(lastError?.message || lastError || '');
        return null;
    }

    function syncNavigationDom(data, root) {
        [['prev', data.prev], ['next', data.next]].forEach(([name, url]) => {
            const link = root.querySelector(`[data-nav="${name}"]`);
            if (!link) return;
            if (url) { link.setAttribute('href', url); link.removeAttribute('aria-disabled'); }
            else { link.removeAttribute('href'); link.setAttribute('aria-disabled', 'true'); }
        });
    }

    async function refreshCatalogForCurrentPage() {
        const data = document.getElementById(APP_ID) && readerState.currentData ? readerState.currentData : extractPage();
        if (!data.ok) { alert(data.reason || '当前页面不是可识别的小说章节页。'); return; }
        clearCatalogCacheForData(data);
        try {
            const catalog = await ensureCatalog(data, { forceRefresh: true });
            if (catalog?.chapters?.length) {
                alert(`目录刷新完成：${data.bookTitle}\n共缓存 ${catalog.chapters.length} 章，读取 ${catalog.pageCount || 1} 个目录页。\n上一章/下一章将优先按该目录顺序计算。`);
            } else alert('没有成功读取完整目录，当前章节将暂时使用网站自身导航作为兜底。');
        } catch (error) { alert(`目录刷新失败：${error?.message || error}`); }
    }

    function findByKeywords(keywords, preferredSelectors = []) {
        const preferred = firstElement(preferredSelectors);
        if (preferred?.href) return normalizeHref(preferred.getAttribute('href'));
        for (const a of document.querySelectorAll('a[href]')) {
            const label = normalizeText(a.textContent).replace(/\s/g, '');
            if (!label || label.length > 40) continue;
            if (keywords.some(k => label.includes(k))) {
                const href = normalizeHref(a.getAttribute('href'));
                if (href && href !== location.href) return href;
            }
        }
        return '';
    }

    function scoreContentElement(el) {
        if (!el) return -Infinity;
        const text = normalizeText(el.innerText);
        if (text.length < 250) return -Infinity;
        const paragraphs = el.querySelectorAll('p').length, brs = el.querySelectorAll('br').length;
        let linkChars = 0; el.querySelectorAll('a').forEach(a => { linkChars += normalizeText(a.textContent).length; });
        const rect = el.getBoundingClientRect();
        let score = text.length + paragraphs * 150 + brs * 18 - linkChars * 5;
        if (rect.width >= 520 && rect.width <= 1250) score += 1200;
        ['排行榜','热门推荐','网站导航','友情链接','登录注册','客户端下载','广告合作'].forEach(word => { if (text.includes(word)) score -= 220; });
        return score;
    }

    function findBestGenericContent() {
        const preferred = [...document.querySelectorAll('article, main, [role="main"], #content, #chaptercontent, #chapter-content, .chapter-content, .read-content, .reader-content, .content')];
        const candidates = preferred.length ? preferred : [...document.querySelectorAll('div')].slice(0, 1500);
        let best = null, score = -Infinity;
        candidates.forEach(el => { const current = scoreContentElement(el); if (current > score) { score = current; best = el; } });
        return best;
    }

    function cleanBookTitle(raw, chapter = '') {
        let value = normalizeText(raw); if (!value) return '';
        value = value.replace(/[-_|—–]\s*(起点中文网|小说阅读|全文阅读).*$/i, '')
            .replace(/最新章节.*$/i, '').replace(/全文阅读.*$/i, '')
            .replace(/免费阅读.*$/i, '').replace(/无弹窗.*$/i, '').trim();
        if (chapter && value.includes(chapter)) value = normalizeText(value.replace(chapter, ''));
        value = value.replace(/[，,、:：\-_|—–]+$/g, '').trim();
        return value.length <= 80 ? value : '';
    }

    function deriveBookTitle(rule, chapter, breadcrumbs) {
        const metaBook = textOf(document.querySelector('meta[property="og:novel:book_name"]')) || textOf(document.querySelector('meta[name="book_name"]'));
        if (metaBook) return cleanBookTitle(metaBook, chapter);
        const byRule = firstText(rule.title, 100);
        if (byRule && byRule !== chapter) { const cleaned = cleanBookTitle(byRule, chapter); if (cleaned) return cleaned; }
        if (breadcrumbs.length) {
            const likely = [...breadcrumbs].reverse().find(item => item && item !== chapter && item.length <= 30);
            if (likely) { const cleaned = cleanBookTitle(likely, chapter); if (cleaned) return cleaned; }
        }
        return cleanBookTitle(document.title, chapter) || '';
    }

    function extractBreadcrumbs() {
        const containers = ['.breadcrumb','.breadcrumbs','.bread-crumb','.crumb','.crumbs','.path','.location','#breadcrumb','#breadcrumbs'];
        for (const selector of containers) {
            try {
                const box = document.querySelector(selector); if (!box) continue;
                const items = [...box.querySelectorAll('a, span')].map(el => normalizeText(el.textContent))
                    .filter(text => text && text.length <= 28 && !/上一章|下一章|目录|登录|注册/.test(text));
                if (items.length) return [...new Set(items)].slice(-5);
            } catch (_) {}
        }
        return [];
    }

    function deriveChapter(rule) {
        const meta = textOf(document.querySelector('meta[property="og:novel:chapter_name"]')) || textOf(document.querySelector('meta[name="chapter_name"]'));
        if (meta) return meta;
        const byRule = firstText(rule.chapter, 120); if (byRule) return byRule;
        const title = normalizeText(document.title);
        const match = title.match(/((?:第\s*[0-9零一二三四五六七八九十百千万两〇]+\s*[章节回卷集篇部]\s*)[^_|\-—]{0,60})/i);
        return normalizeText(match?.[1] || title.split(/[_|\-—]/)[0] || '当前章节');
    }

    function deriveAuthor() {
        const meta = textOf(document.querySelector('meta[name="author"]')) || textOf(document.querySelector('meta[property="og:novel:author"]'));
        return meta || firstText(['[rel="author"]','.author a','.author','.writer','.book-author'], 40);
    }

    function derivePublishTime() {
        const meta = textOf(document.querySelector('meta[property="article:published_time"]')) || textOf(document.querySelector('time'));
        if (meta && meta.length <= 40) return meta;
        const match = (document.body.innerText || '').match(/(20\d{2}[年\-/.]\d{1,2}[月\-/.]\d{1,2}(?:日)?(?:\s+\d{1,2}:\d{2})?)/);
        return match?.[1] || '';
    }

    function isNavigationLine(line) {
        const compact = line.replace(/\s/g, '');
        if (!compact) return true; if (compact.length > 90) return false;
        const navWords = ['上一章','下一章','上章','下章','返回目录','返回书页','返回书架','章节目录','目录','首页'];
        const hits = navWords.filter(word => compact.includes(word)).length;
        if (hits >= 2) return true;
        return /^(上一章|下一章|返回目录|返回书页|章节目录)$/.test(compact);
    }

    function isChapterDuplicate(line, chapter, bookTitle) {
        const compact = line.replace(/\s/g, ''), c = (chapter || '').replace(/\s/g, ''), b = (bookTitle || '').replace(/\s/g, '');
        if (!compact) return false;
        if (c && compact === c) return true;
        if (c && compact.endsWith(c) && compact.length <= c.length + b.length + 8) return true;
        return Boolean(b && c && compact === b + c);
    }

    function sanitizeLines(rawText, chapter, bookTitle) {
        let lines = String(rawText || '').replace(/\u00a0/g, ' ').replace(/\r/g, '').split('\n').map(normalizeText).filter(Boolean);
        const firstPart = lines.slice(0, 18).filter(line => !isNavigationLine(line) && !isChapterDuplicate(line, chapter, bookTitle));
        lines = firstPart.concat(lines.slice(18));
        lines = lines.filter(line => !isNavigationLine(line) && !isChapterDuplicate(line, chapter, bookTitle));
        const deduped = []; lines.forEach(line => { if (deduped[deduped.length - 1] !== line) deduped.push(line); });
        return deduped;
    }

    function buildContentHTML(contentEl, chapter, bookTitle) {
        const lines = sanitizeLines(contentEl?.innerText || contentEl?.textContent || '', chapter, bookTitle);
        return lines.map(line => `<p>${escapeHTML(line)}</p>`).join('');
    }

    function countReadableChars(text) { return String(text || '').replace(/\s+/g, '').length; }

    function extractPage() {
        const rule = chooseRule(), chapter = deriveChapter(rule), breadcrumbs = extractBreadcrumbs();
        let contentEl = firstElement(rule.content);
        if (!contentEl || normalizeText(contentEl.innerText).length < 250) contentEl = findBestGenericContent();
        if (!contentEl) return { ok:false, reason:'没有识别到足够长的小说正文。' };
        const bookTitle = deriveBookTitle(rule, chapter, breadcrumbs), author = deriveAuthor();
        const contentHTML = buildContentHTML(contentEl, chapter, bookTitle);
        const plainContent = sanitizeLines(contentEl.innerText || '', chapter, bookTitle).join('\n');
        if (plainContent.length < 180) return { ok:false, reason:'识别到的正文过短，当前页面可能不是章节阅读页。' };
        const sitePrev = findByKeywords(['上一章','上章','上一页'], rule.prev);
        const siteNext = findByKeywords(['下一章','下章','下一页'], rule.next);
        const catalogUrlHint = findByKeywords(['返回目录','章节目录','目录'], rule.catalog);
        const bookPage = findByKeywords(['返回书页','书页','书籍详情'], []);
        const cleanBreadcrumbs = breadcrumbs.filter(item => item !== chapter && item !== bookTitle).slice(-3);
        return {
            ok:true, ruleName:rule.name || '通用识别', bookTitle:bookTitle || '当前小说', chapter, author,
            publishTime:derivePublishTime(), contentHTML, wordCount:countReadableChars(plainContent),
            sitePrev, siteNext, prev:sitePrev, next:siteNext, catalogUrlHint, catalog:catalogUrlHint, bookPage,
            breadcrumbs:cleanBreadcrumbs, sourceUrl:location.href, sourceHost:location.hostname,
            bookRoot:getBookRootUrl(location.href), catalogChapters:[], catalogIndex:-1, navigationSource:'site-fallback'
        };
    }

    function chooseRuleForUrl(pageUrl) {
        let host = location.hostname;
        try { host = new URL(pageUrl, location.href).hostname; } catch (_) {}
        return SITE_RULES.find(rule => rule.host?.test(host)) || GENERIC_RULE;
    }

    function firstElementInDoc(doc, selectors) {
        for (const selector of selectors || []) {
            try { const el = doc.querySelector(selector); if (el) return el; } catch (_) {}
        }
        return null;
    }

    function firstTextInDoc(doc, selectors, maxLength = 160) {
        for (const selector of selectors || []) {
            try {
                for (const node of doc.querySelectorAll(selector)) {
                    const text = textOf(node); if (text && text.length <= maxLength) return text;
                }
            } catch (_) {}
        }
        return '';
    }

    function extractBreadcrumbsFromDoc(doc) {
        const containers = ['.breadcrumb','.breadcrumbs','.bread-crumb','.crumb','.crumbs','.path','.location','#breadcrumb','#breadcrumbs'];
        for (const selector of containers) {
            try {
                const box = doc.querySelector(selector); if (!box) continue;
                const items = [...box.querySelectorAll('a, span')].map(el => normalizeText(el.textContent))
                    .filter(text => text && text.length <= 28 && !/上一章|下一章|目录|登录|注册/.test(text));
                if (items.length) return [...new Set(items)].slice(-5);
            } catch (_) {}
        }
        return [];
    }

    function findBestGenericContentInDoc(doc) {
        const preferred = [...doc.querySelectorAll('article, main, [role="main"], #content, #chaptercontent, #chapter-content, .chapter-content, .read-content, .reader-content, .content')];
        const candidates = preferred.length ? preferred : [...doc.querySelectorAll('div')].slice(0, 1500);
        let best = null, bestScore = -Infinity;
        for (const el of candidates) {
            const text = normalizeText(el.textContent || ''); if (text.length < 250) continue;
            const paragraphs = el.querySelectorAll('p').length, brs = el.querySelectorAll('br').length;
            let linkChars = 0; el.querySelectorAll('a').forEach(a => { linkChars += normalizeText(a.textContent).length; });
            let score = text.length + paragraphs * 150 + brs * 18 - linkChars * 5;
            ['排行榜','热门推荐','网站导航','友情链接','登录注册','客户端下载','广告合作'].forEach(word => { if (text.includes(word)) score -= 220; });
            if (score > bestScore) { bestScore = score; best = el; }
        }
        return best;
    }

    function findByKeywordsInDoc(doc, pageUrl, keywords, preferredSelectors = []) {
        const direct = firstElementInDoc(doc, preferredSelectors);
        if (direct?.getAttribute('href')) {
            try { return new URL(direct.getAttribute('href'), pageUrl).href; } catch (_) {}
        }
        for (const a of doc.querySelectorAll('a[href]')) {
            const label = normalizeText(a.textContent).replace(/\s/g, '');
            if (!label || label.length > 40 || !keywords.some(keyword => label.includes(keyword))) continue;
            try { const href = new URL(a.getAttribute('href'), pageUrl).href; if (href !== pageUrl) return href; } catch (_) {}
        }
        return '';
    }

    function deriveChapterFromDoc(doc, rule) {
        const meta = textOf(doc.querySelector('meta[property="og:novel:chapter_name"]')) || textOf(doc.querySelector('meta[name="chapter_name"]'));
        if (meta) return meta;
        const byRule = firstTextInDoc(doc, rule.chapter, 120); if (byRule) return byRule;
        const title = normalizeText(doc.title);
        const match = title.match(/((?:第\s*[0-9零一二三四五六七八九十百千万两〇]+\s*[章节回卷集篇部]\s*)[^_|\-—]{0,60})/i);
        return normalizeText(match?.[1] || title.split(/[_|\-—]/)[0] || '当前章节');
    }

    function deriveBookTitleFromDoc(doc, rule, chapter, breadcrumbs, fallback = '') {
        const metaBook = textOf(doc.querySelector('meta[property="og:novel:book_name"]')) || textOf(doc.querySelector('meta[name="book_name"]'));
        if (metaBook) return cleanBookTitle(metaBook, chapter);
        const byRule = firstTextInDoc(doc, rule.title, 100);
        if (byRule && byRule !== chapter) { const cleaned = cleanBookTitle(byRule, chapter); if (cleaned) return cleaned; }
        if (breadcrumbs.length) {
            const likely = [...breadcrumbs].reverse().find(item => item && item !== chapter && item.length <= 30);
            if (likely) { const cleaned = cleanBookTitle(likely, chapter); if (cleaned) return cleaned; }
        }
        return cleanBookTitle(doc.title, chapter) || fallback || '';
    }

    function deriveAuthorFromDoc(doc, fallback = '') {
        const meta = textOf(doc.querySelector('meta[name="author"]')) || textOf(doc.querySelector('meta[property="og:novel:author"]'));
        return meta || firstTextInDoc(doc, ['[rel="author"]','.author a','.author','.writer','.book-author'], 40) || fallback || '';
    }

    function derivePublishTimeFromDoc(doc) {
        const meta = textOf(doc.querySelector('meta[property="article:published_time"]')) || textOf(doc.querySelector('time'));
        if (meta && meta.length <= 40) return meta;
        const match = (doc.body?.textContent || '').match(/(20\d{2}[年\-/.]\d{1,2}[月\-/.]\d{1,2}(?:日)?(?:\s+\d{1,2}:\d{2})?)/);
        return match?.[1] || '';
    }

    function extractPageFromDocument(doc, pageUrl, fallbackData = null) {
        const rule = chooseRuleForUrl(pageUrl), chapter = deriveChapterFromDoc(doc, rule), breadcrumbs = extractBreadcrumbsFromDoc(doc);
        let contentEl = firstElementInDoc(doc, rule.content);
        if (!contentEl || normalizeText(contentEl.textContent).length < 250) contentEl = findBestGenericContentInDoc(doc);
        if (!contentEl) return { ok:false, reason:'没有识别到足够长的小说正文。' };
        const bookTitle = deriveBookTitleFromDoc(doc, rule, chapter, breadcrumbs, fallbackData?.bookTitle || '');
        const author = deriveAuthorFromDoc(doc, fallbackData?.author || '');
        const contentHTML = buildContentHTML(contentEl, chapter, bookTitle);
        const plainContent = sanitizeLines(contentEl.textContent || '', chapter, bookTitle).join('\n');
        if (plainContent.length < 180) return { ok:false, reason:'识别到的正文过短。' };
        const sitePrev = findByKeywordsInDoc(doc, pageUrl, ['上一章','上章','上一页'], rule.prev);
        const siteNext = findByKeywordsInDoc(doc, pageUrl, ['下一章','下章','下一页'], rule.next);
        const catalogUrlHint = findByKeywordsInDoc(doc, pageUrl, ['返回目录','章节目录','目录'], rule.catalog);
        const bookPage = findByKeywordsInDoc(doc, pageUrl, ['返回书页','书页','书籍详情'], []);
        const cleanBreadcrumbs = breadcrumbs.filter(item => item !== chapter && item !== bookTitle).slice(-3);
        let host = location.hostname; try { host = new URL(pageUrl).hostname; } catch (_) {}
        return {
            ok:true, ruleName:rule.name || '通用识别', bookTitle:bookTitle || fallbackData?.bookTitle || '当前小说', chapter, author,
            publishTime:derivePublishTimeFromDoc(doc), contentHTML, wordCount:countReadableChars(plainContent),
            sitePrev, siteNext, prev:sitePrev, next:siteNext, catalogUrlHint, catalog:catalogUrlHint, bookPage,
            breadcrumbs:cleanBreadcrumbs, sourceUrl:new URL(pageUrl, location.href).href, sourceHost:host,
            bookRoot:getBookRootUrl(pageUrl), catalogChapters:fallbackData?.catalogChapters || [], catalogIndex:-1, navigationSource:'site-fallback'
        };
    }

    function rememberChapterData(data) {
        if (!data?.ok || !data.sourceUrl) return;
        const key = canonicalUrl(data.sourceUrl);
        chapterMemoryCache.delete(key); chapterMemoryCache.set(key, data); readerState.chapterData.set(key, data);
        while (chapterMemoryCache.size > CHAPTER_MEMORY_CACHE_MAX) chapterMemoryCache.delete(chapterMemoryCache.keys().next().value);
    }

    async function loadChapterData(url, fallbackData = null) {
        const key = canonicalUrl(url), cached = chapterMemoryCache.get(key) || readerState.chapterData.get(key);
        if (cached?.ok) return cached;
        const response = await requestDocumentText(url), doc = parseHTMLDocument(response.text);
        const data = extractPageFromDocument(doc, response.finalUrl || url, fallbackData || readerState.currentData);
        if (!data.ok) throw new Error(data.reason || '章节解析失败');
        try { await ensureCatalog(data); } catch (_) {
            data.prev = data.sitePrev || ''; data.next = data.siteNext || ''; data.navigationSource = 'site-fallback';
        }
        rememberChapterData(data); return data;
    }

    function prefetchChapter(url, fallbackData = null) {
        if (!url) return;
        const key = canonicalUrl(url); if (chapterMemoryCache.has(key)) return;
        loadChapterData(url, fallbackData).catch(() => {});
    }

    function icon(name) {
        const common = `viewBox="0 0 24 24" aria-hidden="true" focusable="false"`;
        const icons = {
            menu:`<svg ${common}><path d="M4 6.5h3M10 6.5h10M4 12h3M10 12h10M4 17.5h3M10 17.5h10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
            book:`<svg ${common}><path d="M4.5 5.4A2.4 2.4 0 0 1 6.9 3H11a3 3 0 0 1 3 3v14a3 3 0 0 0-3-3H6.9a2.4 2.4 0 0 0-2.4 2.4V5.4Z" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M19.5 5.4A2.4 2.4 0 0 0 17.1 3H14v17a3 3 0 0 1 3-3h.1a2.4 2.4 0 0 1 2.4 2.4V5.4Z" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>`,
            shelf:`<svg ${common}><path d="M5 5.5h9.5a2 2 0 0 1 2 2V20H7a2 2 0 0 1-2-2V5.5Z" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8 9h5M10.5 6.5v5M5 16.5h11.5M18.5 7v7M15 10.5h7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`,
            moon:`<svg ${common}><path d="M19.5 14.8A7.8 7.8 0 0 1 9.2 4.5 8 8 0 1 0 19.5 14.8Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>`,
            sun:`<svg ${common}><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 2.5v2M12 19.5v2M21.5 12h-2M4.5 12h-2M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4M18.7 18.7l-1.4-1.4M6.7 6.7 5.3 5.3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`,
            settings:`<svg ${common}><path d="M4 7h7M15 7h5M4 17h5M13 17h7M11 4v6M9 14v6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="13" cy="7" r="2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="11" cy="17" r="2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`,
            flame:`<svg ${common}><path d="M13.2 2.8c.5 3.1-.8 4.7-2.2 6.1-1.3 1.4-2.5 2.7-2.5 5a3.5 3.5 0 0 0 7 0c0-1.2-.3-2.3-1-3.4 2.6 1.5 4.2 3.7 4.2 6.2A6.7 6.7 0 0 1 12 23a6.7 6.7 0 0 1-6.7-6.3c0-4 2.6-6.6 7.9-13.9Z" transform="scale(.8) translate(3 1)" fill="currentColor" opacity=".55"/></svg>`,
            bookmark:`<svg ${common}><path d="M7 3.5h10v17l-5-3-5 3v-17Z" fill="currentColor"/></svg>`,
            calendar:`<svg ${common}><path d="M5 5.5h14v14H5zM8 3v5M16 3v5M5 9h14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
            user:`<svg ${common}><circle cx="12" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M6 20c.5-4 2.4-6 6-6s5.5 2 6 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
            text:`<svg ${common}><path d="M5 6h14M12 6v12M8 18h8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`,
            close:`<svg ${common}><path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`
        };
        return icons[name] || '';
    }

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style'); style.id = STYLE_ID;
        style.textContent = `
#${APP_ID}{--qdr-width:925px;--qdr-font-size:19px;--qdr-line-height:2.15;--qdr-reader-font:"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;--qdr-page:#f5f1e8;--qdr-paper:#f8f6ef;--qdr-text:#262626;--qdr-muted:#8c897f;--qdr-faint:#a6a197;--qdr-line:rgba(75,66,53,.11);--qdr-tool:rgba(250,248,241,.96);--qdr-tool-hover:#fffdf7;--qdr-red:#bf2c24;position:fixed;inset:0;z-index:2147483646;overflow-y:auto;overflow-x:hidden;color:var(--qdr-text);background:var(--qdr-page);font-family:"PingFang SC","Microsoft YaHei",sans-serif}
#${APP_ID}[data-theme="night"]{--qdr-page:#171717;--qdr-paper:#202020;--qdr-text:#c9c9c9;--qdr-muted:#858585;--qdr-faint:#737373;--qdr-line:rgba(255,255,255,.08);--qdr-tool:rgba(35,35,35,.98);--qdr-tool-hover:#2a2a2a;--qdr-red:#b55a54}
#${APP_ID}[data-theme="green"]{--qdr-page:#dce8d8;--qdr-paper:#e9f0e5;--qdr-text:#263026;--qdr-muted:#6f776c;--qdr-faint:#7e887b;--qdr-line:rgba(45,65,45,.10);--qdr-tool:rgba(238,244,235,.97);--qdr-tool-hover:#f4f8f2}
#${APP_ID},#${APP_ID} *{box-sizing:border-box}#${APP_ID} button,#${APP_ID} select{font:inherit}
#${APP_ID} .qdr-shell{position:relative;width:min(var(--qdr-width),calc(100vw - 130px));min-height:100vh;margin:0 auto;background:var(--qdr-paper);border-left:1px solid rgba(100,90,70,.025);border-right:1px solid rgba(100,90,70,.025)}
#${APP_ID} .qdr-breadcrumb{min-height:72px;display:flex;align-items:center;flex-wrap:wrap;gap:7px;padding:0 38px;color:var(--qdr-muted);border-bottom:1px solid var(--qdr-line);font-size:14px}#${APP_ID} .qdr-breadcrumb .qdr-current{color:var(--qdr-text);font-weight:600}#${APP_ID} .qdr-chevron{color:var(--qdr-faint);font-size:17px}
#${APP_ID} .qdr-info-strip{position:relative;min-height:76px;display:flex;align-items:center;padding:0 72px;color:var(--qdr-muted);border-bottom:1px solid var(--qdr-line);font-size:13px}#${APP_ID} .qdr-flame{width:18px;height:18px;display:inline-flex;margin-right:7px}#${APP_ID} svg{max-width:100%}
#${APP_ID} .qdr-bookmark{position:absolute;top:0;right:72px;width:34px;height:46px;padding:0;border:0;color:rgba(82,78,70,.16);background:transparent;cursor:pointer}#${APP_ID} .qdr-bookmark[data-active="true"]{color:rgba(191,44,36,.65)}
#${APP_ID} .qdr-article{padding:68px 74px 88px}#${APP_ID} .qdr-title{margin:0;color:var(--qdr-text);font-size:31px;line-height:1.35;font-weight:700}#${APP_ID} .qdr-meta{display:flex;flex-wrap:wrap;align-items:center;gap:8px 18px;margin-top:14px;color:var(--qdr-muted);font-size:13px}#${APP_ID} .qdr-meta-item{display:inline-flex;align-items:center;gap:5px}#${APP_ID} .qdr-meta-item svg{width:16px;height:16px}
#${APP_ID} .qdr-content{margin-top:34px;font-family:var(--qdr-reader-font);font-size:var(--qdr-font-size);line-height:var(--qdr-line-height);letter-spacing:.01em;color:var(--qdr-text)}#${APP_ID} .qdr-content p{margin:0 0 1.12em;padding:0;text-indent:2em;word-break:break-word}
#${APP_ID} .qdr-chapter-nav{display:grid;grid-template-columns:1fr 1fr;border-top:1px solid var(--qdr-line)}#${APP_ID} .qdr-chapter-nav a{min-height:72px;display:flex;align-items:center;justify-content:center;color:var(--qdr-text);text-decoration:none;border-right:1px solid var(--qdr-line)}#${APP_ID} .qdr-chapter-nav a:last-child{border-right:0}#${APP_ID} .qdr-chapter-nav a[aria-disabled="true"]{color:var(--qdr-faint);pointer-events:none}
#${APP_ID} .qdr-tools{position:fixed;z-index:30;top:84px;left:calc(50% + var(--qdr-width)/2 + 14px);width:74px;display:flex;flex-direction:column;gap:8px}#${APP_ID} .qdr-tool{width:74px;min-height:74px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;padding:7px 4px 6px;border:1px solid var(--qdr-line);border-radius:10px;background:var(--qdr-tool);color:var(--qdr-text);cursor:pointer}#${APP_ID} .qdr-tool svg{width:29px;height:29px}#${APP_ID} .qdr-tool-label{font-size:13px;color:var(--qdr-muted)}#${APP_ID} .qdr-tool[data-active="true"]{color:var(--qdr-red)}
#${APP_ID} .qdr-panel-mask{position:fixed;inset:0;z-index:39;background:rgba(0,0,0,.18)}#${APP_ID} .qdr-drawer{position:fixed;z-index:40;top:0;bottom:0;right:max(0px,calc((100vw - var(--qdr-width))/2));width:min(390px,92vw);background:var(--qdr-paper);border-left:1px solid var(--qdr-line);overflow-y:auto}#${APP_ID} .qdr-drawer-head{min-height:66px;display:flex;align-items:center;justify-content:space-between;padding:0 22px;border-bottom:1px solid var(--qdr-line)}#${APP_ID} .qdr-drawer-body{padding:18px 22px 30px}#${APP_ID} .qdr-drawer-title{font-size:18px;font-weight:700}#${APP_ID} .qdr-icon-btn{width:34px;height:34px;border:0;background:transparent;color:var(--qdr-muted);cursor:pointer}
#${APP_ID} .qdr-detail-card{padding:16px 0;border-bottom:1px solid var(--qdr-line)}#${APP_ID} .qdr-detail-label{margin-bottom:6px;color:var(--qdr-muted);font-size:12px}#${APP_ID} .qdr-detail-value{font-size:15px;line-height:1.7}#${APP_ID} .qdr-source-link{display:inline-flex;margin-top:22px;padding:9px 15px;border:1px solid var(--qdr-line);border-radius:6px;color:var(--qdr-text);text-decoration:none;font-size:13px}
#${APP_ID} .qdr-settings-pop{position:fixed;z-index:40;top:318px;left:calc(50% + var(--qdr-width)/2 - 316px);width:300px;padding:20px;border:1px solid var(--qdr-line);border-radius:8px;background:var(--qdr-paper);box-shadow:0 14px 50px rgba(0,0,0,.12)}#${APP_ID} .qdr-settings-title{margin-bottom:18px;font-size:16px;font-weight:700}#${APP_ID} .qdr-setting-row{display:grid;grid-template-columns:66px 1fr;gap:12px;align-items:center;min-height:46px;border-bottom:1px solid var(--qdr-line)}#${APP_ID} .qdr-setting-label{color:var(--qdr-muted);font-size:13px}#${APP_ID} .qdr-theme-options,#${APP_ID} .qdr-size-options{display:flex;align-items:center;gap:8px}#${APP_ID} .qdr-theme-dot{width:28px;height:28px;border:2px solid transparent;border-radius:50%;cursor:pointer}#${APP_ID} .qdr-theme-dot[data-value="paper"]{background:#f5f1e8}#${APP_ID} .qdr-theme-dot[data-value="green"]{background:#dce8d8}#${APP_ID} .qdr-theme-dot[data-value="night"]{background:#202020}#${APP_ID} .qdr-theme-dot[data-active="true"]{border-color:var(--qdr-red)}#${APP_ID} .qdr-mini-btn{min-width:36px;height:30px;border:1px solid var(--qdr-line);border-radius:5px;background:transparent;color:var(--qdr-text);cursor:pointer}#${APP_ID} .qdr-font-select{width:100%;height:32px;border:1px solid var(--qdr-line);border-radius:5px;background:var(--qdr-paper);color:var(--qdr-text)}
#${APP_ID} .qdr-auto-toggle{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;font-size:13px}#${APP_ID} .qdr-switch{position:relative;width:42px;height:24px;flex:0 0 auto}#${APP_ID} .qdr-switch input{position:absolute;opacity:0}#${APP_ID} .qdr-switch-track{position:absolute;inset:0;border-radius:999px;background:rgba(120,110,95,.20);cursor:pointer}#${APP_ID} .qdr-switch-track:after{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:var(--qdr-paper);box-shadow:0 1px 4px rgba(0,0,0,.16);transition:transform .18s}#${APP_ID} .qdr-switch input:checked + .qdr-switch-track{background:var(--qdr-red)}#${APP_ID} .qdr-switch input:checked + .qdr-switch-track:after{transform:translateX(18px)}
#${APP_ID} .qdr-article[data-continuous="true"]{border-top:1px solid var(--qdr-line);padding-top:64px}#${APP_ID} .qdr-continuous-hint{margin:-28px 0 32px;color:var(--qdr-muted);font-size:12px;text-align:center;letter-spacing:.08em}#${APP_ID} .qdr-loading-bar{position:fixed;z-index:70;top:14px;left:50%;transform:translateX(-50%);padding:8px 14px;border:1px solid var(--qdr-line);border-radius:999px;background:var(--qdr-tool);color:var(--qdr-muted);font-size:12px}#${APP_ID} .qdr-fallback-mask{position:fixed;inset:0;z-index:90;display:flex;align-items:center;justify-content:center;background:var(--qdr-page);color:var(--qdr-muted)}
#${APP_ID} .qdr-exit-link{margin-top:12px;width:100%;height:34px;border:1px solid var(--qdr-line);border-radius:5px;background:transparent;color:var(--qdr-muted);cursor:pointer}#${APP_ID} .qdr-toast{position:fixed;z-index:80;top:28px;left:50%;transform:translateX(-50%);padding:9px 16px;border-radius:6px;background:var(--qdr-tool);border:1px solid var(--qdr-line);font-size:13px}
#${APP_ID} .qdr-catalog-modal{position:fixed;z-index:40;top:0;left:50%;transform:translateX(-50%);width:min(var(--qdr-width),calc(100vw - 120px));height:min(100vh,920px);display:flex;flex-direction:column;background:var(--qdr-paper);border-left:1px solid var(--qdr-line);border-right:1px solid var(--qdr-line)}#${APP_ID} .qdr-catalog-head{min-height:88px;display:flex;align-items:center;gap:28px;padding:0 36px;border-bottom:1px solid var(--qdr-line)}#${APP_ID} .qdr-catalog-tab{padding:29px 0 23px;border:0;background:transparent;color:var(--qdr-text);cursor:pointer;font-size:20px}#${APP_ID} .qdr-catalog-tab[data-active="true"]{font-weight:700;color:var(--qdr-red)}#${APP_ID} .qdr-catalog-summary{color:var(--qdr-muted);font-size:13px}#${APP_ID} .qdr-catalog-actions{margin-left:auto;display:flex;gap:10px}#${APP_ID} .qdr-catalog-refresh{height:34px;padding:0 12px;border:1px solid var(--qdr-line);border-radius:6px;background:transparent;color:var(--qdr-muted);cursor:pointer}#${APP_ID} .qdr-catalog-body{flex:1;overflow-y:auto;padding:16px 36px 34px}#${APP_ID} .qdr-catalog-grid{display:grid;grid-template-columns:1fr 1fr;column-gap:36px}#${APP_ID} .qdr-catalog-item{min-height:56px;display:flex;align-items:center;border-bottom:1px solid var(--qdr-line);color:var(--qdr-text);text-decoration:none;font-size:14px}#${APP_ID} .qdr-catalog-item[data-current="true"]{color:var(--qdr-red);font-weight:600}
@media(max-width:1160px){#${APP_ID} .qdr-shell{width:min(var(--qdr-width),calc(100vw - 105px));margin-left:0}#${APP_ID} .qdr-tools{left:auto;right:10px}#${APP_ID} .qdr-settings-pop{left:auto;right:92px}#${APP_ID} .qdr-drawer{right:0}}@media(max-width:720px){#${APP_ID} .qdr-shell{width:100%;margin:0;border:0}#${APP_ID} .qdr-breadcrumb{min-height:58px;padding:0 18px}#${APP_ID} .qdr-info-strip{min-height:58px;padding:0 20px}#${APP_ID} .qdr-article{padding:42px 22px 76px}#${APP_ID} .qdr-title{font-size:27px}#${APP_ID} .qdr-tools{top:auto;right:8px;bottom:10px;width:auto;flex-direction:row;gap:5px}#${APP_ID} .qdr-tool{width:54px;min-height:54px}#${APP_ID} .qdr-tool-label{display:none}#${APP_ID} .qdr-settings-pop{top:auto;left:12px;right:12px;bottom:76px;width:auto}#${APP_ID} .qdr-catalog-modal{width:100%;height:100vh}#${APP_ID} .qdr-catalog-grid{grid-template-columns:1fr}}
`;
        document.documentElement.appendChild(style);
    }

    function applySettings(root) {
        const settings = getSettings(); root.dataset.theme = settings.theme;
        root.style.setProperty('--qdr-width', `${settings.contentWidth}px`);
        root.style.setProperty('--qdr-font-size', `${settings.fontSize}px`);
        root.style.setProperty('--qdr-line-height', String(settings.lineHeight));
        const fonts = { qidian:'"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif', song:'"Songti SC","STSong","SimSun",serif', kai:'"Kaiti SC","STKaiti","KaiTi",serif' };
        root.style.setProperty('--qdr-reader-font', fonts[settings.fontFamily] || fonts.qidian);
        const nightButton = root.querySelector('[data-action="night"]');
        if (nightButton) {
            const night = settings.theme === 'night';
            nightButton.innerHTML = `${icon(night ? 'sun' : 'moon')}<span class="qdr-tool-label">${night ? '日间' : '夜间'}</span>`;
            nightButton.dataset.active = night ? 'true' : 'false';
        }
    }

    function getBookshelf(){const v=gmGet(SHELF_KEY,{});return v&&typeof v==='object'?v:{}};
    function bookKey(data){return `${location.hostname}::${data.bookTitle || location.pathname}`}
    function isBookOnShelf(data){return Boolean(getBookshelf()[bookKey(data)])}
    function toggleBookshelf(data,root){const shelf=getBookshelf(),key=bookKey(data);if(shelf[key]){delete shelf[key];showToast(root,'已移出本地书架')}else{shelf[key]={title:data.bookTitle,author:data.author,chapter:data.chapter,url:data.sourceUrl,host:data.sourceHost,updatedAt:Date.now()};showToast(root,'已加入本地书架')}gmSet(SHELF_KEY,shelf);updateShelfButton(data,root)}
    function updateShelfButton(data,root){const b=root.querySelector('[data-action="shelf"]');if(!b)return;const a=isBookOnShelf(data);b.dataset.active=a?'true':'false';b.querySelector('.qdr-tool-label').textContent=a?'已加书架':'加书架'}
    function getBookmarks(){const v=gmGet(BOOKMARK_KEY,{});return v&&typeof v==='object'?v:{}}
    function isCurrentBookmarked(){return Boolean(getBookmarks()[location.href])}
    function toggleBookmark(data,root){const b=getBookmarks();if(b[location.href]){delete b[location.href];showToast(root,'已取消章节书签')}else{b[location.href]={bookTitle:data.bookTitle,chapter:data.chapter,url:location.href,createdAt:Date.now()};showToast(root,'已添加章节书签')}gmSet(BOOKMARK_KEY,b);updateBookmarkButton(root)}
    function updateBookmarkButton(root){const b=root.querySelector('[data-action="bookmark"]');if(b)b.dataset.active=isCurrentBookmarked()?'true':'false'}
    function getProgressMap(){const m=gmGet(PROGRESS_KEY,{});return m&&typeof m==='object'?m:{}}

    function saveProgress(root) {
        const data=readerState.currentData;if(!data?.sourceUrl)return;
        const currentKey=canonicalUrl(data.sourceUrl),article=[...root.querySelectorAll('[data-chapter-url]')].find(el=>canonicalUrl(el.dataset.chapterUrl)===currentKey),map=getProgressMap();
        let top=root.scrollTop,ratio=0;
        if(article){const rr=root.getBoundingClientRect(),ar=article.getBoundingClientRect(),articleTop=root.scrollTop+ar.top-rr.top;top=Math.max(0,root.scrollTop-articleTop);const max=Math.max(1,article.scrollHeight-root.clientHeight*.35);ratio=Math.min(1,Math.max(0,top/max))}
        map[data.sourceUrl]={top,ratio,updatedAt:Date.now()};gmSet(PROGRESS_KEY,map)
    }

    function restoreProgress(root,data=readerState.currentData){if(!data?.sourceUrl)return;const saved=getProgressMap()[data.sourceUrl];if(!saved)return;setTimeout(()=>{const article=[...root.querySelectorAll('[data-chapter-url]')].find(el=>canonicalUrl(el.dataset.chapterUrl)===canonicalUrl(data.sourceUrl));if(!article)return;const max=Math.max(1,article.scrollHeight-root.clientHeight*.35),local=Number.isFinite(saved.ratio)?max*Math.min(1,Math.max(0,saved.ratio)):Number(saved.top||0);root.scrollTop=Math.max(0,article.offsetTop+local)},100)}
    function showToast(root,text){root.querySelector('.qdr-toast')?.remove();const t=document.createElement('div');t.className='qdr-toast';t.textContent=text;root.appendChild(t);setTimeout(()=>t.remove(),1600)}
    function closeOverlays(root){root.querySelector('.qdr-panel-mask')?.remove();root.querySelector('.qdr-drawer')?.remove();root.querySelector('.qdr-catalog-modal')?.remove();root.querySelector('.qdr-settings-pop')?.remove()}

    function openDrawer(root,title,bodyHTML){closeOverlays(root);const mask=document.createElement('div');mask.className='qdr-panel-mask';const d=document.createElement('aside');d.className='qdr-drawer';d.innerHTML=`<div class="qdr-drawer-head"><div class="qdr-drawer-title">${escapeHTML(title)}</div><button class="qdr-icon-btn" data-action="close-panel">${icon('close')}</button></div><div class="qdr-drawer-body">${bodyHTML}</div>`;root.append(mask,d);const c=()=>closeOverlays(root);mask.addEventListener('click',c);d.querySelector('[data-action="close-panel"]')?.addEventListener('click',c)}

    function openCatalog(data,root){closeOverlays(root);const mask=document.createElement('div');mask.className='qdr-panel-mask';const modal=document.createElement('section');modal.className='qdr-catalog-modal';const bookmarks=Object.values(getBookmarks()).filter(i=>i?.bookTitle===data.bookTitle).sort((a,b)=>Number(a.createdAt||0)-Number(b.createdAt||0));
        const bind=()=>modal.querySelectorAll('.qdr-catalog-body a[href]').forEach(a=>a.addEventListener('click',e=>{const href=a.getAttribute('href');if(!href)return;e.preventDefault();navigateTo(href)}));
        const renderCatalog=()=>{const ch=data.catalogChapters||[];modal.querySelector('.qdr-catalog-body').innerHTML=`<div class="qdr-catalog-grid">${ch.length?ch.map((i,n)=>`<a class="qdr-catalog-item" href="${escapeHTML(i.url)}" data-current="${n===data.catalogIndex?'true':'false'}">${escapeHTML(i.title)}</a>`).join(''):'<div>尚未缓存完整目录。</div>'}</div>`;bind();setTimeout(()=>modal.querySelector('[data-current="true"]')?.scrollIntoView({block:'center'}),0)};
        const renderBookmarks=()=>{modal.querySelector('.qdr-catalog-body').innerHTML=`<div class="qdr-catalog-grid">${bookmarks.length?bookmarks.map(i=>`<a class="qdr-catalog-item" href="${escapeHTML(i.url)}">${escapeHTML(i.chapter)}</a>`).join(''):'<div>当前小说还没有章节书签。</div>'}</div>`;bind()};
        modal.innerHTML=`<header class="qdr-catalog-head"><button class="qdr-catalog-tab" data-tab="catalog" data-active="true">目录</button><span class="qdr-catalog-summary">${data.navigationSource==='catalog'?`已缓存 ${(data.catalogChapters?.length||0).toLocaleString()} 章`:'目录未定位当前章'}</span><button class="qdr-catalog-tab" data-tab="bookmark">书签</button><div class="qdr-catalog-actions"><button class="qdr-catalog-refresh" data-action="refresh-catalog">刷新目录</button><button class="qdr-icon-btn" data-action="close-panel">${icon('close')}</button></div></header><div class="qdr-catalog-body"></div>`;root.append(mask,modal);renderCatalog();const close=()=>closeOverlays(root);mask.onclick=close;modal.querySelector('[data-action="close-panel"]').onclick=close;modal.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{modal.querySelectorAll('[data-tab]').forEach(t=>t.dataset.active=t===b?'true':'false');b.dataset.tab==='bookmark'?renderBookmarks():renderCatalog()});modal.querySelector('[data-action="refresh-catalog"]').onclick=async e=>{const b=e.currentTarget;b.disabled=true;b.textContent='刷新中…';clearCatalogCacheForData(data);try{const c=await ensureCatalog(data,{forceRefresh:true});syncNavigationDom(data,root);if(c?.chapters?.length){showToast(root,`目录已更新：${c.chapters.length} 章`);renderCatalog()}else showToast(root,'目录读取失败，暂时使用原站导航')}finally{b.disabled=false;b.textContent='刷新目录'}}}

    function openBookDetails(data,root){const body=`<div class="qdr-detail-card"><div class="qdr-detail-label">书名</div><div class="qdr-detail-value">${escapeHTML(data.bookTitle)}</div></div>${data.author?`<div class="qdr-detail-card"><div class="qdr-detail-label">作者</div><div class="qdr-detail-value">${escapeHTML(data.author)}</div></div>`:''}<div class="qdr-detail-card"><div class="qdr-detail-label">当前章节</div><div class="qdr-detail-value">${escapeHTML(data.chapter)}</div></div><div class="qdr-detail-card"><div class="qdr-detail-label">本章字数</div><div class="qdr-detail-value">${data.wordCount.toLocaleString()} 字</div></div><div class="qdr-detail-card"><div class="qdr-detail-label">章节导航</div><div class="qdr-detail-value">${data.navigationSource==='catalog'?`目录驱动 · 已缓存 ${(data.catalogChapters?.length||0).toLocaleString()} 章`:'原站按钮兜底'}</div></div><a class="qdr-source-link" href="${escapeHTML(data.sourceUrl)}">退出阅读模式查看原网页</a>`;openDrawer(root,'书详情',body);root.querySelector('.qdr-drawer .qdr-source-link')?.addEventListener('click',e=>{e.preventDefault();closeReader()})}

    function openSettings(root){const existing=root.querySelector('.qdr-settings-pop');if(existing){existing.remove();return}closeOverlays(root);const settings=getSettings(),panel=document.createElement('div');panel.className='qdr-settings-pop';panel.innerHTML=`<div class="qdr-settings-title">阅读设置</div><div class="qdr-setting-row"><div class="qdr-setting-label">背景</div><div class="qdr-theme-options"><button class="qdr-theme-dot" data-theme-choice data-value="paper"></button><button class="qdr-theme-dot" data-theme-choice data-value="green"></button><button class="qdr-theme-dot" data-theme-choice data-value="night"></button></div></div><div class="qdr-setting-row"><div class="qdr-setting-label">字号</div><div class="qdr-size-options"><button class="qdr-mini-btn" data-size="-1">A-</button><span>${settings.fontSize}</span><button class="qdr-mini-btn" data-size="1">A+</button></div></div><div class="qdr-setting-row"><div class="qdr-setting-label">字体</div><select class="qdr-font-select" data-font><option value="qidian" ${settings.fontFamily==='qidian'?'selected':''}>默认</option><option value="song" ${settings.fontFamily==='song'?'selected':''}>宋体</option><option value="kai" ${settings.fontFamily==='kai'?'selected':''}>楷体</option></select></div><div class="qdr-setting-row"><div class="qdr-setting-label">版心</div><div class="qdr-size-options"><button class="qdr-mini-btn" data-width="-40">窄</button><button class="qdr-mini-btn" data-width="40">宽</button></div></div><div class="qdr-setting-row"><div class="qdr-setting-label">连续阅读</div><div class="qdr-auto-toggle"><span>滑到底自动接下一章</span><label class="qdr-switch"><input type="checkbox" data-auto-next ${settings.autoNext?'checked':''}><span class="qdr-switch-track"></span></label></div></div><button class="qdr-exit-link" data-action="exit-reader">查看原网页 / 退出统一阅读</button>`;root.appendChild(panel);panel.querySelectorAll('[data-theme-choice]').forEach(b=>{b.dataset.active=b.dataset.value===settings.theme?'true':'false';b.onclick=()=>{const n=getSettings();n.theme=b.dataset.value;saveSettings(n);applySettings(root);panel.querySelectorAll('[data-theme-choice]').forEach(x=>x.dataset.active=x.dataset.value===n.theme?'true':'false')}});panel.querySelectorAll('[data-size]').forEach(b=>b.onclick=()=>{const n=getSettings();n.fontSize=Math.min(30,Math.max(15,n.fontSize+Number(b.dataset.size)));saveSettings(n);applySettings(root);panel.querySelector('.qdr-size-options span').textContent=n.fontSize});panel.querySelector('[data-font]').onchange=e=>{const n=getSettings();n.fontFamily=e.target.value;saveSettings(n);applySettings(root)};panel.querySelectorAll('[data-width]').forEach(b=>b.onclick=()=>{const n=getSettings();n.contentWidth=Math.min(1120,Math.max(720,n.contentWidth+Number(b.dataset.width)));saveSettings(n);applySettings(root)});panel.querySelector('[data-auto-next]').onchange=e=>{const n=getSettings();n.autoNext=Boolean(e.target.checked);saveSettings(n);showToast(root,n.autoNext?'已开启自动连续阅读':'已关闭自动连续阅读');if(n.autoNext)maybeAutoAppend(root)};panel.querySelector('[data-action="exit-reader"]').onclick=()=>closeReader()}

    function closeReader(options={}){const root=document.getElementById(APP_ID),currentUrl=readerState.currentData?.sourceUrl||location.href;if(root){saveProgress(root);root.remove()}clearTimeout(progressTimer);document.body.style.overflow=sourceBodyOverflow;if(!options.silent&&canonicalUrl(currentUrl)!==canonicalUrl(readerState.initialDocumentUrl))location.href=currentUrl}
    function showLoading(root,text='正在加载章节…'){root.querySelector('.qdr-loading-bar')?.remove();const b=document.createElement('div');b.className='qdr-loading-bar';b.textContent=text;root.appendChild(b)}function hideLoading(root){root.querySelector('.qdr-loading-bar')?.remove()}
    function chapterArticleHTML(data,continuous=false){return `<article class="qdr-article" data-chapter-url="${escapeHTML(data.sourceUrl)}" data-continuous="${continuous?'true':'false'}">${continuous?'<div class="qdr-continuous-hint">继续阅读</div>':''}<h1 class="qdr-title">${escapeHTML(data.chapter)}</h1><div class="qdr-meta"><span class="qdr-meta-item">${icon('book')}<span>${escapeHTML(data.bookTitle)}</span></span>${data.author?`<span class="qdr-meta-item">${icon('user')}<span>${escapeHTML(data.author)}</span></span>`:''}<span class="qdr-meta-item">${icon('text')}<span>${data.wordCount.toLocaleString()}字</span></span>${data.publishTime?`<span class="qdr-meta-item">${icon('calendar')}<span>${escapeHTML(data.publishTime)}</span></span>`:''}</div><div class="qdr-content">${data.contentHTML}</div></article>`}
    function updateReaderChrome(data,root){readerState.currentData=data;readerState.lastActiveUrl=data.sourceUrl;rememberChapterData(data);const bc=root.querySelector('.qdr-breadcrumb');if(bc)bc.innerHTML=breadcrumbHTML(data);const info=root.querySelector('.qdr-info-main');if(info)info.textContent=data.navigationSource==='catalog'?`目录已缓存 ${(data.catalogChapters?.length||0).toLocaleString()} 章 · 本章约 ${data.wordCount.toLocaleString()} 字`:`章节阅读 · 本章约 ${data.wordCount.toLocaleString()} 字`;syncNavigationDom(data,root);updateShelfButton(data,root);updateBookmarkButton(root)}
    function setBrowserUrl(url,mode='push'){if(!url||canonicalUrl(url)===canonicalUrl(location.href))return;if(mode==='replace')history.replaceState({qdr:true},'',url);else if(mode==='none')return;else history.pushState({qdr:true},'',url);routeUrl=location.href}
    function findLoadedChapterElement(root,url){const key=canonicalUrl(url);return [...root.querySelectorAll('[data-chapter-url]')].find(el=>canonicalUrl(el.dataset.chapterUrl)===key)||null}
    function fallbackNavigate(url,root){const m=document.createElement('div');m.className='qdr-fallback-mask';m.textContent='正在切换章节…';root.appendChild(m);setTimeout(()=>{location.href=url},30)}

    async function navigateTo(url,options={}){if(!url)return;const root=document.getElementById(APP_ID);if(!root){location.href=url;return}closeOverlays(root);const loaded=findLoadedChapterElement(root,url);if(loaded&&getSettings().autoNext){const data=readerState.chapterData.get(canonicalUrl(url));if(data){setBrowserUrl(data.sourceUrl,options.history||'push');updateReaderChrome(data,root)}root.scrollTo({top:Math.max(0,loaded.offsetTop-18),behavior:options.instant?'auto':'smooth'});return}if(readerState.navigationBusy)return;readerState.navigationBusy=true;showLoading(root,options.loadingText||'正在加载章节…');try{saveProgress(root);const data=await loadChapterData(url,readerState.currentData),chapters=root.querySelector('.qdr-chapters');chapters.innerHTML=chapterArticleHTML(data,false);setBrowserUrl(data.sourceUrl,options.history||'push');updateReaderChrome(data,root);root.scrollTop=0;prefetchChapter(data.next,data);if(getSettings().autoNext)setTimeout(()=>maybeAutoAppend(root),80)}catch(error){console.warn('[QDR] 无刷新切章失败，回退到整页导航：',error);fallbackNavigate(url,root)}finally{readerState.navigationBusy=false;hideLoading(root)}}

    function updateActiveChapterFromScroll(root){const articles=[...root.querySelectorAll('[data-chapter-url]')];if(!articles.length)return;const rr=root.getBoundingClientRect(),probe=rr.top+Math.min(240,root.clientHeight*.32);let active=articles[0];for(const a of articles){const r=a.getBoundingClientRect();if(r.top<=probe)active=a;if(r.top>probe)break}const url=active.dataset.chapterUrl;if(!url||canonicalUrl(url)===canonicalUrl(readerState.lastActiveUrl))return;const data=readerState.chapterData.get(canonicalUrl(url));if(!data)return;saveProgress(root);setBrowserUrl(data.sourceUrl,'replace');updateReaderChrome(data,root)}
    async function maybeAutoAppend(root){if(!getSettings().autoNext||readerState.appendBusy||readerState.navigationBusy)return;const remaining=root.scrollHeight-root.scrollTop-root.clientHeight;if(remaining>AUTO_NEXT_THRESHOLD)return;const articles=[...root.querySelectorAll('[data-chapter-url]')],last=articles[articles.length-1];if(!last)return;const lastData=readerState.chapterData.get(canonicalUrl(last.dataset.chapterUrl)),nextUrl=lastData?.next;if(!nextUrl||findLoadedChapterElement(root,nextUrl))return;readerState.appendBusy=true;showLoading(root,'正在接入下一章…');try{const nextData=await loadChapterData(nextUrl,lastData||readerState.currentData);root.querySelector('.qdr-chapters')?.insertAdjacentHTML('beforeend',chapterArticleHTML(nextData,true));rememberChapterData(nextData);prefetchChapter(nextData.next,nextData)}catch(error){console.warn('[QDR] 自动下一章加载失败：',error)}finally{readerState.appendBusy=false;hideLoading(root);if(getSettings().autoNext)setTimeout(()=>maybeAutoAppend(root),60)}}

    function breadcrumbHTML(data){const parts=['首页'];data.breadcrumbs.forEach(i=>{if(i&&!parts.includes(i))parts.push(i)});if(data.bookTitle&&!parts.includes(data.bookTitle))parts.push(data.bookTitle);return parts.map((i,n)=>`${n?'<span class="qdr-chevron">›</span>':''}<span class="${n===parts.length-1?'qdr-current':''}">${escapeHTML(i)}</span>`).join('')}
    function renderError(data){closeReader({silent:true});injectStyles();sourceBodyOverflow=document.body.style.overflow;document.body.style.overflow='hidden';const root=document.createElement('div');root.id=APP_ID;root.innerHTML=`<div style="width:min(720px,calc(100vw - 40px));margin:90px auto;padding:34px;background:var(--qdr-paper)"><h2>没有识别到小说正文</h2><p>${escapeHTML(data.reason||'')}</p><button class="qdr-exit-link" data-action="exit-reader">返回原网页</button></div>`;document.body.appendChild(root);applySettings(root);root.querySelector('[data-action="exit-reader"]').onclick=()=>closeReader()}

    function renderReader(data){if(!data.ok){renderError(data);return}closeReader({silent:true});injectStyles();sourceBodyOverflow=document.body.style.overflow;document.body.style.overflow='hidden';readerState.currentData=data;readerState.lastActiveUrl=data.sourceUrl;readerState.chapterData.clear();rememberChapterData(data);const root=document.createElement('div');root.id=APP_ID;root.innerHTML=`<main class="qdr-shell"><div class="qdr-breadcrumb">${breadcrumbHTML(data)}</div><div class="qdr-info-strip"><span class="qdr-flame">${icon('flame')}</span><span class="qdr-info-main">${data.navigationSource==='catalog'?`目录已缓存 ${(data.catalogChapters?.length||0).toLocaleString()} 章 · 本章约 ${data.wordCount.toLocaleString()} 字`:`章节阅读 · 本章约 ${data.wordCount.toLocaleString()} 字`}</span><button class="qdr-bookmark" data-action="bookmark">${icon('bookmark')}</button></div><div class="qdr-chapters">${chapterArticleHTML(data,false)}</div><nav class="qdr-chapter-nav"><a data-nav="prev" ${data.prev?`href="${escapeHTML(data.prev)}"`:'aria-disabled="true"'}>上一章</a><a data-nav="next" ${data.next?`href="${escapeHTML(data.next)}"`:'aria-disabled="true"'}>下一章</a></nav></main><aside class="qdr-tools"><button class="qdr-tool" data-action="catalog">${icon('menu')}<span class="qdr-tool-label">目录</span></button><button class="qdr-tool" data-action="details">${icon('book')}<span class="qdr-tool-label">书详情</span></button><button class="qdr-tool" data-action="shelf">${icon('shelf')}<span class="qdr-tool-label">加书架</span></button><button class="qdr-tool" data-action="night">${icon('moon')}<span class="qdr-tool-label">夜间</span></button><button class="qdr-tool" data-action="settings">${icon('settings')}<span class="qdr-tool-label">设置</span></button></aside>`;document.body.appendChild(root);applySettings(root);updateReaderChrome(data,root);restoreProgress(root,data);prefetchChapter(data.next,data);root.querySelector('[data-action="bookmark"]').onclick=()=>readerState.currentData&&toggleBookmark(readerState.currentData,root);root.querySelector('[data-action="catalog"]').onclick=()=>readerState.currentData&&openCatalog(readerState.currentData,root);root.querySelector('[data-action="details"]').onclick=()=>readerState.currentData&&openBookDetails(readerState.currentData,root);root.querySelector('[data-action="shelf"]').onclick=()=>readerState.currentData&&toggleBookshelf(readerState.currentData,root);root.querySelector('[data-action="night"]').onclick=()=>{const n=getSettings();n.theme=n.theme==='night'?'paper':'night';saveSettings(n);applySettings(root)};root.querySelector('[data-action="settings"]').onclick=()=>openSettings(root);root.querySelector('.qdr-chapter-nav').onclick=e=>{const a=e.target.closest('a[data-nav]');if(!a)return;const href=a.getAttribute('href');if(!href)return;e.preventDefault();navigateTo(href)};root.addEventListener('scroll',()=>{clearTimeout(progressTimer);progressTimer=setTimeout(()=>saveProgress(root),420);updateActiveChapterFromScroll(root);maybeAutoAppend(root)},{passive:true});if(getSettings().autoNext)setTimeout(()=>maybeAutoAppend(root),120)}

    async function openReader(){const existing=document.getElementById(APP_ID);if(existing){closeOverlays(existing);return}readerState.initialDocumentUrl=location.href;routeUrl=location.href;const data=extractPage();if(data.ok){try{await ensureCatalog(data)}catch(_){data.prev=data.sitePrev||'';data.next=data.siteNext||'';data.navigationSource='site-fallback'}rememberChapterData(data)}renderReader(data)}
    function toggleCurrentSite(){if(isCurrentHostEnabled()){disableCurrentHost();closeReader();alert(`已关闭 ${location.hostname} 的自动阅读模式。`)}else{enableCurrentHost();alert(`已启用 ${location.hostname}。\n以后进入该网站章节页会自动尝试开启统一阅读界面。`);openReader()}}
    function registerMenus(){GM_registerMenuCommand(isCurrentHostEnabled()?`关闭当前网站自动阅读：${location.hostname}`:`启用当前网站自动阅读：${location.hostname}`,toggleCurrentSite);GM_registerMenuCommand('打开统一阅读界面',openReader);GM_registerMenuCommand('刷新当前小说目录缓存',refreshCatalogForCurrentPage);GM_registerMenuCommand('退出统一阅读界面',closeReader)}
    function bindKeyboard(){document.addEventListener('keydown',e=>{const root=document.getElementById(APP_ID);if(!root||['INPUT','TEXTAREA','SELECT'].includes(e.target?.tagName))return;if(e.key==='Escape'){const p=root.querySelector('.qdr-settings-pop')||root.querySelector('.qdr-drawer')||root.querySelector('.qdr-catalog-modal');p?closeOverlays(root):closeReader();return}if(e.key==='ArrowLeft'){const u=root.querySelector('[data-nav="prev"]')?.getAttribute('href');if(u)navigateTo(u)}if(e.key==='ArrowRight'){const u=root.querySelector('[data-nav="next"]')?.getAttribute('href');if(u)navigateTo(u)}})}
    function watchRouteChanges(){setInterval(()=>{if(routeUrl===location.href)return;const root=document.getElementById(APP_ID);if(root){routeUrl=location.href;return}routeUrl=location.href;if(isCurrentHostEnabled()&&getSettings().autoOpen)setTimeout(openReader,700)},600)}
    function bindHistoryNavigation(){window.addEventListener('popstate',()=>{const root=document.getElementById(APP_ID);routeUrl=location.href;if(root)navigateTo(location.href,{history:'none',instant:true,loadingText:'正在返回章节…'});else if(isCurrentHostEnabled()&&getSettings().autoOpen)setTimeout(openReader,80)})}
    function boot(){migrateLegacyData();if(/(^|\.)qidian\.com$/i.test(location.hostname))return;registerMenus();bindKeyboard();bindHistoryNavigation();watchRouteChanges();if(isCurrentHostEnabled()&&getSettings().autoOpen)setTimeout(openReader,500)}
    boot();
})();
