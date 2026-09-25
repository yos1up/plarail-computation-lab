# plarail-computation-lab

プラレールを計算機として見做す研究リポジトリ。

- 計算モデルの定義: [`docs/concept.md`](docs/concept.md)
- インタラクティブレイアウトシミュレータ: [`docs/index.html`](docs/index.html)（GitHub Pages で静的ホスト）

## シミュレータ

HTML/JS のみ（ビルド不要・外部依存なし）。スマホ・PC 両対応。

- 使えるパーツ: R-01 直線 / R-02 1/2直線 / R-03 曲線 / R-08 ストップ / R-11 ターンアウト / R-11(ポイント固定) / R-12 8の字ポイント / R-20 1/4直線（凸凹・凸凸・凹凹）
- 端点をタップしてパーツをつなぐ方式。位置・向き・凸凹が **厳密に一致したときだけ** 接続される（整数座標で判定）
- 列車1編成を配置し ▶ で自動走行。ストップレールで停止した時点の出力ポイントを読む
- ポイントに役割（入力/出力/補助）を付けると、☰ → 真理値表 で全入力を自動評価
- 2 つの端点を厳密に結ぶレール列の自動経路探索
- 重なり（物理的に置けない配置）・接続不可（凸凸など）の警告
- 保存: 自動保存（ブラウザ内）、JSON 書き出し/読み込み、共有 URL

### GitHub Pages で公開

Settings → Pages → Build and deployment → Source: *Deploy from a branch*、Branch: `main` / フォルダ `/docs` を選択。

### ローカルで動かす

```sh
npm run serve        # http://localhost:8000/ （ES modules のため file:// では動かない）
npm test             # コア（幾何・シミュレーション・経路探索）のテスト
npm run examples     # docs/examples/examples.json を再生成
```

### ファイル構成

| パス | 内容 |
|---|---|
| `docs/js/core.js` | 厳密幾何、パーツ定義、配置候補、接続判定、重なり検出 |
| `docs/js/sim.js` | 走行シミュレーション（アニメーション用・離散判定用）、真理値表 |
| `docs/js/route.js` | 端点間の自動経路探索（両側 BFS の突き合わせ） |
| `docs/js/app.js` | UI（Canvas 描画、タッチ/マウス操作、パネル、保存・共有） |
| `tools/` | Node 用テスト・サンプル生成スクリプト |
