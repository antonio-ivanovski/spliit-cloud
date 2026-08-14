# zh-TW translation guide

Apply `default.md` first, then these Traditional Chinese (Taiwan) rules.

- Use contemporary Taiwan Mandarin in Traditional Chinese with a neutral, concise, polite UI voice.
- Use Taiwan terminology and characters; do not copy Mainland Simplified Chinese wording or character forms.
- Chinese normally has no spaces between CJK words. Keep readable spaces around Latin placeholders, URLs, and codes when needed.
- Use Traditional Chinese punctuation such as `。`, `，`, `：`, and `？`, and preserve Taiwan quotation conventions where appropriate.
- Add natural classifiers for counts and express plurality through context or wording rather than English-style noun suffixes.
- Small UI labels `From`/`To` for currency conversion are `來源貨幣`/`目標貨幣`, not raw English. Line-item `Items` is `項目` (card title uses `項目`, not English `Items`); add-item is `新增項目`, not `添加項目`.
- Source picker brand label is plain `Spliit Cloud` (never `Spliit Cloud 匯入`). Related importer titles keep a space before `Spliit Cloud` (`此檔案應使用 Spliit Cloud 匯入器`, `開啟 Spliit Cloud 匯入器`).
- Fixed-rate import must describe a single exchange rate per currency pair fetched from Frankfurter (custom rate allowed), not "精確度較低但保證餘額為零". Canonical: `對此貨幣組合的所有支出使用單一匯率。預設從 Frankfurter 取得所選日期的匯率；亦可輸入自訂匯率。`
- Exclusive settlement term: 結算. Never 報銷 or 退款 for this concept. Income placeholder `薪資或退款` uses `退款` as repayment (income) and is the only allowed `退款` occurrence. Saving state is `儲存中……` (ellipsis `……`), not `保存中……`.
