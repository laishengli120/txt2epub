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

let script = zlib.gunzipSync(Buffer.concat(parts)).toString('utf8');
if (!script.startsWith('// ==UserScript==') || !script.includes('// @version      2.4.0')) {
  throw new Error('V2.4.0 Userscript build validation failed');
}

function replaceOnce(from, to, label) {
  if (!script.includes(from)) throw new Error(`Patch target missing: ${label}`);
  script = script.replace(from, to);
}

replaceOnce('// @version      2.4.0', '// @version      2.4.1', 'version');

replaceOnce(
`#\${APP_ID}[data-reader-style="weread"] .qdr-content{
    margin:0;height:calc(100% - 52px);min-height:0;overflow-x:hidden;overflow-y:hidden;
    column-count:2;column-gap:82px;column-fill:auto;
    font-family:var(--qdr-reader-font);font-size:20px;line-height:2;letter-spacing:.005em;color:var(--qdr-text);
    scroll-behavior:smooth
}`,
`#\${APP_ID}[data-reader-style="weread"] .qdr-content{
    margin:0;height:calc(100% - 52px);min-height:0;overflow-x:hidden;overflow-y:hidden;
    column-count:2;column-gap:82px;column-fill:auto;
    font-family:var(--qdr-reader-font);font-size:20px;line-height:2;letter-spacing:.005em;color:var(--qdr-text);
    scroll-behavior:auto
}`,
'weread scroll behavior'
);

replaceOnce(
`#\${APP_ID} .qdr-weread-page-count{color:var(--qdr-faint);font-size:12px;opacity:.8}
#\${APP_ID}[data-reader-style="weread"] .qdr-tools{
    top:222px;left:calc(50% + 668px + 36px);width:58px;gap:12px
}
#\${APP_ID}[data-reader-style="weread"] .qdr-tool{
    width:58px;min-height:58px;height:58px;padding:0;border:1px solid rgba(31,35,41,.045);border-radius:50%;
    background:var(--qdr-tool);box-shadow:0 5px 18px rgba(31,35,41,.045);gap:0
}`,
`#\${APP_ID} .qdr-weread-page-count{display:none}
#\${APP_ID}[data-reader-style="weread"] .qdr-tools{
    top:222px;left:auto;
    right:max(22px,calc((100vw - min(1336px,calc(100vw - 210px)))/2 - 94px));
    width:56px;gap:14px
}
#\${APP_ID}[data-reader-style="weread"] .qdr-tool{
    width:56px;min-height:56px;height:56px;padding:0;border:1px solid rgba(31,35,41,.045);border-radius:50%;
    background:var(--qdr-tool);box-shadow:0 5px 18px rgba(31,35,41,.045);gap:0
}`,
'weread pager count and toolbar'
);

replaceOnce(
`#\${APP_ID}[data-reader-style="weread"] .qdr-tool.qdr-tool-top{min-height:58px}`,
`#\${APP_ID}[data-reader-style="weread"] .qdr-tool.qdr-tool-top{min-height:56px}`,
'top tool size'
);

replaceOnce(
`    function turnWereadPage(article,direction,root){
        const m=wereadMetrics(article);if(!m)return;
        const data=readerState.chapterData.get(canonicalUrl(article.dataset.chapterUrl))||readerState.currentData;
        if(direction>0){
            if(m.page<m.pages-1){m.content.scrollTo({left:Math.min(m.maxLeft,m.content.scrollLeft+m.step),behavior:'smooth'});setTimeout(()=>updateWereadPager(article),260);return}
            if(data?.next)navigateTo(data.next);
        }else{
            if(m.page>0){m.content.scrollTo({left:Math.max(0,m.content.scrollLeft-m.step),behavior:'smooth'});setTimeout(()=>updateWereadPager(article),260);return}
            if(data?.prev)navigateTo(data.prev);
        }
    }`,
`    function turnWereadPage(article,direction,root){
        const m=wereadMetrics(article);if(!m)return;
        const data=readerState.chapterData.get(canonicalUrl(article.dataset.chapterUrl))||readerState.currentData;
        if(direction>0){
            if(m.page<m.pages-1){m.content.scrollLeft=Math.min(m.maxLeft,m.content.scrollLeft+m.step);updateWereadPager(article);return}
            if(data?.next)navigateTo(data.next);
        }else{
            if(m.page>0){m.content.scrollLeft=Math.max(0,m.content.scrollLeft-m.step);updateWereadPager(article);return}
            if(data?.prev)navigateTo(data.prev);
        }
    }`,
'instant page switching'
);

if (!script.includes('// @version      2.4.1')) throw new Error('V2.4.1 version patch failed');

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
<div class="features"><b>V2.4.1：</b>微信读书模式右侧工具栏改为稳定的视口内定位并统一为 56px 圆形按钮；上一页/下一页不再平滑滚动，点击后直接切换；底部中央页码已隐藏。</div>
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
