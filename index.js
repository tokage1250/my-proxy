const express = require('express');
const axios = require('axios');
const path = require('path');
const cheerio = require('cheerio');
const URL = require('url').URL;

const app = express();
const PORT = process.env.PORT || 3000;

// トップページ（入力画面）
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// フルHTML書き換えプロキシ（遅延読み込み・レスポンシブ画像対応版）
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
        
        // オリジナルのサイトに怪しまれないように偽装してリクエスト
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
            validateStatus: () => true, // エラーでもクラッシュさせない
            timeout: 15000 // 15秒でタイムアウト
        });

        const contentType = response.headers['content-type'] || '';

        // CORSエラーを回避するためのヘッダーを追加
        res.set('Access-Control-Allow-Origin', '*');

        // 画像、CSS、JSなどは書き換えずにそのまま中継する
        if (!contentType.includes('text/html')) {
            res.set('Content-Type', contentType);
            return res.send(response.data);
        }

        // HTMLの場合は、Cheerioを使って内部のリンクを徹底的に書き換える
        let html = response.data.toString('utf8');
        const $ = cheerio.load(html);

        const rewriteUrl = (originalUrl) => {
            if (!originalUrl || originalUrl.startsWith('data:') || originalUrl.startsWith('javascript:') || originalUrl.startsWith('#')) {
                return originalUrl;
            }
            try {
                // 相対パスを絶対パスに変換し、Base64で暗号化してプロキシURLに置き換える
                let absoluteUrl = new URL(originalUrl, targetUrl).toString();
                let encoded = Buffer.from(absoluteUrl).toString('base64');
                return `/fetch?q=${encoded}`;
            } catch (e) {
                return originalUrl;
            }
        };

        // 通常のリンクや画像の書き換え（遅延読み込み用の data-src なども追加）
        const basicAttrs = ['href', 'src', 'data-src', 'data-original', 'action'];
        basicAttrs.forEach(attr => {
            $(`[${attr}]`).each((_, el) => {
                const val = $(el).attr(attr);
                if (val) {
                    $(el).attr(attr, rewriteUrl(val));
                }
            });
        });

        // srcset属性（レスポンシブ画像）の特殊な書き換え処理
        const rewriteSrcset = (attr) => {
            $(`[${attr}]`).修正する準備は万端ですが、肝心のコードが入力されていません。しっかりと考えて最適な修正案を出したいので、以下の情報を共有していただけますか？

* **修正したい元のコード**（関連する部分だけでも構いません）
* **発生しているエラーメッセージ**（表示されている場合）
* **本来どのような動作をさせたいか**（期待する結果や目的）

詳細を教えていただければ、すぐに原因を分析して具体的な修正コードをご提案します。