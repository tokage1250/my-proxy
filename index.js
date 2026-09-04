const express = require('express');
const axios = require('axios');
const path = require('path');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', true);

// --------------------------------------------------
// トップページ
// --------------------------------------------------
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --------------------------------------------------
// URLをBase64化
// --------------------------------------------------
function encodeTargetUrl(url) {
    return encodeURIComponent(
        Buffer.from(url, 'utf8').toString('base64')
    );
}

// --------------------------------------------------
// Base64 URLを復元
// --------------------------------------------------
function decodeTargetUrl(value) {
    try {
        return Buffer.from(value, 'base64').toString('utf8');
    } catch {
        return null;
    }
}

// --------------------------------------------------
// プロキシURL生成
// --------------------------------------------------
function makeProxyUrl(url) {
    return `/fetch?q=${encodeTargetUrl(url)}`;
}

// --------------------------------------------------
// URL書き換え
// --------------------------------------------------
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

// --------------------------------------------------
// srcset書き換え
// --------------------------------------------------
function rewriteSrcset(value, baseUrl) {
    if (!value) return value;

    return value
        .split(',')
        .map(item => {
            const parts = item.trim().split(/\s+/);

            if (parts.length === 0) {
                return item;
            }

            parts[0] = rewriteUrl(parts[0], baseUrl);

            return parts.join(' ');
        })
        .join(', ');
}

