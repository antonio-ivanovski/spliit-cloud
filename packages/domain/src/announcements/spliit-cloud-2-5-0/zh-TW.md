---
id: spliit-cloud-2-5-0
date: 2026-10-05
title: Spliit Cloud 2.5.0 來了
inApp: true
email: true
---

Spliit Cloud 2.5.0 已經發布。以下介紹本版本的新功能，並回顧您可能錯過的近期功能。今後我們只會透過這種方式分享新功能與重要公告，不包含日常發布的小型修補程式與修正。

## 動態分頁現在只顯示與您相關的內容

動態分頁現在與支出時間軸保持一致：透過「只看與我相關 / 全部」切換，將與您無關的動態收合到內嵌列中，每筆支出都會在專屬的「我的分攤：」列顯示您的分攤金額。詳情請參閱 [v2.5.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.5.0) 版本說明。

## 刪除帳號，附 48 小時安全期

帳號設定新增危險區與專屬確認頁面：查看每個群組的相應影響，選擇名稱與剩餘餘額的處理方式，然後輸入 刪除 即可排程刪除。您的帳號在 48 小時內維持有效，您可以隨時取消。詳情請參閱 [v2.5.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.5.0) 版本說明。

## 分類更快，還可從群組工具批次整理

支出分類改用 Jev 決策模型後僅需約 250 毫秒，先前使用 LLM 約需 3 秒，不確定的推測會顯示為一鍵套用的建議按鈕。如果整個群組需要整理，可在群組工具中使用[批次分類](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.4.0)統一檢視建議並儲存。詳情請參閱 [v2.4.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.4.0) 與 [v2.3.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.3.0) 版本說明。

## 從幾乎任何銀行或卡片 CSV 匯入

上傳銀行對帳單或卡片匯出檔，把既有支出帶過來。[通用 CSV 匯入器](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.0.0)提供即時預覽來對應欄位、對應分類，並在寫入前標示重複項目。

## 所有帳號皆支援通行密鑰，包含訪客

使用指紋、臉部或安全金鑰取代密碼登入。通行密鑰適用於電子郵件、社群與訪客帳號，與匿名帳號搭配使用，可取代復原連結。詳情請參閱 [v2.3.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.3.0) 版本說明。

## 幾秒鐘邀請全場加入

分享一個僅供掃描的 QR Code，全場都可以使用，有效期限為 15 分鐘，並即時顯示已加入名單。訪客也可以用手機相機掃描，或使用「掃描加入」操作加入。詳情請參閱 [v2.1.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.1.0) 版本說明。

## 更簡潔的 App，只顯示與您相關的內容

時間軸現在會將與您無關的支出與動態收合到內嵌列中，並提供「只看與我相關 / 全部」切換。您還可以自訂群組分頁順序並隱藏不用的分頁，在支出詳細中查看依人列出的明細，在手機上使用大型滾輪選擇時間。詳情請參閱 [v2.1.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.1.0) 與 [v2.4.1](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.4.1) 版本說明。

## 帶走您的資料

匯出群組與帳號的完整 ZIP 往返備份，以及 CSV 與可列印的 PDF 報告。匯入與匯出的說明請參閱 [v2.0.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.0.0) 版本說明。

## 讓每個群組都獨具特色

為每個群組設定表情符號與色彩，在卡片、列表與情境背景中呈現。詳情請參閱 [v2.2.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.2.0) 版本說明。

## 面向開發者：傳出 Webhook

將支出的建立、更新與刪除做為簽章事件推送至您自己的 HTTPS 端點，支援重試、傳遞記錄與重新傳遞。設定方式請參閱 [v2.2.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.2.0) 版本說明。
