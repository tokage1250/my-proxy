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
        // 通常Base64
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
// URLを書き換える
// --------------------------------------------------
function rewriteUrl(originalUrl, baseUrl) {
    if (!originalUrl) return originalUrl;

    const value = originalUrl.trim();

    // そのまま維持するもの
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
        // URLを絶対URLへ変換
        const absolute = new URL(value, baseUrl);

        // http / https 以外はそのまま
        if (
            absolute.protocol !== 'http:' &&
            absolute.protocol !== 'https:'
        ) {
            return value;
        }

        // #fragment はプロキシURLの外側へ残す
        const hash = absolute.hash;
        absolute.hash = '';

        return makeProxyUrl(absolute.toString()) + hash;
    } catch {
        return value;
    }
}

// --------------------------------------------------
// srcsetを書き換える
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
// CSS内の url(...) を書き換える
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

            const rewritten = rewriteUrl(trimmed, baseUrl);

            return `url(${quote}${rewritten}${quote})`;
        }
    );
}

// --------------------------------------------------
// Cookieを書き換える
// 元サイトのDomainを削除してプロキシ側で扱えるようにする
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
// HTMLへJavaScript通信インターセプターを追加
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
            const absolute = new URL(url, PROXY_TARGET_BASE);

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
                            encodeURIComponent(absolute.toString())
                        )
                    )
                );

            return '/fetch?q=' + encoded + hash;
        } catch {
            return url;
        }
    }

    // ----------------------------------------------
    // fetch
    // ----------------------------------------------
    const originalFetch = window.fetch;

    window.fetch = function(input, init) {
        try {
            let originalUrl =
                typeof input === 'string'
                    ? input
                    : input && input.url;

            if (!originalUrl || isIgnored(originalUrl)) {
                return originalFetch.apply(this, arguments);
            }

            // すでにプロキシURLならそのまま
            if (
                originalUrl.startsWith('/fetch?q=') ||
                originalUrl.includes(location.origin + '/fetch?q=')
            ) {
                return originalFetch.apply(this, arguments);
            }

            const rewritten = makeProxy(originalUrl);

            if (typeof input === 'string') {
                return originalFetch.call(this, rewritten, init);
            }

            if (input instanceof Request) {
                const request = new Request(
                    rewritten,
                    input
                );

                return originalFetch.call(this, request, init);
            }

            return originalFetch.apply(this, arguments);
        } catch {
            return originalFetch.apply(this, arguments);
        }
    };

    // ----------------------------------------------
    // XMLHttpRequest
    // ----------------------------------------------
    const originalOpen = XMLHttpRequest.prototype.open;

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
                !url.includes(location.origin + '/fetch?q=')
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

    // ----------------------------------------------
    // フォーム送信
    // ----------------------------------------------
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
                    (form.getAttribute('method') || 'get')
                        .toLowerCase();

                const target = new URL(
                    action,
                    PROXY_TARGET_BASE
                );

                // GETフォーム
                if (method === 'get') {
                    const formData = new FormData(form);

                    for (const [key, value] of formData.entries()) {
                        if (typeof value === 'string') {
                            target.searchParams.append(
                                key,
                                value
                            );
                        }
                    }

                    event.preventDefault();

                    location.href =
                        makeProxy(target.toString());

                    return;
                }

                // POSTなど
                // action自体をプロキシへ
                if (
                    target.protocol === 'http:' ||
                    target.protocol === 'https:'
                ) {
                    const proxyAction =
                        makeProxy(target.toString());

                    form.setAttribute(
                        'action',
                        proxyAction
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

    // ----------------------------------------------
    // window.open
    // ----------------------------------------------
    const originalWindowOpen = window.open;

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

    // ----------------------------------------------
    // location.assign / replace
    // ----------------------------------------------
    const originalAssign =
        Location.prototype.assign;

    const originalReplace =
        Location.prototype.replace;

    Location.prototype.assign = function(url) {
        try {
            if (
                typeof url === 'string' &&
                !isIgnored(url) &&
                !url.startsWith('/fetch?q=')
            ) {
                url = makeProxy(url);
            }
        } catch {}

        return originalAssign.call(this, url);
    };

    Location.prototype.replace = function(url) {
        try {
            if (
                typeof url === 'string' &&
                !isIgnored(url) &&
                !url.startsWith('/fetch?q=')
            ) {
                url = makeProxy(url);
            }
        } catch {}

        return originalReplace.call(this, url);
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
                .send('HTTP/HTTPS以外のURLは使用できません');
        }

        try {
            // ------------------------------------------
            // リクエストヘッダー
            // ------------------------------------------
            const upstreamHeaders = {
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

            // Cookie
            if (req.headers.cookie) {
                upstreamHeaders.Cookie =
                    req.headers.cookie;
            }

            // Content-Type
            if (req.headers['content-type']) {
                upstreamHeaders['Content-Type'] =
                    req.headers['content-type'];
            }

            // ------------------------------------------
            // リクエストボディ
            // ------------------------------------------
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

            // ------------------------------------------
            // 対象サイトへリクエスト
            // ------------------------------------------
            const response = await axios({
                method: req.method,
                url: targetUrl,
                headers: upstreamHeaders,
                data: requestData,
                responseType: 'arraybuffer',
                validateStatus: () => true,

                // リダイレクトを自前処理
                maxRedirects: 0,

                timeout: 20000
            });

            // ------------------------------------------
            // 共通ヘッダー
            // ------------------------------------------
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
            // Cookieを返す
            // ------------------------------------------
            if (response.headers['set-cookie']) {
                const cookies = rewriteSetCookie(
                    response.headers['set-cookie']
                );

                res.set(
                    'Set-Cookie',
                    cookies
                );
            }

            const contentType =
                response.headers['content-type'] ||
                '';

            // ------------------------------------------
            // HTML以外
            // ------------------------------------------
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

                // JS
                if (
                    contentType
                        .toLowerCase()
                        .includes('javascript')
                ) {
                    res.set(
                        'Content-Type',
                        contentType
                    );

                    return res.send(
                        response.data
                    );
                }

                // 画像・フォント・その他
                res.set(
                    'Content-Type',
                    contentType
                );

                return res.send(
                    response.data
                );
            }

            // ------------------------------------------
            // HTML
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

            // 元サイトのbaseタグは、
            // ブラウザ上でURL解決を狂わせるので削除
            $('base').remove();

            // SRIを削除
            $('[integrity]').removeAttr(
                'integrity'
            );

            // CSP metaを削除
            $('meta[http-equiv]').each(
                (_, el) => {
                    const value =
                        ($(el).attr(
                            'http-equiv'
                        ) || '')
                            .toLowerCase();

                    if (
                        value ===
                        'content-security-policy'
                    ) {
                        $(el).remove();
                    }
                }
            );

            // ------------------------------------------
            // 通常URL属性
            // ------------------------------------------
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

            // ------------------------------------------
            // srcset
            // ------------------------------------------
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

            // ------------------------------------------
            // imagesrcset
            // ------------------------------------------
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

            // ------------------------------------------
            // style属性
            // ------------------------------------------
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

            // ------------------------------------------
            // HTML内styleタグ
            // ------------------------------------------
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

            // ------------------------------------------
            // JS通信インターセプター
            // ------------------------------------------
            injectProxyScript(
                $,
                targetUrl
            );

            // ------------------------------------------
            // HTMLレスポンス
            // ------------------------------------------
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
// サーバー起動
// --------------------------------------------------
app.listen(PORT, () => {
    console.log(
        `Server is running on port ${PORT}`
    );
});