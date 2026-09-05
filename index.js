const express = require("express");
const axios = require("axios");
const path = require("path");
const cheerio = require("cheerio");

const app = express();
const PORT = process.env.PORT || 3000;

app.set("trust proxy", true);

// ==================================================
// ミドルウェアの設定
// ==================================================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// HTMLなどの静的ファイル配信
app.use(express.static(__dirname));
app.use(express.static(path.join(__dirname, 'public')));

// トップページ
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

// YouTube検索ページ
app.get("/youtube.html", (req, res) => {
    res.sendFile(path.join(__dirname, "youtube.html"));
});

// ==================================================
// ルーティング・APIの読み込み
// ==================================================
try {
    app.use('/api/tube', require('./routes/wakametube'));
    app.use('/api/game', require('./routes/game'));
    app.use('/api/music', require('./routes/music'));
    app.use('/api/tools', require('./routes/tools'));
} catch (e) {
    console.log('Some routes are missing, running with base configuration.');
}

// YouTube API連携用のモジュール読み込み
try {
    const youtubeRouter = require('./server/youtube');
    if (youtubeRouter) {
        app.use('/api/youtube', youtubeRouter);
    }
} catch (e) {
    console.log('YouTube router module not found, skipping.');
}

// ==================================================
// Base64
// ==================================================
function encodeTargetUrl(url) {
    return encodeURIComponent(Buffer.from(url, 'utf8').toString('base64'));
}

function decodeTargetUrl(value) {
    try {
        return Buffer.from(value, 'base64').toString('utf8');
    } catch {
        return null;
    }
}

// ==================================================
// プロキシURL
// ==================================================
function makeProxyUrl(url) {
    return `/fetch?q=${encodeTargetUrl(url)}`;
}

// ==================================================
// URL書き換え
// ==================================================
function rewriteUrl(originalUrl, baseUrl) {
    if (!originalUrl) return originalUrl;
    const value = originalUrl.trim();

    if (
        value.startsWith('data:') || value.startsWith('javascript:') ||
        value.startsWith('mailto:') || value.startsWith('tel:') ||
        value.startsWith('blob:') || value.startsWith('#')
    ) {
        return value;
    }

    try {
        const absolute = new URL(value, baseUrl);
        if (absolute.protocol !== 'http:' && absolute.protocol !== 'https:') {
            return value;
        }
        const hash = absolute.hash;
        absolute.hash = '';
        return makeProxyUrl(absolute.toString()) + hash;
    } catch {
        return value;
    }
}

// ==================================================
// srcset
// ==================================================
function rewriteSrcset(value, baseUrl) {
    if (!value) return value;
    return value.split(',').map(item => {
        const parts = item.trim().split(/\s+/);
        if (!parts.length) return item;
        parts[0] = rewriteUrl(parts[0], baseUrl);
        return parts.join(' ');
    }).join(', ');
}

// ==================================================
// CSS
// ==================================================
function rewriteCss(css, baseUrl) {
    return css.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (match, quote, url) => {
        const trimmed = url.trim();
        if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('blob:') || trimmed.startsWith('#')) {
            return match;
        }
        return `url(${quote}${rewriteUrl(trimmed, baseUrl)}${quote})`;
    });
}

// ==================================================
// Cookie
// ==================================================
function rewriteSetCookie(setCookie) {
    if (!setCookie) return [];
    const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
    return cookies.map(cookie => {
        return cookie
            .replace(/;\s*Domain=[^;]+/gi, '')
            .replace(/;\s*SameSite=None/gi, '; SameSite=Lax');
    });
}

