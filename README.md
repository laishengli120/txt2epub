# TXT to EPUB Converter

一个浏览器端 TXT 转 EPUB 工具，提供 Memphis 风格界面，并包含 Netlify Functions 用于抓取外部文本内容。适合把本地 TXT 小说或文本材料转换成可在电子书阅读器中打开的 EPUB 文件。

## 功能

- 上传 TXT 文件并转换为 EPUB
- 浏览器端处理文本、编码检测和打包
- 使用 JSZip 生成 EPUB 结构
- 使用 FileSaver.js 下载结果
- 通过 `functions/fetch-qidian.js` 提供 Netlify 抓取函数
- 可部署为静态页面加 Serverless Function

## 技术栈

- 原生 HTML / CSS / JavaScript
- JSZip
- FileSaver.js
- jschardet
- Netlify Functions
- node-fetch

## 本地使用

直接打开 `index.html` 可以使用前端转换功能。若需要测试 Netlify Functions，建议安装 Netlify CLI：

```bash
npm install -g netlify-cli
netlify dev
```

## 部署

仓库包含 `netlify.toml`：

```toml
[functions]
  directory = "functions"
  node_bundler = "esbuild"
```

部署到 Netlify 后，前端页面和函数会一起发布。

## 项目结构

```text
index.html                 # 转换工具主页面
functions/fetch-qidian.js  # Netlify 抓取函数
functions/package.json     # 函数依赖
netlify.toml               # Netlify 配置
favicon/                   # 图标资源
```

## 维护提醒

仓库中包含 `functions/node_modules/`，通常不建议提交依赖目录。建议后续删除该目录，并只保留 `functions/package.json` 和 `functions/package-lock.json`。
