const express = require('express');
const path = require('path');
const app = express();

// publicフォルダの場所を正確に指定
const publicPath = path.join(__dirname, '../public');
app.use(express.static(publicPath));

// どのURLにアクセスされても、必ずトップ画面(index.html)を返す（Not Found対策）
app.get('*', (req, res) => {
    res.sendFile(path.join(publicPath, 'index.html'));
});

const port = process.env.PORT || 10000;
app.listen(port, () => {
    console.log(`サーバーがポート ${port} で起動しました！`);
});
