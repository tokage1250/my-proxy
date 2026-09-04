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
    app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// YouTube検索ページ
app.get('/youtube.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'youtube.html'));
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

            parts[0] = rewriteUrl(
                parts[0],
                baseUrl
            );

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
            .replace(
                /;\s*SameSite=None/gi,
                '; SameSite=Lax'
            );
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
// ★ 診断機能
// ==================================================
function injectDiagnosticScript($, targetUrl) {

    const script = `
<script>
(() => {
    'use strict';

    const TARGET_BASE =
        ${JSON.stringify(targetUrl)};

    console.log(
        '%c[PROXY DIAGNOSTIC]',
        'font-weight:bold;font-size:16px',
        '開始'
    );

    console.log(
        '[PROXY DIAGNOSTIC] 元ページ:',
        TARGET_BASE
    );

    // ----------------------------------------------
    // URLを絶対URLにする
    // ----------------------------------------------
    function resolveUrl(url) {
        try {
            return new URL(
                url,
                TARGET_BASE
            ).toString();
        } catch {
            return String(url);
        }
    }

    // ----------------------------------------------
    // URLを診断
    // ----------------------------------------------
    function checkUrl(source, url) {

        const resolved = resolveUrl(url);

        console.log(
            '[PROXY URL]',
            source,
            {
                original: url,
                resolved: resolved
            }
        );

        if (
            resolved.includes(
                'chiebukuro.yahoo.co.jp'
            )
        ) {
            console.warn(
                '[PROXY WARNING] Yahoo!知恵袋へのURLを検出:',
                resolved
            );
        }

        return resolved;
    }

    // ==============================================
    // ページ内のフォームを調査
    // ==============================================
    function inspectForms() {

        document
            .querySelectorAll('form')
            .forEach((form, index) => {

                const action =
                    form.getAttribute('action') ||
                    location.href;

                const method =
                    (
                        form.getAttribute('method') ||
                        'GET'
                    ).toUpperCase();

                console.log(
                    '[PROXY FORM]',
                    {
                        index: index,
                        method: method,
                        action: action,
                        resolved: resolveUrl(action)
                    }
                );

                if (
                    resolveUrl(action)
                        .includes(
                            'chiebukuro.yahoo.co.jp'
                        )
                ) {
                    console.warn(
                        '[PROXY WARNING] FORM送信先:',
                        resolveUrl(action)
                    );
                }
            });
    }

    inspectForms();

    // ==============================================
    // リンクを調査
    // ==============================================
    document
        .querySelectorAll('a[href]')
        .forEach((link, index) => {

            const href =
                link.getAttribute('href');

            checkUrl(
                'A[' + index + ']',
                href
            );
        });

    // ==============================================
    // submitイベント
    // ==============================================
    document.addEventListener(
        'submit',
        event => {

            const form = event.target;

            if (
                !(form instanceof HTMLFormElement)
            ) {
                return;
            }

            const action =
                form.getAttribute('action') ||
                location.href;

            const method =
                (
                    form.getAttribute('method') ||
                    'GET'
                ).toUpperCase();

            console.log(
                '[PROXY SUBMIT]',
                {
                    method: method,
                    action: action,
                    resolved: resolveUrl(action)
                }
            );

            // 入力値を診断
            const data = {};

            try {
                new FormData(form)
                    .forEach((value, key) => {

                        if (
                            typeof value ===
                            'string'
                        ) {
                            data[key] = value;
                        }
                    });

                console.log(
                    '[PROXY FORM DATA]',
                    data
                );
            } catch (error) {
                console.warn(
                    '[PROXY FORM DATA ERROR]',
                    error
                );
            }
        },
        true
    );

    // ==============================================
    // クリックイベント
    // ==============================================
    document.addEventListener(
        'click',
        event => {

            let element =
                event.target;

            if (
                element &&
                element.closest
            ) {
                element =
                    element.closest(
                        'a,button,input[type="submit"],input[type="button"]'
                    );
            }

            if (!element) {
                return;
            }

            console.log(
                '[PROXY CLICK]',
                {
                    tag: element.tagName,
                    id: element.id || '',
                    name:
                        element.getAttribute(
                            'name'
                        ) || '',
                    type:
                        element.getAttribute(
                            'type'
                        ) || '',
                    href:
                        element.getAttribute(
                            'href'
                        ) || '',
                    formAction:
                        element.getAttribute(
                            'formaction'
                        ) || ''
                }
            );

            const href =
                element.getAttribute('href');

            const formAction =
                element.getAttribute(
                    'formaction'
                );

            if (href) {
                checkUrl(
                    'CLICK href',
                    href
                );
            }

            if (formAction) {
                checkUrl(
                    'CLICK formaction',
                    formAction
                );
            }
        },
        true
    );

    // ==============================================
    // fetch診断
    // ==============================================
    const originalFetch =
        window.fetch;

    window.fetch = function(
        input,
        init
    ) {

        try {

            const url =
                typeof input === 'string'
                    ? input
                    : input && input.url;

            if (url) {
                checkUrl(
                    'FETCH',
                    url
                );
            }

        } catch (error) {

            console.warn(
                '[PROXY FETCH CHECK ERROR]',
                error
            );
        }

        return originalFetch.apply(
            this,
            arguments
        );
    };

    // ==============================================
    // XHR診断
    // ==============================================
    const originalXhrOpen =
        XMLHttpRequest.prototype.open;

    XMLHttpRequest.prototype.open =
        function(
            method,
            url,
            async,
            user,
            password
        ) {

            try {

                console.log(
                    '[PROXY XHR]',
                    {
                        method: method,
                        url: url,
                        resolved:
                            resolveUrl(url)
                    }
                );

                checkUrl(
                    'XHR',
                    url
                );

            } catch (error) {

                console.warn(
                    '[PROXY XHR ERROR]',
                    error
                );
            }

            return originalXhrOpen.call(
                this,
                method,
                url,
                async,
                user,
                password
            );
        };

    // ==============================================
    // window.open診断
    // ==============================================
    const originalWindowOpen =
        window.open;

    window.open = function(
        url,
        ...args
    ) {

        if (url) {
            checkUrl(
                'WINDOW.OPEN',
                url
            );
        }

        return originalWindowOpen.call(
            window,
            url,
            ...args
        );
    };

    // ==============================================
    // beforeunload
    // ==============================================
    window.addEventListener(
        'beforeunload',
        () => {

            console.warn(
                '[PROXY NAVIGATION]',
                'ページ離脱が発生しました'
            );

            console.warn(
                '[PROXY NAVIGATION] 現在URL:',
                location.href
            );
        }
    );

    // ==============================================
    // popstate
    // ==============================================
    window.addEventListener(
        'popstate',
        () => {

            console.log(
                '[PROXY POPSTATE]',
                location.href
            );
        }
    );

    // ==============================================
    // hashchange
    // ==============================================
    window.addEventListener(
        'hashchange',
        () => {

            console.log(
                '[PROXY HASHCHANGE]',
                location.href
            );
        }
    );

    // ==============================================
    // 定期的に現在URLを確認
    // ==============================================
    let lastUrl =
        location.href;

    setInterval(() => {

        if (
            location.href !== lastUrl
        ) {

            console.warn(
                '[PROXY URL CHANGED]',
                {
                    before: lastUrl,
                    after: location.href
                }
            );

            lastUrl =
                location.href;
        }

    }, 500);

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

        const encodedUrl =
            req.query.q;

        if (!encodedUrl) {
            return res
                .status(400)
                .send(
                    'URLが指定されていません'
                );
        }

        const targetUrl =
            decodeTargetUrl(
                encodedUrl
            );

        if (!targetUrl) {
            return res
                .status(400)
                .send(
                    '無効なURLです'
                );
        }

        let parsedTarget;

        try {
            parsedTarget =
                new URL(targetUrl);
        } catch {
            return res
                .status(400)
                .send(
                    '無効なURLです'
                );
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

        // ==========================================
        // サーバー側診断ログ
        // ==========================================
        console.log('');
        console.log(
            '========================================'
        );

        console.log(
            '[PROXY REQUEST]'
        );

        console.log(
            'Method:',
            req.method
        );

        console.log(
            'Target:',
            targetUrl
        );

        console.log(
            'Browser Referer:',
            req.headers.referer || '(なし)'
        );

        console.log(
            'Browser Origin:',
            req.headers.origin || '(なし)'
        );

        console.log(
            '========================================'
        );

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
                requestData =
                    req.body;
            }

            // ==========================================
            // 上流アクセス
            // ==========================================
            const response =
                await axios({
                    method: req.method,
                    url: targetUrl,
                    headers: headers,
                    data: requestData,
                    responseType: 'arraybuffer',
                    validateStatus: () => true,

                    // リダイレクトを記録するため
                    // 自動追従しない
                    maxRedirects: 0,

                    timeout: 20000
                });

            // ==========================================
            // レスポンス診断
            // ==========================================
            console.log(
                '[UPSTREAM RESPONSE]',
                response.status,
                targetUrl
            );

            console.log(
                '[UPSTREAM CONTENT-TYPE]',
                response.headers[
                    'content-type'
                ] || '(なし)'
            );

            // ==========================================
            // リダイレクト診断
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

                console.warn(
                    '[UPSTREAM REDIRECT]'
                );

                console.warn(
                    'FROM:',
                    targetUrl
                );

                console.warn(
                    'LOCATION:',
                    response.headers.location
                );

                console.warn(
                    'RESOLVED:',
                    redirectTarget
                );

                // 通常のプロキシ処理
                res.status(
                    response.status
                );

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
            if (
                response.headers['set-cookie']
            ) {
                res.set(
                    'Set-Cookie',
                    rewriteSetCookie(
                        response.headers[
                            'set-cookie'
                        ]
                    )
                );
            }

            const contentType =
                response.headers[
                    'content-type'
                ] || '';

            // ==========================================
            // 規制ページ診断
            // ==========================================
            if (
                contentType
                    .toLowerCase()
                    .includes('text/html')
            ) {

                const upstreamHtml =
                    response.data.toString(
                        'utf8'
                    );

                const isBlockPage =
                    upstreamHtml.includes(
                        'このウェブサイトは現在管理者によって規制されています'
                    ) ||
                    upstreamHtml.includes(
                        'INTERSAFE'
                    ) ||
                    upstreamHtml.includes(
                        'Gateway Connection'
                    );

                if (isBlockPage) {

                    console.warn(
                        '========================================'
                    );

                    console.warn(
                        '[BLOCK PAGE DETECTED]'
                    );

                    console.warn(
                        'Target:',
                        targetUrl
                    );

                    console.warn(
                        'This response appears to be a network filter page.'
                    );

                    console.warn(
                        '========================================'
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
<title>アクセス規制を検出</title>

<style>
body {
    margin: 0;
    padding: 40px 20px;
    background: #f5f5f5;
    font-family:
        Arial,
        "Noto Sans JP",
        sans-serif;
    color: #333;
}

.box {
    max-width: 720px;
    margin: auto;
    background: white;
    border-radius: 12px;
    padding: 30px;
    box-shadow:
        0 4px 20px rgba(0,0,0,.08);
}

h1 {
    font-size: 24px;
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

<h1>
アクセス規制を検出しました
</h1>

<p>
上流からWebフィルターの規制ページが
返されています。
</p>

<p>
対象URL:
</p>

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

                // その他
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
            // サーバー側URL診断
            // ==========================================
            console.log(
                '[HTML URL DIAGNOSTIC]'
            );

            $('form').each(
                (index, el) => {

                    const action =
                        $(el).attr('action') ||
                        '';

                    const method =
                        (
                            $(el).attr('method') ||
                            'GET'
                        ).toUpperCase();

                    try {

                        const resolved =
                            new URL(
                                action ||
                                targetUrl,
                                targetUrl
                            ).toString();

                        console.log(
                            `[FORM ${index}]`,
                            {
                                method,
                                action,
                                resolved
                            }
                        );

                    } catch {
                        console.warn(
                            `[FORM ${index}] URL解析失敗`,
                            action
                        );
                    }
                }
            );

            $('a[href]').each(
                (index, el) => {

                    const href =
                        $(el).attr('href');

                    if (!href) {
                        return;
                    }

                    try {

                        const resolved =
                            new URL(
                                href,
                                targetUrl
                            ).toString();

                        if (
                            resolved.includes(
                                'chiebukuro.yahoo.co.jp'
                            )
                        ) {
                            console.warn(
                                `[LINK ${index}] Yahoo URL:`,
                                resolved
                            );
                        }

                    } catch {}
                }
            );

            // ==========================================
            // base削除
            // ==========================================
            $('base').remove();

            // ==========================================
            // integrity削除
            // ==========================================
            $('[integrity]')
                .removeAttr(
                    'integrity'
                );

            // ==========================================
            // CSP meta削除
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

            basicAttrs.forEach(
                attr => {

                    $(`[${attr}]`).each(
                        (_, el) => {

                            const value =
                                $(el).attr(
                                    attr
                                );

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
                }
            );

            // ==========================================
            // srcset
            // ==========================================
            $('[srcset]').each(
                (_, el) => {

                    const value =
                        $(el).attr(
                            'srcset'
                        );

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
                        $(el).attr(
                            'imagesrcset'
                        );

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
                        $(el).attr(
                            'style'
                        );

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
            // ★ 診断スクリプトを挿入
            // ==========================================
            injectDiagnosticScript(
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
                '========================================'
            );

            console.error(
                '[PROXY ERROR]'
            );

            console.error(
                error
            );

            console.error(
                '========================================'
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
        '========================================'
    );

    console.log(
        'Proxy server started'
    );

    console.log(
        'PORT:',
        PORT
    );

    console.log(
        '========================================'
    );
});