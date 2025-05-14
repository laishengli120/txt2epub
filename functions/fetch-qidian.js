const fetch = require('node-fetch'); // 用于在Node.js环境中发送HTTP请求

exports.handler = async function(event, context) {
    // 从前端请求的查询参数中获取书名
    const bookname = event.queryStringParameters.bookname;

    if (!bookname) {
        return {
            statusCode: 400,
            headers: { 'Access-Control-Allow-Origin': '*' }, // 即使是错误，也加上CORS头
            body: JSON.stringify({ error: "书名 (bookname) 是必需的查询参数" }),
        };
    }

    const targetQidianUrl = `https://m.qidian.com/soushu/${encodeURIComponent(bookname)}.html`;
    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.93 Safari/537.36'; // 设置一个常见的User-Agent

    try {
        console.log(`[Netlify Function] Fetching Qidian URL: ${targetQidianUrl}`);
        const response = await fetch(targetQidianUrl, {
            headers: {
                'User-Agent': userAgent
            }
        });

        if (!response.ok) {
            console.error(`[Netlify Function] Qidian server responded with ${response.status}`);
            return {
                statusCode: response.status,
                headers: { 'Access-Control-Allow-Origin': '*' },
                body: JSON.stringify({ error: `获取起点数据失败，状态码: ${response.status}` }),
            };
        }

        const htmlContent = await response.text();
        console.log(`[Netlify Function] Successfully fetched HTML content from Qidian for: ${bookname}`);

        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*', // 允许任何源访问此函数 (为了简单起见)
                                                    // 生产环境可以考虑限制为您的Netlify站点域名
                'Content-Type': response.headers.get('content-type') || 'text/html; charset=utf-8',
            },
            body: htmlContent, // 直接返回获取到的HTML文本
        };

    } catch (error) {
        console.error('[Netlify Function] Error fetching from Qidian:', error);
        return {
            statusCode: 500,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ error: `调用Netlify函数处理起点请求时出错: ${error.message}` }),
        };
    }
};