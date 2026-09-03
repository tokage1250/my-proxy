const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ホーム画面として index.html を表示
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// プロキシ機能
app.use('/proxy', (req, res, next) => {
    let targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('URLが指定されていません');
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
            proxyReq: (proxyReq, req, res) => {
                proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
            }
        }
    })(req, res, next);
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});