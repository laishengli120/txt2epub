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
const script = zlib.gunzipSync(gzip).toString('utf8');

if (!script.startsWith('// ==UserScript==') || !script.includes('// @version      2.4.0')) {
  throw new Error('V2.4.0 Userscript build validation failed');
}

fs.writeFileSync(path.join(dir, 'universal_qidian_reader_v2.4.0.user.js'), script, 'utf8');

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>通用小说阅读器 V2.4.0</title>
<style>
:root{--bg:#f5f3ee;--card:#fff;--text:#252525;--muted:#77736b;--line:#e4ded4;--accent:#c6352b;--code:#171717}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}.wrap{width:min(1180px,calc(100% - 32px));margin:36px auto 60px}.top{display:flex;align-items:flex-end;justify-content:space-between;gap:20px}.top h1{margin:0;font-size:28px}.sub{margin-top:8px;color:var(--muted);font-size:14px}.actions{display:flex;gap:10px;flex-wrap:wrap}.btn{border:1px solid var(--line);background:#fff;color:var(--text);padding:10px 15px;border-radius:8px;font-weight:600;cursor:pointer;text-decoration:none}.btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}.meta{display:flex;gap:9px;flex-wrap:wrap;margin:16px 0}.tag{padding:6px 9px;background:#fff;border:1px solid var(--line);border-radius:7px;color:var(--muted);font-size:12px}.panel{overflow:hidden;border:1px solid var(--line);border-radius:12px;background:var(--card)}.bar{min-height:52px;display:flex;align-items:center;justify-content:space-between;padding:0 16px;border-bottom:1px solid var(--line)}.ok{color:#25824d}textarea{display:block;width:100%;height:70vh;min-height:520px;resize:vertical;border:0;outline:0;padding:20px 22px;background:var(--code);color:#ddd;font:13px/1.65 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;white-space:pre}.features{margin-top:15px;padding:15px 18px;background:#fff;border:1px solid var(--line);border-radius:10px;color:var(--muted);font-size:13px;line-height:1.9}@media(max-width:720px){.wrap{width:calc(100% - 20px);margin-top:20px}.top{align-items:flex-start;flex-direction:column}.top h1{font-size:22px}textarea{min-height:60vh}}
</style>
</head>
<body>
<main class="wrap">
<div class="top"><div><h1>通用小说阅读器 V2.4.0</h1><div class="sub">静态构建版 · 页面打开后零网络读取、零解压</div></div><div class="actions"><button class="btn primary" id="copy">复制全部代码</button><button class="btn" id="select">全选代码</button><a class="btn" href="./universal_qidian_reader_v2.4.0.user.js" download>直接下载 .user.js</a></div></div>
<div class="meta"><span class="tag">版本 <b>2.4.0</b></span><span class="tag">构建 <b>Static 2406</b></span><span class="tag">字符 <b>${script.length.toLocaleString()}</b></span><span class="tag">无 fetch / XHR / Base64 / gzip / Response</span></div>
<section class="panel"><div class="bar"><strong>完整 Userscript</strong><span class="ok">V2.4.0 代码已就绪 · Static 2406</span></div><textarea id="code" readonly spellcheck="false">${esc(script)}</textarea></section>
<div class="features"><b>Static 2406：</b>完整脚本已在 Netlify 构建阶段生成并直接写入本页面。浏览器不再请求脚本分片，也不执行压缩数据解码，因此不会再出现脚本“读取失败”。</div>
</main>
<script>
const code=document.getElementById('code'),copy=document.getElementById('copy'),select=document.getElementById('select');
copy.onclick=async()=>{try{await navigator.clipboard.writeText(code.value)}catch(_){code.focus();code.select();document.execCommand('copy')}copy.textContent='已复制';setTimeout(()=>copy.textContent='复制全部代码',1400)};
select.onclick=()=>{code.focus();code.select()};
</script>
</body>
</html>`;

fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf8');
console.log(`Qidian Reader V2.4.0 static page built: ${script.length} chars`);
