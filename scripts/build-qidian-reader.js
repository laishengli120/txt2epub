const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.resolve(__dirname, '..');
const dir = path.join(root, 'qidian-reader');
const parts = [];

for (let i = 0; i < 8; i++) {
  const file = path.join(dir, `script-v240-${i}.b64`);
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').replace(/\s+/g, '');
  parts.push(Buffer.from(text, 'base64'));
}

const gzip = Buffer.concat(parts);
let script = zlib.gunzipSync(gzip).toString('utf8');

if (!script.startsWith('// ==UserScript==') || !script.includes('// @version      2.4.0')) {
  throw new Error('V2.4.0 Userscript build validation failed');
}

script = script.replace('// @version      2.4.0', '// @version      2.4.1');

script += String.raw`

/* === WeRead UI refinement patch · V2.4.1 === */
(() => {
  'use strict';

  const STYLE_ID = 'qdr-weread-v241-refine';
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      html.qdr-instant-page-switch *,
      html.qdr-instant-page-switch *::before,
      html.qdr-instant-page-switch *::after {
        transition: none !important;
        animation: none !important;
        scroll-behavior: auto !important;
      }
      .qdr-v241-page-indicator-hidden {
        display: none !important;
        visibility: hidden !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function isVisible(el, rect) {
    if (!el || !rect) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity || 1) > 0 && rect.width > 0 && rect.height > 0;
  }

  function hidePageIndicator() {
    const maxTop = window.innerHeight * 0.68;
    for (const el of document.querySelectorAll('body *')) {
      if (el.children.length > 1) continue;
      const text = (el.textContent || '').trim();
      if (!/^\d+\s*\/\s*\d+$/.test(text)) continue;
      const rect = el.getBoundingClientRect();
      if (!isVisible(el, rect)) continue;
      if (rect.top < maxTop || rect.width > 120 || rect.height > 50) continue;
      el.classList.add('qdr-v241-page-indicator-hidden');
    }
  }

  function tuneRightToolbar() {
    const vw = window.innerWidth;
    if (vw < 900) return;

    const all = [...document.querySelectorAll('body *')];

    // 优先处理整组固定工具栏：保持微信读书式圆形按钮，避免贴到屏幕外。
    for (const el of all) {
      const cs = getComputedStyle(el);
      if (cs.position !== 'fixed') continue;
      const rect = el.getBoundingClientRect();
      if (!isVisible(el, rect)) continue;
      if (rect.left < vw - 220 || rect.width > 150 || rect.height < 180) continue;
      const clickableCount = el.querySelectorAll('button,a,[role="button"]').length;
      if (clickableCount < 2 && el.children.length < 3) continue;
      el.style.setProperty('right', '28px', 'important');
      el.style.setProperty('left', 'auto', 'important');
      if (cs.transform && cs.transform !== 'none') {
        el.style.setProperty('transform', 'none', 'important');
      }
    }

    // 某些实现中每个圆形按钮单独 fixed，逐个钳制到视口内。
    for (const el of all) {
      const cs = getComputedStyle(el);
      if (cs.position !== 'fixed') continue;
      const rect = el.getBoundingClientRect();
      if (!isVisible(el, rect)) continue;
      if (rect.left < vw - 115) continue;
      if (rect.width < 38 || rect.width > 90 || rect.height < 38 || rect.height > 90) continue;

      const radius = parseFloat(cs.borderTopLeftRadius) || 0;
      const looksRound = radius >= Math.min(rect.width, rect.height) * 0.35;
      if (!looksRound) continue;

      el.style.setProperty('right', '28px', 'important');
      el.style.setProperty('left', 'auto', 'important');
      el.style.setProperty('width', '56px', 'important');
      el.style.setProperty('height', '56px', 'important');
      el.style.setProperty('min-width', '56px', 'important');
      el.style.setProperty('min-height', '56px', 'important');
      el.style.setProperty('border-radius', '50%', 'important');
      if (cs.transform && cs.transform !== 'none') {
        el.style.setProperty('transform', 'none', 'important');
      }
    }
  }

  let instantTimer = 0;
  function armInstantPageSwitch() {
    document.documentElement.classList.add('qdr-instant-page-switch');
    clearTimeout(instantTimer);
    instantTimer = setTimeout(() => {
      document.documentElement.classList.remove('qdr-instant-page-switch');
    }, 260);
  }

  function isPageSwitchControl(target) {
    const el = target?.closest?.('button,a,[role="button"],div,span');
    if (!el) return false;
    const text = (el.textContent || '').replace(/\s+/g, '').trim();
    return /^(‹|<)?上一页(›|>)?$/.test(text) || /^(‹|<)?下一页(›|>)?$/.test(text);
  }

  document.addEventListener('pointerdown', (event) => {
    if (isPageSwitchControl(event.target)) armInstantPageSwitch();
  }, true);

  document.addEventListener('click', (event) => {
    if (isPageSwitchControl(event.target)) armInstantPageSwitch();
  }, true);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'PageUp' || event.key === 'PageDown') {
      armInstantPageSwitch();
    }
  }, true);

  let scheduled = false;
  function refresh() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      hidePageIndicator();
      tuneRightToolbar();
    });
  }

  const observer = new MutationObserver(refresh);
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  window.addEventListener('resize', refresh, { passive: true });
  window.addEventListener('load', refresh, { once: true });
  refresh();
  setTimeout(refresh, 500);
  setTimeout(refresh, 1500);
})();
`;

