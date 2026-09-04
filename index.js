const express = require('express');
const axios = require('axios');
const path = require('path');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', true);

// ==================================================
// トップページ
// ==================================================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ==================================================
// Base64
// ==================================================
function encodeTargetUrl(url) {
    return encodeURIComponent(
        Buffer.from(url, 'utf8').toString('base64')
    );
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
        value.startsWith('data:') ||
        value.startsWith('javascript:') ||
        value.startsWith('mailto:') ||
        value.startsWith('tel:') ||
        value.startsWith('blob:') ||
        value.startsWith('#')
    ) {
        return value;
    }

    try {
        const absolute = new URL(value, baseUrl);

        if (
            absolute.protocol !== 'http:' &&
            absolute.protocol !== 'https:'
        ) {
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

    return value
        .split(',')
        .map(item => {
            const parts = item.trim().split(/\s+/);

            if (!parts.length) {
                return item;
            }

            parts[0] = rewriteUrl(parts[0], baseUrl);

            return parts.join(' ');
        })
        .join(', ');
}

// ==================================================
// CSS
// ==================================================
function rewriteCss(css, baseUrl) {
    return css.replace(
        /url\(\s*(['"]?)(.*?)\1\s*\)/gi,
        (match, quote, url) => {
            const trimmed = url.trim();

            if (
                !trimmed ||
                trimmed.startsWith('data:') ||
                trimmed.startsWith('blob:') ||
                trimmed.startsWith('#')
            ) {
                return match;
            }

            return `url(${quote}${rewriteUrl(
                trimmed,
                baseUrl
            )}${quote})`;
        }
    );
}

// ==================================================
// Cookie
// ==================================================
function rewriteSetCookie(setCookie) {
    if (!setCookie) return [];

    const cookies = Array.isArray(setCookie)
        ? setCookie
        : [setCookie];

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
// JavaScriptインターセプター
// ==================================================
function injectProxyScript($, targetUrl) {
    const script = `
<script>
(() => {
    const PROXY_TARGET_BASE = ${JSON.stringify(targetUrl)};

    function isIgnored(url) {
        return (
            !url ||
            url.startsWith('data:') ||
            url.startsWith('blob:') ||
            url.startsWith('javascript:') ||
            url.startsWith('mailto:') ||
            url.startsWith('tel:')
        );
    }

    function makeProxy(url) {
        try {
            const absolute = new URL(
                url,
                PROXY_TARGET_BASE
            );

            if (
                absolute.protocol !== 'http:' &&
                absolute.protocol !== 'https:'
            ) {
                return url;
            }

            if (
                absolute.origin === location.origin &&
                absolute.pathname === '/fetch'
            ) {
                return url;
            }

            const hash = absolute.hash;
            absolute.hash = '';

            const encoded =
                encodeURIComponent(
                    btoa(
                        unescape(
                            encodeURIComponent(
                                absolute.toString()
                            )
                        )
                    )
                );

            return '/fetch?q=' + encoded + hash;
        } catch {
            return url;
        }
    }

    // ==============================================
    // fetch
    // ==============================================
    const originalFetch = window.fetch;

    window.fetch = function(input, init) {
        try {
            let url =
                typeof input === 'string'
                    ? input
                    : input && input.url;

            if (
                !url ||
                isIgnored(url) ||
                url.startsWith('/fetch?q=')
            ) {
                return originalFetch.apply(
                    this,
                    arguments
                );
            }

            const rewritten = makeProxy(url);

            if (typeof input === 'string') {
                return originalFetch.call(
                    this,
                    rewritten,
                    init
                );
            }

            if (input instanceof Request) {
                const request = new Request(
                    rewritten,
                    input
                );

                return originalFetch.call(
                    this,
                    request,
                    init
                );
            }

            return originalFetch.apply(
                this,
                arguments
            );
        } catch {
            return originalFetch.apply(
                this,
                arguments
            );
        }
    };

    // ==============================================
    // XMLHttpRequest
    // ==============================================
    const originalOpen =
        XMLHttpRequest.prototype.open;

    XMLHttpRequest.prototype.open = function(
        method,
        url,
        async,
        user,
        password
    ) {
        try {
            if (
                typeof url === 'string' &&
                !isIgnored(url) &&
                !url.startsWith('/fetch?q=')
            ) {
                url = makeProxy(url);
            }
        } catch {}

        return originalOpen.call(
            this,
            method,
            url,
            async,
            user,
            password
        );
    };

    // ==============================================
    // フォーム送信
    // ==============================================
    document.addEventListener(
        'submit',
        function(event) {
            try {
                const form = event.target;

                if (!(form instanceof HTMLFormElement)) {
                    return;
                }

                const action =
                    form.getAttribute('action') ||
                    location.href;

                const method =
                    (
                        form.getAttribute('method') ||
                        'get'
                    ).toLowerCase();

                const resolved =
                    new URL(
                        action,
                        PROXY_TARGET_BASE
                    );

                console.log(
                    '[PROXY FORM]',
                    {
                        method,
                        action,
                        resolvedUrl: resolved.toString()
                    }
                );

                // GET検索
                if (method === 'get') {
                    const formData =
                        new FormData(form);

                    for (
                        const [key, value]
                        of formData.entries()
                    ) {
                        if (
                            typeof value === 'string'
                        ) {
                            resolved.searchParams.append(
                                key,
                                value
                            );
                        }
                    }

                    const finalUrl =
                        resolved.toString();

                    console.log(
                        '[PROXY SEARCH]',
                        finalUrl
                    );

                    event.preventDefault();

                    location.href =
                        makeProxyUrl(finalUrl);

                    return;
                }

                // POST等
                form.setAttribute(
                    'action',
                    makeProxyUrl(
                        resolved.toString()
                    )
                );
            } catch (error) {
                console.error(
                    '[PROXY FORM ERROR]',
                    error
                );
            }
        },
        true
    );

    // ==============================================
    // window.open
    // ==============================================
    const originalWindowOpen =
        window.open;

    window.open = function(url, ...args) {
        try {
            if (
                typeof url === 'string' &&
                !isIgnored(url)
            ) {
                url = makeProxy(url);
            }
        } catch {}

        return originalWindowOpen.call(
            window,
            url,
            ...args
        );
    };
})();
</script>
`;

    if ($('head').length) {
        $('head').prepend(script);
    } else if ($('body').length) {
        $('body').prepend(script);
    } else {
        $.root().prepend(script);
    }
}

// ==================================================
// /fetch
// ==================================================
app.use(
    '/fetch',
    express.raw({
        type: '*/*',
        limit: '25mb'
    }),
    async (req, res) => {

        const encodedUrl = req.query.q;

        if (!encodedUrl) {
            return res
                .status(400)
                .send('URLが指定されていません');
        }

        const targetUrl =
            decodeTargetUrl(encodedUrl);

        if (!targetUrl) {
            return res
                .status(400)
                .send('無効なURLです');
        }

        let parsedTarget;

        try {
            parsedTarget =
                new URL(targetUrl);
        } catch {
            return res
                .status(400)
                .send('無効なURLです');
        }

        if (
            parsedTarget.protocol !== 'http:' &&
            parsedTarget.protocol !== 'https:'
        ) {
            return res
                .status(400)
                .send('HTTP/HTTPS以外のURLは使用できません');
        }

        console.log('');
        console.log('==============================');
        console.log('[PROXY REQUEST]');
        console.log(req.method);
        console.log(targetUrl);
        console.log('==============================');

        try {

            const headers = {
                'User-Agent':
                    req.headers['user-agent'] ||
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',

                'Accept':
                    req.headers['accept'] ||
                    '*/*',

                'Accept-Language':
                    req.headers['accept-language'] ||
                    'ja,en-US;q=0.9,en;q=0.8',

                'Referer':
                    parsedTarget.origin
            };

            if (req.headers.cookie) {
                headers.Cookie =
                    req.headers.cookie;
            }

            if (req.headers['content-type']) {
                headers['Content-Type'] =
                    req.headers['content-type'];
            }

            let requestData;

            if (
                req.method !== 'GET' &&
                req.method !== 'HEAD' &&
                req.body &&
                Buffer.isBuffer(req.body)
            ) {
                requestData = req.body;
            }

            const response = await axios({
                method: req.method,
                url: targetUrl,
                headers,
                data: requestData,
                responseType: 'arraybuffer',
                validateStatus: () => true,
                maxRedirects: 0,
                timeout: 20000
            });

            // ==========================================
            // 共通ヘッダー
            // ==========================================
            res.set(
                'Access-Control-Allow-Origin',
                '*'
            );

            res.set(
                'Access-Control-Allow-Headers',
                '*'
            );

            // ==========================================
            // リダイレクト
            // ==========================================
            if (
                response.status >= 300 &&
                response.status < 400 &&
                response.headers.location
            ) {
                const redirectTarget =
                    new URL(
                        response.headers.location,
                        targetUrl
                    ).toString();

                console.log(
                    '[REDIRECT]',
                    targetUrl,
                    '=>',
                    redirectTarget
                );

                res.status(response.status);

                res.set(
                    'Location',
                    makeProxyUrl(
                        redirectTarget
                    )
                );

                return res.end();
            }

            // ==========================================
            // Cookie
            // ==========================================
            if (response.headers['set-cookie']) {
                res.set(
                    'Set-Cookie',
                    rewriteSetCookie(
                        response.headers['set-cookie']
                    )
                );
            }

            const contentType =
                response.headers['content-type'] ||
                '';

            console.log(
                '[CONTENT TYPE]',
                contentType
            );

            // ==========================================
            // 規制ページ検出
            // ==========================================
            if (
                contentType
                    .toLowerCase()
                    .includes('text/html')
            ) {
                const upstreamHtml =
                    response.data.toString('utf8');

                if (
                    upstreamHtml.includes(
                        'このウェブサイトは現在管理者によって規制されています'
                    ) ||
                    upstreamHtml.includes(
                        'INTERSAFE'
                    ) ||
                    upstreamHtml.includes(
                        'Gateway Connection'
                    )
                ) {
                    console.warn(
                        '[BLOCK PAGE DETECTED]',
                        targetUrl
                    );

                    return res
                        .status(451)
                        .set(
                            'Content-Type',
                            'text/html; charset=utf-8'
                        )
                        .send(`
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport"
      content="width=device-width,initial-scale=1">
<title>アクセスが規制されています</title>
<style>
body {
    margin: 0;
    padding: 40px 20px;
    font-family:
        Arial,
        "Noto Sans JP",
        sans-serif;
    background: #f5f5f5;
    color: #333;
}
.box {
    max-width: 700px;
    margin: auto;
    background: white;
    padding: 30px;
    border-radius: 12px;
    box-shadow:
        0 4px 20px rgba(0,0,0,.08);
}
.url {
    word-break: break-all;
    background: #eee;
    padding: 12px;
    border-radius: 8px;
}
</style>
</head>
<body>
<div class="box">
<h2>アクセスが規制されています</h2>

<p>
接続先ネットワークのWebフィルターによって
アクセスが拒否されています。
</p>

<p>リクエストURL:</p>

<div class="url">
${escapeHtml(targetUrl)}
</div>

</div>
</body>
</html>
                        `);
                }
            }

            // ==========================================
            // HTML以外
            // ==========================================
            if (
                !contentType
                    .toLowerCase()
                    .includes('text/html')
            ) {

                // CSS
                if (
                    contentType
                        .toLowerCase()
                        .includes('text/css')
                ) {
                    let css =
                        response.data.toString(
                            'utf8'
                        );

                    css =
                        rewriteCss(
                            css,
                            targetUrl
                        );

                    res.set(
                        'Content-Type',
                        contentType
                    );

                    return res.send(css);
                }

                res.set(
                    'Content-Type',
                    contentType
                );

                return res.send(
                    response.data
                );
            }

            // ==========================================
            // HTML
            // ==========================================
            const html =
                response.data.toString(
                    'utf8'
                );

            const $ =
                cheerio.load(
                    html,
                    {
                        decodeEntities: false
                    }
                );

            // ==========================================
            // ★ URL診断ログ
            // ==========================================
            console.log(
                '[URL CHECK] Target:',
                targetUrl
            );

            $('a[href], form[action]').each(
                (_, el) => {

                    const isForm =
                        $(el).is('form');

                    const attr =
                        isForm
                            ? 'action'
                            : 'href';

                    const value =
                        $(el).attr(attr);

                    if (!value) {
                        return;
                    }

                    try {
                        const absolute =
                            new URL(
                                value,
                                targetUrl
                            ).toString();

                        console.log(
                            `[URL CHECK] ${attr}:`,
                            value,
                            '=>',
                            absolute
                        );
                    } catch (e) {
                        console.log(
                            `[URL CHECK ERROR] ${attr}:`,
                            value
                        );
                    }
                }
            );

            // ==========================================
            // base削除
            // ==========================================
            $('base').remove();

            // ==========================================
            // integrity削除
            // ==========================================
            $('[integrity]').removeAttr(
                'integrity'
            );

            // ==========================================
            // CSP削除
            // ==========================================
            $('meta[http-equiv]').each(
                (_, el) => {

                    const value =
                        (
                            $(el).attr(
                                'http-equiv'
                            ) || ''
                        ).toLowerCase();

                    if (
                        value ===
                        'content-security-policy'
                    ) {
                        $(el).remove();
                    }
                }
            );

            // ==========================================
            // 基本属性
            // ==========================================
            const basicAttrs = [
                'href',
                'src',
                'data-src',
                'data-original',
                'data-lazy-src',
                'data-url',
                'poster',
                'action',
                'formaction'
            ];

            basicAttrs.forEach(attr => {

                $(`[${attr}]`).each(
                    (_, el) => {

                        const value =
                            $(el).attr(attr);

                        if (!value) {
                            return;
                        }

                        $(el).attr(
                            attr,
                            rewriteUrl(
                                value,
                                targetUrl
                            )
                        );
                    }
                );
            });

            // ==========================================
            // srcset
            // ==========================================
            $('[srcset]').each(
                (_, el) => {

                    const value =
                        $(el).attr('srcset');

                    if (!value) {
                        return;
                    }

                    $(el).attr(
                        'srcset',
                        rewriteSrcset(
                            value,
                            targetUrl
                        )
                    );
                }
            );

            // ==========================================
            // imagesrcset
            // ==========================================
            $('[imagesrcset]').each(
                (_, el) => {

                    const value =
                        $(el).attr('imagesrcset');

                    if (!value) {
                        return;
                    }

                    $(el).attr(
                        'imagesrcset',
                        rewriteSrcset(
                            value,
                            targetUrl
                        )
                    );
                }
            );

            // ==========================================
            // style属性
            // ==========================================
            $('[style]').each(
                (_, el) => {

                    const value =
                        $(el).attr('style');

                    if (!value) {
                        return;
                    }

                    $(el).attr(
                        'style',
                        rewriteCss(
                            value,
                            targetUrl
                        )
                    );
                }
            );

            // ==========================================
            // styleタグ
            // ==========================================
            $('style').each(
                (_, el) => {

                    const value =
                        $(el).html();

                    if (!value) {
                        return;
                    }

                    $(el).html(
                        rewriteCss(
                            value,
                            targetUrl
                        )
                    );
                }
            );

            // ==========================================
            // JSインターセプター
            // ==========================================
            injectProxyScript(
                $,
                targetUrl
            );

            // ==========================================
            // 出力
            // ==========================================
            res.set(
                'Content-Type',
                'text/html; charset=utf-8'
            );

            return res.send(
                $.html()
            );

        } catch (error) {

            console.error(
                '[PROXY ERROR]',
                error
            );

            return res
                .status(500)
                .send(
                    'プロキシエラーが発生しました: ' +
                    error.message
                );
        }
    }
);

// ==================================================
// OPTIONS
// ==================================================
app.options(
    '/fetch',
    (req, res) => {

        res.set(
            'Access-Control-Allow-Origin',
            '*'
        );

        res.set(
            'Access-Control-Allow-Methods',
            'GET,POST,PUT,PATCH,DELETE,OPTIONS'
        );

        res.set(
            'Access-Control-Allow-Headers',
            '*'
        );

        res.sendStatus(204);
    }
);

// ==================================================
// 起動
// ==================================================
app.listen(PORT, () => {
    console.log(
        `Server is running on port ${PORT}`
    );
});