// ==================================================
// HTMLエスケープ
// ==================================================
function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ==================================================
// ★ 診断機能 & フォーム送信自動修正スクリプト
// ==================================================
function injectDiagnosticScript($, targetUrl) {
    const script = `
<script>
(() => {
    'use strict';
    const TARGET_BASE = ${JSON.stringify(targetUrl)};
    console.log('%c[PROXY DIAGNOSTIC]', 'font-weight:bold;font-size:16px', '開始');
    console.log('[PROXY DIAGNOSTIC] 元ページ:', TARGET_BASE);

    function resolveUrl(url) {
        try {
            return new URL(url, TARGET_BASE).toString();
        } catch {
            return String(url);
        }
    }

    function makeProxyUrl(url) {
        const base64 = btoa(unescape(encodeURIComponent(url)));
        return '/fetch?q=' + encodeURIComponent(base64);
    }

    // フォーム送信時に確実にTARGET_BASEを基準にして次のページへ飛ぶように修正
    document.addEventListener('submit', event => {
        const form = event.target;
        if (!(form instanceof HTMLFormElement)) return;

        const actionAttr = form.getAttribute('action') || '';
        const method = (form.getAttribute('method') || 'GET').toUpperCase();
        
        let targetAction = TARGET_BASE;
        if (actionAttr) {
            targetAction = resolveUrl(actionAttr);
        }

        if (method === 'GET') {
            event.preventDefault();
            try {
                const urlObj = new URL(targetAction);
                const formData = new FormData(form);
                for (const [key, value] of formData.entries()) {
                    if (typeof value === 'string') {
                        urlObj.searchParams.set(key, value);
                    }
                }
                location.href = makeProxyUrl(urlObj.toString());
            } catch (e) {
                console.error('[PROXY SUBMIT ERROR]', e);
            }
        } else {
            try {
                form.setAttribute('action', makeProxyUrl(targetAction));
            } catch (e) {
                console.error('[PROXY POST ACTION ERROR]', e);
            }
        }
    }, true);

    function checkUrl(source, url) {
        const resolved = resolveUrl(url);
        console.log('[PROXY URL]', source, { original: url, resolved: resolved });
        return resolved;
    }

    document.querySelectorAll('a[href]').forEach((link, index) => {
        checkUrl('A[' + index + ']', link.getAttribute('href'));
    });

    const originalFetch = window.fetch;
    window.fetch = function(input, init) {
        try {
            const url = typeof input === 'string' ? input : input && input.url;
            if (url) checkUrl('FETCH', url);
        } catch (error) {}
        return originalFetch.apply(this, arguments);
    };

    const originalXhrOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url, async, user, password) {
        try {
            checkUrl('XHR', url);
        } catch (error) {}
        return originalXhrOpen.call(this, method, url, async, user, password);
    };
})();
</script>`;

    if ($('head').length) {
        $('head').prepend(script);
    } else if ($('body').length) {
        $('body').prepend(script);
    } else {
        $.root().prepend(script);
    }
}