// --------------------------------------------------
// CSSのurl()書き換え
// --------------------------------------------------
function rewriteCss(css, baseUrl) {
    return css.replace(
        /url\(\s*(['"]?)(.*?)\1\s*\)/gi,
        (match, quote, url) => {
            const trimmed = url.trim();

            if (
                !trimmed ||
                trimmed.startsWith('data:') ||
                trimmed.startsWith('#') ||
                trimmed.startsWith('blob:')
            ) {
                return match;
            }

            const rewritten = rewriteUrl(
                trimmed,
                baseUrl
            );

            return `url(${quote}${rewritten}${quote})`;
        }
    );
}

// --------------------------------------------------
// Cookie書き換え
// --------------------------------------------------
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

// --------------------------------------------------
// JavaScript通信インターセプター
// --------------------------------------------------
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

    // fetch
    const originalFetch = window.fetch;

    window.fetch = function(input, init) {
        try {
            let originalUrl =
                typeof input === 'string'
                    ? input
                    : input && input.url;

            if (
                !originalUrl ||
                isIgnored(originalUrl)
            ) {
                return originalFetch.apply(
                    this,
                    arguments
                );
            }

            if (
                originalUrl.startsWith('/fetch?q=') ||
                originalUrl.includes(
                    location.origin + '/fetch?q='
                )
            ) {
                return originalFetch.apply(
                    this,
                    arguments
                );
            }

            const rewritten = makeProxy(
                originalUrl
            );

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

    // XMLHttpRequest
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
                !url.startsWith('/fetch?q=') &&
                !url.includes(
                    location.origin + '/fetch?q='
                )
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

    // フォーム送信
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

                const target = new URL(
                    action,
                    PROXY_TARGET_BASE
                );

                if (method === 'get') {
                    const formData =
                        new FormData(form);

                    for (
                        const [key, value]
                        of formData.entries()
                    ) {
                        if (
                            typeof value ===
                            'string'
                        ) {
                            target.searchParams.append(
                                key,
                                value
                            );
                        }
                    }

                    event.preventDefault();

                    location.href =
                        makeProxyUrl(
                            target.toString()
                        );

                    return;
                }

                if (
                    target.protocol === 'http:' ||
                    target.protocol === 'https:'
                ) {
                    form.setAttribute(
                        'action',
                        makeProxyUrl(
                            target.toString()
                        )
                    );
                }
            } catch (e) {
                console.error(
                    'Proxy form error:',
                    e
                );
            }
        },
        true
    );

    // window.open
    const originalWindowOpen =
        window.open;

    window.open = function(
        url,
        ...args
    ) {
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

// --------------------------------------------------
// プロキシ本体
// --------------------------------------------------
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
            parsedTarget = new URL(targetUrl);
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
                .send(
                    'HTTP/HTTPS以外のURLは使用できません'
                );
        }

        try {
            const upstreamHeaders = {
                'User-Agent':
                    req.headers['user-agent'] ||
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',

                'Accept':
                    req.headers['accept'] || '*/*',

                'Accept-Language':
                    req.headers['accept-language'] ||
                    'ja,en-US;q=0.9,en;q=0.8',

                'Referer':
                    parsedTarget.origin
            };

            if (req.headers.cookie) {
                upstreamHeaders.Cookie =
                    req.headers.cookie;
            }

            if (req.headers['content-type']) {
                upstreamHeaders['Content-Type'] =
                    req.headers['content-type'];
            }

            let requestData = undefined;

            if (
                req.method !== 'GET' &&
                req.method !== 'HEAD' &&
                req.body &&
                Buffer.isBuffer(req.body) &&
                req.body.length > 0
            ) {
                requestData = req.body;
            }

            const response = await axios({
                method: req.method,
                url: targetUrl,
                headers: upstreamHeaders,
                data: requestData,
                responseType: 'arraybuffer',
                validateStatus: () => true,
                maxRedirects: 0,
                timeout: 20000
            });

            res.set(
                'Access-Control-Allow-Origin',
                '*'
            );

            res.set(
                'Access-Control-Allow-Headers',
                '*'
            );

            // ------------------------------------------
            // リダイレクト
            // ------------------------------------------
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

                res.status(response.status);

                res.set(
                    'Location',
                    makeProxyUrl(
                        redirectTarget
                    )
                );

                return res.end();
            }

            // ------------------------------------------
            // Cookie
            // ------------------------------------------
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

            // ==================================================
            // ★ ここを追加
            // 規制ページの検出
            // ==================================================
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
                        '上流ネットワークの規制ページを検出:',
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
    font-family:
        Arial,
        "Noto Sans JP",
        sans-serif;
    background: #f5f5f5;
    margin: 0;
    padding: 40px 20px;
    color: #333;
}
.box {
    max-width: 700px;
    margin: auto;
    background: #fff;
    border-radius: 12px;
    padding: 30px;
    box-shadow:
        0 4px 20px rgba(0,0,0,.08);
}
h1 {
    font-size: 24px;
    margin-top: 0;
}
.url {
    word-break: break-all;
    background: #f1f1f1;
    padding: 12px;
    border-radius: 8px;
}
.note {
    color: #666;
    line-height: 1.7;
}
</style>
</head>
<body>
<div class="box">
    <h1>アクセスが規制されています</h1>

    <p class="note">
        接続先ネットワークの
        Webフィルターによって、このページへの
        アクセスが拒否されました。
    </p>

    <p class="note">リクエストURL:</p>

    <div class="url">
        ${escapeHtml(targetUrl)}
    </div>
</div>
</body>
</html>
                        `);
                }
            }

            // ------------------------------------------
            // HTML以外
            // ------------------------------------------
            if (
                !contentType
                    .toLowerCase()
                    .includes('text/html')
            ) {
                if (
                    contentType
                        .toLowerCase()
                        .includes('text/css')
                ) {
                    let css =
                        response.data.toString(
                            'utf8'
                        );

                    css = rewriteCss(
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

            // ------------------------------------------
            // HTML処理
            // ------------------------------------------
            const html =
                response.data.toString(
                    'utf8'
                );

            const $ = cheerio.load(
                html,
                {
                    decodeEntities: false
                }
            );

            $('base').remove();

            $('[integrity]').removeAttr(
                'integrity'
            );

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

            // URL属性
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

                        if (!value) return;

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

            // srcset
            $('[srcset]').each(
                (_, el) => {
                    const value =
                        $(el).attr('srcset');

                    if (!value) return;

                    $(el).attr(
                        'srcset',
                        rewriteSrcset(
                            value,
                            targetUrl
                        )
                    );
                }
            );

            // imagesrcset
            $('[imagesrcset]').each(
                (_, el) => {
                    const value =
                        $(el).attr('imagesrcset');

                    if (!value) return;

                    $(el).attr(
                        'imagesrcset',
                        rewriteSrcset(
                            value,
                            targetUrl
                        )
                    );
                }
            );

            // style属性
            $('[style]').each(
                (_, el) => {
                    const value =
                        $(el).attr('style');

                    if (!value) return;

                    $(el).attr(
                        'style',
                        rewriteCss(
                            value,
                            targetUrl
                        )
                    );
                }
            );

            // styleタグ
            $('style').each(
                (_, el) => {
                    const value =
                        $(el).html();

                    if (!value) return;

                    $(el).html(
                        rewriteCss(
                            value,
                            targetUrl
                        )
                    );
                }
            );

            // JavaScript
            injectProxyScript(
                $,
                targetUrl
            );

            res.set(
                'Content-Type',
                'text/html; charset=utf-8'
            );

            return res.send(
                $.html()
            );

        } catch (err) {
            console.error(
                'Proxy Error:',
                err
            );

            return res
                .status(500)
                .send(
                    'プロキシエラーが発生しました: ' +
                    err.message
                );
        }
    }
);

// --------------------------------------------------
// HTMLエスケープ
// --------------------------------------------------
function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// --------------------------------------------------
// OPTIONS
// --------------------------------------------------
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

// --------------------------------------------------
// 起動
// --------------------------------------------------
app.listen(PORT, () => {
    console.log(
        `Server is running on port ${PORT}`
    );
});