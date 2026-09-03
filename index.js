const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// フィルター回避用の暗号化対応プロキシ
app.use('/fetch', (req, res, next) => {
    let encodedUrl = req.query.q;
    if (!encodedUrl) return res.status(400).send('URLが指定されていません');

    let targetUrl;
    try {
        // Base64デコードして元のURLに戻す
        targetUrl = Buffer.from(encodedUrl, 'base64').toString('utf8');
    } catch (e) {
        return res.status(400).send('無効なURLです');
    }

    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
        targetUrl = 'https://' + targetUrl;
    }

    return createProxyMiddleware({
        target: targetUrl,
        changeOrigin: true,
        secure: false,
        xfwd: true,
        router: () => targetUrl,
        on: {
            proxyReq: (proxyReq) => {
                proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
            }
        }
    })(req, res, next);
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});