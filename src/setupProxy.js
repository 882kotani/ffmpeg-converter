// 開発サーバー(ポート3000)専用。本番(ポート10000の build 配信)では使われません。
// package.json の "proxy" 設定は、ダウンロードのようなブラウザのページ遷移リクエスト
// (Accept: text/html) を中継せず index.html を返してしまうため、/api は常に中継します。
const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function setupProxy(app) {
  app.use(
    '/api',
    createProxyMiddleware({
      target: 'http://localhost:10000',
      changeOrigin: true,
    })
  );
};
