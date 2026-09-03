const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// スタイル・画像・リンク崩れを防ぐ高度なプロキシ
app.use('/fetch', (req, res, next) => {
    let encodedUrl = req.query.q;
    if (!encodedUrl) return res.status(400).send('URLが指定されていません');

    let targetUrl;
    try {
        targetUrl = Buffer.from(encodedUrl, 'base64').toString('utf8');
    } catch (e) {
        return res.status(400).send('無効なURLです');
    }

    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
        targetUrl = 'https://' + targetUrl;
    }

    // 転送先のドメイン部分を抽出
    const targetObj = new URL(targetUrl);

    return createProxyMiddleware({
        target: targetUrl,
        changeOrigin: true,
        secure: false,
        xfwd: true,
        selfHandleResponse: false, // レスポンスを自動で流す
        router: () => targetUrl,
        on: {
            proxyReq: (proxyReq, req) => {
                proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
                proxyReq.setHeader('Referer', targetObj.origin);
            },
            proxyRes: (proxyRes, req, res) => {
                // コンテンツセキュリティポリシー(CSP)などのブロックを緩和する
                delete proxyRes.headers['content-security-policy'];
                delete proxyRes.headers['x-frame-options'];
            }
        }
    })(req, res, next);
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});