const express = require('express');
const axios = require('axios');
const path = require('path');
const cheerio = require('cheerio');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

/*
=========================================================
  診断用設定
=========================================================
*/

const DEBUG = true;

function makeRequestId() {
    return crypto.randomBytes(3).toString('hex');
}

function log(id, message, value = '') {
    if (!DEBUG) return;

    if (value !== '') {
        console.log(`[${id}] ${message}`, value);
    } else {
        console.log(`[${id}] ${message}`);
    }
}

/*
=========================================================
  トップページ
=========================================================
*/

app.get('/', (req, res) => {
    const id = makeRequestId();

    log(id, '==============================');
    log(id, '[ROOT REQUEST]');
    log(id, 'Method:', req.method);
    log(id, 'User-Agent:', req.headers['user-agent'] || '(none)');
    log(id, 'Referer:', req.headers.referer || '(none)');
    log(id, 'Origin:', req.headers.origin || '(none)');
    log(id, '==============================');

    res.sendFile(path.join(__dirname, 'index.html'));
});

/*
=========================================================
  ヘルスチェック
=========================================================
*/

app.get('/health', (req, res) => {
    res.json({
        ok: true,
        service: 'proxy',
        time: new Date().toISOString()
    });
});

/*
=========================================================
  プロキシ
=========================================================
*/