// ==================================================
// /fetch プロキシ処理
// ==================================================
app.use('/fetch', express.raw({ type: '/', limit: '25mb' }), async (req, res) => {
    let encodedUrl = req.query.q;
    if (Array.isArray(encodedUrl)) {
        encodedUrl = encodedUrl[encodedUrl.length - 1];
    }

    if (!encodedUrl) {
        return res.status(400).send('URLが指定されていません');
    }

    const targetUrl = decodeTargetUrl(encodedUrl);
    if (!targetUrl) {
        return res.status(400).send('無効なURLです');
    }

    let parsedTarget;
    try {
        parsedTarget = new URL(targetUrl);
    } catch {
        return res.status(400).send('無効なURLです');
    }

    if (parsedTarget.protocol !== 'http:' && parsedTarget.protocol !== 'https:') {
        return res.status(400).send('HTTP/HTTPS以外のURLは使用できません');
    }

    console.log('\n========================================');
    console.log('[PROXY REQUEST]');
    console.log('Method:', req.method);
    console.log('Target:', targetUrl);
    console.log('========================================');

    try {
        const headers = {
            'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
            'Accept': req.headers['accept'] || '*/*',
            'Accept-Language': req.headers['accept-language'] || 'ja,en-US;q=0.9,en;q=0.8',
            'Referer': parsedTarget.origin
        };

        if (req.headers.cookie) headers.Cookie = req.headers.cookie;
        if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];

        let requestData;
        if (req.method !== 'GET' && req.method !== 'HEAD' && req.body && Buffer.isBuffer(req.body)) {
            requestData = req.body;
        }

        // 上流アクセス
        const response = await axios({
            method: req.method,
            url: targetUrl,
            headers: headers,
            data: requestData,
            responseType: 'arraybuffer',
            validateStatus: () => true,
            maxRedirects: 0,
            timeout: 20000
        });

        console.log('[UPSTREAM RESPONSE]', response.status, targetUrl);

        // リダイレクト処理
        if (response.status >= 300 && response.status < 400 && response.headers.location) {
            const redirectTarget = new URL(response.headers.location, targetUrl).toString();
            res.status(response.status);
            res.set('Location', makeProxyUrl(redirectTarget));
            return res.end();
        }

        // Cookie処理
        if (response.headers['set-cookie']) {
            res.set('Set-Cookie', rewriteSetCookie(response.headers['set-cookie']));
        }

        const contentType = response.headers['content-type'] || '';

        // テキスト/HTMLの処理
        if (contentType.toLowerCase().includes('text/html')) {
            const upstreamHtml = response.data.toString('utf8');
            const isBlockPage = upstreamHtml.includes('このウェブサイトは現在管理者によって規制されています') ||
                                upstreamHtml.includes('INTERSAFE') ||
                                upstreamHtml.includes('Gateway Connection');

            if (isBlockPage) {
                return res.status(451).set('Content-Type', 'text/html; charset=utf-8').send(`
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>アクセス規制を検出</title>
<style>
body { margin: 0; padding: 40px 20px; background: #f5f5f5; font-family: Arial, sans-serif; color: #333; }
.box { max-width: 720px; margin: auto; background: white; border-radius: 12px; padding: 30px; box-shadow: 0 4px 20px rgba(0,0,0,.08); }
h1 { font-size: 24px; }
.url { word-break: break-all; background: #eee; padding: 12px; border-radius: 8px; }
</style>
</head>
<body>
<div class="box">
<h1>アクセス規制を検出しました</h1>
<p>上流からWebフィルターの規制ページが返されています。</p>
<p>対象URL:</p>
<div class="url">${escapeHtml(targetUrl)}</div>
</div>
</body>
</html>
                `);
            }

            const $ = cheerio.load(upstreamHtml, { decodeEntities: false });

            $('base').remove();
            $('[integrity]').removeAttr('integrity');
            $('meta[http-equiv]').each((_, el) => {
                if (($(el).attr('http-equiv') || '').toLowerCase() === 'content-security-policy') {
                    $(el).remove();
                }
            });

            const basicAttrs = ['href', 'src', 'data-src', 'data-original', 'data-lazy-src', 'data-url', 'poster', 'action', 'formaction'];
            basicAttrs.forEach(attr => {
                $(`[${attr}]`).each((_, el) => {
                    const value = $(el).attr(attr);
                    if (value) $(el).attr(attr, rewriteUrl(value, targetUrl));
                });
            });

            $('[srcset]').each((_, el) => {
                const value = $(el).attr('srcset');
                if (value) $(el).attr('srcset', rewriteSrcset(value, targetUrl));
            });

            $('[imagesrcset]').each((_, el) => {
                const value = $(el).attr('imagesrcset');
                if (value) $(el).attr('imagesrcset', rewriteSrcset(value, targetUrl));
            });

            $('[style]').each((_, el) => {
                const value = $(el).attr('style');
                if (value) $(el).attr('style', rewriteCss(value, targetUrl));
            });

            $('style').each((_, el) => {
                const value = $(el).html();
                if (value) $(el).html(rewriteCss(value, targetUrl));
            });

            injectDiagnosticScript($, targetUrl);

            res.set('Content-Type', 'text/html; charset=utf-8');
            return res.send($.html());
        }

        // CSSの処理
        if (contentType.toLowerCase().includes('text/css')) {
            let css = response.data.toString('utf8');
            css = rewriteCss(css, targetUrl);
            res.set('Content-Type', contentType);
            return res.send(css);
        }

        // その他のファイル処理
        res.set('Content-Type', contentType);
        return res.send(response.data);

    } catch (error) {
        console.error('========================================');
        console.error('[PROXY ERROR]');
        console.error(error);
        console.error('========================================');
        return res.status(500).send('プロキシエラーが発生しました: ' + error.message);
    }
});

// ==================================================
// OPTIONS
// ==================================================
app.options('/fetch', (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.set('Access-Control-Allow-Headers', '*');
    res.sendStatus(204);
});

// ==================================================
// 起動
// ==================================================
app.listen(PORT, () => {
    console.log('========================================');
    console.log('Tokage Search Proxy & App started');
    console.log('PORT:', PORT);
    console.log('========================================');
});