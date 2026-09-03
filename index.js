const express = require('express');
const axios = require('axios');
const path = require('path');
const cheerio = require('cheerio');
const URL = require('url').URL;

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// フルHTML書き換え型プロキシ（画像・CSS・リンク崩れを完全に防止）
app.use('/fetch', async (req, res) => {
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

    try {
        const parsedTarget = new URL(targetUrl);
        
        // 元サイトへリクエストを送信
        const response = await axios({
            method: req.method,
            url: targetUrl,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': parsedTarget.origin,
                'Accept': req.headers['accept'] || '*/*'
            },
            responseType: 'arraybuffer',
            validateStatus: () => true
        });

        const contentType = response.headers['content-type'] || '';

        // 画像やCSSなどの静的ファイルはそのまま返す
        if (!contentType.includes('text/html')) {
            res.set('Content-Type', contentType);
            return res.send(response.data);
        }

        // HTMLの場合は内部のリンクをプロキシ経由に書き換える
        let html = response.data.toString('utf8');
        const $ = cheerio.load(html);

        const rewriteUrl = (originalUrl) => {
            if (!originalUrl || originalUrl.startsWith('data:') || originalUrl.startsWith('javascript:')) return originalUrl;
            try {
                let absoluteUrl = new URL(originalUrl, targetUrl).toString();
                let encoded = Buffer.from(absoluteUrl).toString('base64');
                return `/fetch?q=${encoded}`;
            } catch (e) {
                return originalUrl;
            }
        };

        // 各種タグのリンクを書き換え
        $('[href]').each((_, el) => {
            $(el).attr('href', rewriteUrl($(el).attr('href')));
        });
        $('[src]').each((_, el) => {
            $(el).attr('src', rewriteUrl($(el).attr('src')));
        });
        $('[action]').each((_, el) => {
            $(el).attr('action', rewriteUrl($(el).attr('action')));
        });

        res.set('Content-Type', 'text/html; charset=utf-8');
        res.send($.html());

    } catch (err) {
        console.error(err);
        res.status(500).send('プロキシエラーが発生しました: ' + err.message);
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});