const express = require('express');
const app = express();
const path = require('path');
const http = require('http');

// 画面ファイル（HTML）が入っている場所を、Renderに絶対的な場所として教える
const publicPath = path.join(__dirname, '../public');

app.use(express.static(publicPath));

// どんなURLが来ても、publicの中のindex.htmlを表示する（これでNot Foundを消す）
app.get('/*', (req, res) => {
    res.sendFile(path.join(publicPath, 'index.html'));
});

const port = process.env.PORT || 10000;
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
