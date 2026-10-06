---
id: spliit-cloud-2-5-0
date: 2026-10-05
title: Spliit Cloud 2.5.0 が登場しました
inApp: true
email: true
---

Spliit Cloud 2.5.0 をリリースしました。このバージョンの新機能と、見逃したかもしれない最近の機能をまとめてご紹介します。この形式では新機能と重要なお知らせのみをお届けし、日常的に出荷される小さなパッチや修正は含みません。

## アクティビティタブがパーソナルになりました

アクティビティタブが支出タイムラインと同じ表示になりました。「あなた向け / すべて」の切り替えで、自分に関係のないアクティビティをインラインの行にまとめます。各支出には、専用の「あなたの負担額:」の行にあなたの負担額が表示されます。詳しくは [v2.5.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.5.0)のリリースノートをご覧ください。

## アカウント削除も、48時間のセーフティネット付きで

アカウント設定に新しい危険ゾーンと専用の確認ページが追加されました。グループごとの影響を確認し、名前と残高の扱いを選んでから、削除 と入力して予約します。アカウントは48時間有効のままで、いつでもキャンセルできます。詳しくは [v2.5.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.5.0)のリリースノートをご覧ください。

## カテゴリ分類が大幅に高速化、グループツールからの一括整理も

支出のカテゴリ分類が、LLMによる約3秒からJev決定モデルによる約250ミリ秒に高速化され、不確かな推測はワンタップの提案チップとして表示されます。グループ全体を整理したいときは、グループツールから[一括カテゴリ分類](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.4.0)で提案を確認してまとめて保存できます。詳しくは [v2.4.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.4.0)と [v2.3.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.3.0)のリリースノートをご覧ください。

## ほぼすべての銀行・カードのCSVに対応したインポート

銀行の明細やカードの利用履歴をアップロードして、これまでの支出を持ち込めます。[汎用CSVインポーター](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.0.0)はライブプレビューで列をマッピングし、カテゴリを対応付けて、書き込む前に重複を検出します。

## ゲストを含むすべてのアカウントでパスキーに対応

パスワードの代わりに指紋、顔、セキュリティキーでサインインできます。パスキーはメール、ソーシャル、ゲストアカウントで利用でき、匿名アカウントではリカバリーリンクの代わりとしても使えます。[v2.3.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.3.0)のリリースノートをご覧ください。

## 部屋全体の招待を数秒で

部屋全体で使えるスキャン専用QRコードを1つ共有できます。有効期限は15分間で、参加者リストがリアルタイムに表示されます。ゲストはスマートフォンのカメラや「スキャンして参加」アクションからも参加できます。[v2.1.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.1.0)のリリースノートをご覧ください。

## 自分に関わるものが見える、落ち着いたアプリに

タイムラインでは、自分に関係のない支出やアクティビティをインラインの行にまとめ、「あなた向け / すべて」の切り替えで表示できます。グループのタブ順序を自分好みに並べ替えたり、使わないタブを非表示にしたり、支出の詳細で参加者ごとの内訳を確認したり、モバイルでは大きなスクロールホイールで時刻を選べます。[v2.1.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.1.0)と [v2.4.1](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.4.1)のリリースノートをご覧ください。

## データはいつでも持ち出せます

グループとアカウントの完全なZIPバックアップ(ラウンドトリップ対応)に加え、CSVや印刷用PDFレポートをエクスポートできます。インポートとエクスポートについて詳しくは [v2.0.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.0.0)のリリースノートをご覧ください。

## グループごとにひと目でわかる見た目に

絵文字とカラーでグループごとに独自の見た目を設定でき、カード、一覧、アンビエント背景に反映されます。[v2.2.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.2.0)のリリースノートをご覧ください。

## ビルダー向け:アウトバウンドWebhook

支出の作成、更新、削除を署名付きイベントとして独自のHTTPSエンドポイントに送信できます。再試行、配信履歴、再配信に対応しています。設定方法は [v2.2.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.2.0)のリリースノートをご覧ください。
