# オペ共有

院内向けの外科処置共有アプリ（オペ前の準備・時間記録・振り返り・掲示板・統計）。

- 画面：`index.html`（GitHub Pages で公開）
- データ保存：Google スプレッドシート ＋ Apps Script（`apps-script/Code.gs` はその控え）

## しくみ
- 画面は `https://moricotym-png.github.io/ope-share/#k=<Apps ScriptのデプロイID>` で開く。
  `#k=` の値は端末に保存され、2回目以降はURLだけで開ける。
- データと合言葉はスプレッドシート側にあり、このリポジトリには含まれない。
- 合言葉はスプレッドシートの「設定」シート B1。

## 更新
- 画面の変更：`index.html` を更新して `main` に push すれば数分で反映。
- `apps-script/Code.gs` を変えたときは、Apps Script に貼り付けて
  「デプロイを管理 → 新バージョン」でデプロイし直す（URLは変わらない）。

## ルール
- 患者さんはカルテ番号と年代・性別だけで記録する。氏名・イニシャルなどの個人情報を入れない。
- このリポジトリに患者データ、合言葉、Apps Script の URL を書かない。