if (!script.includes('// @version      2.4.1')) {
  throw new Error('V2.4.1 version patch failed');
}

const outName = 'universal_qidian_reader_v2.4.1.user.js';
fs.writeFileSync(path.join(dir, outName), script, 'utf8');

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>通用小说阅读器 V2.4.1</title>
<style>
:root{--bg:#f5f3ee;--card:#fff;--text:#252525;--muted:#77736b;--line:#e4ded4;--accent:#c6352b;--code:#171717}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}.wrap{width:min(1180px,calc(100% - 32px));margin:36px auto 60px}.top{display:flex;align-items:flex-end;justify-content:space-between;gap:20px}.top h1{margin:0;font-size:28px}.sub{margin-top:8px;color:var(--muted);font-size:14px}.actions{display:flex;gap:10px;flex-wrap:wrap}.btn{border:1px solid var(--line);background:#fff;color:var(--text);padding:10px 15px;border-radius:8px;font-weight:600;cursor:pointer;text-decoration:none}.btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}.meta{display:flex;gap:9px;flex-wrap:wrap;margin:16px 0}.tag{padding:6px 9px;background:#fff;border:1px solid var(--line);border-radius:7px;color:var(--muted);font-size:12px}.panel{overflow:hidden;border:1px solid var(--line);border-radius:12px;background:var(--card)}.bar{min-height:52px;display:flex;align-items:center;justify-content:space-between;padding:0 16px;border-bottom:1px solid var(--line)}.ok{color:#25824d}textarea{display:block;width:100%;height:70vh;min-height:520px;resize:vertical;border:0;outline:0;padding:20px 22px;background:var(--code);color:#ddd;font:13px/1.65 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;white-space:pre}.features{margin-top:15px;padding:15px 18px;background:#fff;border:1px solid var(--line);border-radius:10px;color:var(--muted);font-size:13px;line-height:1.9}@media(max-width:720px){.wrap{width:calc(100% - 20px);margin-top:20px}.top{align-items:flex-start;flex-direction:column}.top h1{font-size:22px}textarea{min-height:60vh}}
</style>
</head>
<body>
<main class="wrap">
<div class="top"><div><h1>通用小说阅读器 V2.4.1</h1><div class="sub">微信读书 UI 细节优化 · 右侧工具栏 / 无动画翻页 / 隐藏页码</div></div><div class="actions"><button class="btn primary" id="copy">复制全部代码</button><button class="btn" id="select">全选代码</button><a class="btn" href="./${outName}" download>直接下载 .user.js</a></div></div>
<div class="meta"><span class="tag">版本 <b>2.4.1</b></span><span class="tag">构建 <b>Static 2410</b></span><span class="tag">字符 <b>${script.length.toLocaleString()}</b></span><span class="tag">静态构建</span></div>
<section class="panel"><div class="bar"><strong>完整 Userscript</strong><span class="ok">V2.4.1 代码已就绪</span></div><textarea id="code" readonly spellcheck="false">${esc(script)}</textarea></section>
<div class="features"><b>V2.4.1：</b>微信读书模式右侧圆形工具栏整体向页面内收并统一为 56px；上一页/下一页切换取消过渡动画，直接显示目标页；底部中央“3 / 8”形式的页码已隐藏。</div>
</main>
<script>
const code=document.getElementById('code'),copy=document.getElementById('copy'),select=document.getElementById('select');
copy.onclick=async()=>{try{await navigator.clipboard.writeText(code.value)}catch(_){code.focus();code.select();document.execCommand('copy')}copy.textContent='已复制';setTimeout(()=>copy.textContent='复制全部代码',1400)};
select.onclick=()=>{code.focus();code.select()};
</script>
</body>
</html>`;

fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf8');
console.log(`Qidian Reader V2.4.1 static page built: ${script.length} chars`);