app.use('/fetch', async (req, res) => {

    const id = makeRequestId();

    log(id, '========================================');
    log(id, '[PROXY REQUEST]');
    log(id, 'Time:', new Date().toISOString());
    log(id, 'Method:', req.method);
    log(id, 'Path:', req.originalUrl);
    log(id, 'Referer:', req.headers.referer || '(none)');
    log(id, 'Origin:', req.headers.origin || '(none)');
    log(id, 'User-Agent:', req.headers['user-agent'] || '(none)');
    log(id, 'Accept:', req.headers.accept || '(none)');

    let encodedUrl = req.query.q;

    if (!encodedUrl) {
        log(id, '[ERROR] q parameter is missing');
        return res.status(400).send('URLが指定されていません');
    }

    /*
    =====================================================
      Base64 URL デコード
    =====================================================
    */

    let targetUrl;

    try {
        targetUrl = Buffer
            .from(encodedUrl, 'base64')
            .toString('utf8');

        log(id, '[DECODED TARGET]', targetUrl);

    } catch (e) {

        log(id, '[ERROR] Base64 decode failed');
        log(id, e.message);

        return res.status(400).send('無効なURLです');
    }

    /*
    =====================================================
      URL確認
    =====================================================
    */

    if (
        !targetUrl.startsWith('http://') &&
        !targetUrl.startsWith('https://')
    ) {
        targetUrl = 'https://' + targetUrl;
    }

    let parsedTarget;

    try {

        parsedTarget = new URL(targetUrl);

        log(id, '[TARGET HOST]', parsedTarget.hostname);
        log(id, '[TARGET PATH]', parsedTarget.pathname);
        log(id, '[TARGET QUERY]', parsedTarget.search || '(none)');

    } catch (e) {

        log(id, '[ERROR] Invalid target URL');
        log(id, e.message);

        return res.status(400).send('無効なURLです');
    }

    /*
    =====================================================
      上流サイトへリクエスト
    =====================================================
    */

    try {

        log(id, '[UPSTREAM REQUEST]');
        log(id, 'Method:', req.method);
        log(id, 'URL:', targetUrl);

        const response = await axios({
            method: req.method,
            url: targetUrl,

            headers: {
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
                    'AppleWebKit/537.36 (KHTML, like Gecko) ' +
                    'Chrome/120.0.0.0 Safari/537.36',

                'Referer': parsedTarget.origin,

                'Accept':
                    req.headers['accept'] || '*/*',

                'Accept-Language':
                    'ja,en-US;q=0.9,en;q=0.8'
            },

            responseType: 'arraybuffer',

            /*
             * リダイレクトを自動追跡しない。
             * 診断のため、Location を確認できるようにする。
             */
            maxRedirects: 0,

            validateStatus: () => true,

            timeout: 15000
        });

        /*
        =====================================================
          上流レスポンス診断
        =====================================================
        */

        log(id, '[UPSTREAM RESPONSE]', response.status);

        log(
            id,
            '[UPSTREAM CONTENT-TYPE]',
            response.headers['content-type'] || '(none)'
        );

        log(
            id,
            '[UPSTREAM LOCATION]',
            response.headers.location || '(none)'
        );

        log(
            id,
            '[UPSTREAM CONTENT-LENGTH]',
            response.headers['content-length'] || '(unknown)'
        );

        /*
        =====================================================
          リダイレクト診断
        =====================================================
        */

        if (
            response.status >= 300 &&
            response.status < 400
        ) {

            const location =
                response.headers.location || '(none)';

            log(id, '!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
            log(id, '[UPSTREAM REDIRECT]');
            log(id, 'Status:', response.status);
            log(id, 'FROM:', targetUrl);
            log(id, 'LOCATION:', location);
            log(id, '!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
        }

        res.set(
            'Access-Control-Allow-Origin',
            '*'
        );

        /*
        =====================================================
          HTML以外
        =====================================================
        */

        const contentType =
            response.headers['content-type'] || '';

        if (!contentType.includes('text/html')) {

            log(id, '[NON HTML RESPONSE]');
            log(id, 'Content-Type:', contentType);

            res.set(
                'Content-Type',
                contentType || 'application/octet-stream'
            );

            return res.send(response.data);
        }

        /*
        =====================================================
          HTML解析
        =====================================================
        */

        let html =
            response.data.toString('utf8');

        log(
            id,
            '[HTML SIZE]',
            `${html.length} bytes`
        );

        const $ = cheerio.load(html);

        /*
        =====================================================
          FORM 診断
        =====================================================
        */

        let formCount = 0;

        $('form').each((_, el) => {

            formCount++;

            const action =
                $(el).attr('action') || '(なし)';

            const method =
                $(el).attr('method') || 'GET';

            const idAttr =
                $(el).attr('id') || '(なし)';

            const nameAttr =
                $(el).attr('name') || '(なし)';

            log(id, '[FORM FOUND]');
            log(id, 'ID:', idAttr);
            log(id, 'Name:', nameAttr);
            log(id, 'Method:', method);
            log(id, 'Action:', action);
        });

        log(id, '[FORM COUNT]', formCount);

        /*
        =====================================================
          URL書き換え関数
        =====================================================
        */

        const rewriteUrl = (originalUrl) => {

            if (
                !originalUrl ||
                originalUrl.startsWith('data:') ||
                originalUrl.startsWith('javascript:') ||
                originalUrl.startsWith('#') ||
                originalUrl.startsWith('mailto:') ||
                originalUrl.startsWith('tel:')
            ) {
                return originalUrl;
            }

            try {

                const absoluteUrl =
                    new URL(
                        originalUrl,
                        targetUrl
                    ).toString();

                const encoded =
                    Buffer
                        .from(absoluteUrl)
                        .toString('base64');

                return `/fetch?q=${encoded}`;

            } catch (e) {

                log(
                    id,
                    '[URL REWRITE ERROR]',
                    originalUrl
                );

                return originalUrl;
            }
        };

        /*
        =====================================================
          通常属性
        =====================================================
        */

        const basicAttrs = [
            'href',
            'src',
            'data-src',
            'data-original',
            'data-lazy-src',
            'poster',
            'action'
        ];

        basicAttrs.forEach(attr => {

            let count = 0;

            $(`[${attr}]`).each((_, el) => {

                const val =
                    $(el).attr(attr);

                if (!val) return;

                const rewritten =
                    rewriteUrl(val);

                if (rewritten !== val) {
                    count++;
                    $(el).attr(
                        attr,
                        rewritten
                    );
                }
            });

            log(
                id,
                `[REWRITE ${attr}]`,
                `${count}件`
            );
        });

        /*
        =====================================================
          srcset
        =====================================================
        */

        let srcsetCount = 0;

        $('[srcset]').each((_, el) => {

            const srcsetVal =
                $(el).attr('srcset');

            if (!srcsetVal) return;

            const newSrcset =
                srcsetVal
                    .split(',')
                    .map(part => {

                        const trimmed =
                            part.trim()
                                .split(/\s+/);

                        if (trimmed[0]) {
                            trimmed[0] =
                                rewriteUrl(
                                    trimmed[0]
                                );
                        }

                        return trimmed.join(' ');
                    })
                    .join(', ');

            $(el).attr(
                'srcset',
                newSrcset
            );

            srcsetCount++;
        });

        log(
            id,
            '[REWRITE SRCSET]',
            `${srcsetCount}件`
        );

        /*
        =====================================================
          HTML内の script 診断
        =====================================================
        */

        let scriptCount = 0;
        let suspiciousScriptCount = 0;

        $('script').each((_, el) => {

            scriptCount++;

            const src =
                $(el).attr('src');

            const scriptText =
                $(el).html() || '';

            if (
                scriptText.includes('location') ||
                scriptText.includes('window.location') ||
                scriptText.includes('location.href') ||
                scriptText.includes('fetch(') ||
                scriptText.includes('XMLHttpRequest') ||
                scriptText.includes('form.submit')
            ) {

                suspiciousScriptCount++;

                log(
                    id,
                    '[SCRIPT NAVIGATION/API DETECTED]'
                );

                if (src) {
                    log(
                        id,
                        'Script src:',
                        src
                    );
                } else {
                    log(
                        id,
                        'Inline script detected'
                    );
                }
            }
        });

        log(
            id,
            '[SCRIPT COUNT]',
            scriptCount
        );

        log(
            id,
            '[SCRIPT NAVIGATION/API COUNT]',
            suspiciousScriptCount
        );

        /*
        =====================================================
          書き換え後のフォームを再診断
        =====================================================
        */

        let rewrittenFormCount = 0;

        $('form').each((_, el) => {

            const action =
                $(el).attr('action');

            if (action) {
                rewrittenFormCount++;

                log(
                    id,
                    '[FORM AFTER REWRITE]',
                    action
                );
            }
        });

        log(
            id,
            '[FORM AFTER REWRITE COUNT]',
            rewrittenFormCount
        );

        /*
        =====================================================
          最終HTML
        =====================================================
        */

        const outputHtml = $.html();

        log(
            id,
            '[FINAL HTML SIZE]',
            `${outputHtml.length} bytes`
        );

        log(id, '[PROXY COMPLETE]');
        log(id, '========================================');

        res.set(
            'Content-Type',
            'text/html; charset=utf-8'
        );

        return res.send(outputHtml);

    } catch (err) {

        console.error(
            `[${id}] [PROXY ERROR]`,
            err
        );

        log(
            id,
            '[ERROR MESSAGE]',
            err.message
        );

        if (err.response) {

            log(
                id,
                '[ERROR STATUS]',
                err.response.status
            );

            log(
                id,
                '[ERROR LOCATION]',
                err.response.headers?.location ||
                '(none)'
            );
        }

        return res
            .status(500)
            .send(
                'プロキシエラーが発生しました: ' +
                err.message
            );
    }
});

/*
=========================================================
  OPTIONS
=========================================================
*/

app.options('*', (req, res) => {

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
});

/*
=========================================================
  サーバー起動
=========================================================
*/

app.listen(PORT, () => {

    console.log('');
    console.log('========================================');
    console.log(' Proxy Server Started');
    console.log('========================================');
    console.log(`Port: ${PORT}`);
    console.log(`Debug: ${DEBUG}`);
    console.log('========================================');
    console.log('');
});