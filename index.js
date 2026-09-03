const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// ホーム画面（かっこよくしたindex.htmlを表示）
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// プロキシ機能
app.use('/proxy', (req, res, next) => {
    let targetUrl = req.query.url;
    if (!targetUrl) {
        return res.status(400).send('URLが指定されていません。');
    }
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
        targetUrl = 'https://' + targetUrl;
    }

    try {
        const proxy = createProxyMiddleware({
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
        });
        return proxy(req, res, next);
    } catch (err) {
        res.status(500).send('プロキシエラーが発生しました。');
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});