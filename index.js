const express = require('express');
const axios = require('axios');
const path = require('path');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// フルHTML書き換えプロキシ（画像・CSS・srcset・遅延読み込み完全対応）
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
        
        const response = await axios({
            method: req.method,
            url: targetUrl,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': parsedTarget.origin,
                'Accept': req.headers['accept'] || '*/*',
                'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8'
            },
            responseType: 'arraybuffer',
            validateStatus: () => true,
            timeout: 15000
        });

        const contentType = response.headers['content-type'] || '';
        res.set('Access-Control-Allow-Origin', '*');

        // 画像、CSS、JSなどはそのまま返す
        if (!contentType.includes('text/html')) {
            res.set('Content-Type', contentType);
            return res.send(response.data);
        }

        // HTMLの場合は内部リンク・属性を書き換える
        let html = response.data.toString('utf8');
        const $ = cheerio.load(html);

        const rewriteUrl = (originalUrl) => {
            if (!originalUrl || originalUrl.startsWith('data:') || originalUrl.startsWith('javascript:') || originalUrl.startsWith('#')) {
                return originalUrl;
            }
            try {
                let absoluteUrl = new URL(originalUrl, targetUrl).toString();
                let encoded = Buffer.from(absoluteUrl).toString('base64');
                return `/fetch?q=${encoded}`;
            } catch (e) {
                return originalUrl;
            }
        };

        // 通常属性の書き換え
        const basicAttrs = ['href', 'src', 'data-src', 'data-original', 'action'];
        basicAttrs.forEach(attr => {
            $(`[${attr}]`).each((_, el) => {
                const val = $(el).attr(attr);
                if (val) {
                    $(el).attr(attr, rewriteUrl(val));
                }
            });
        });

        // srcset（高画質・レスポンシブ画像）の分解書き換え
        $('[srcset]').each((_, el) => {
            const srcsetVal = $(el).attr('srcset');
            if (srcsetVal) {
                const newSrcset = srcsetVal.split(',').map(part => {
                    const trimmed = part.trim().split(/\s+/);
                    if (trimmed[0]) {
                        trimmed[0] = rewriteUrl(trimmed[0]);
                    }
                    return trimmed.join(' ');
                }).join(', ');
                $(el).attr('srcset', newSrcset);
            }
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