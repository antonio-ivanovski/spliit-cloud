# zh-CN translation guide

Apply `default.md` first, then these Simplified Chinese (Mainland China) rules.

- Use contemporary Mainland Mandarin in Simplified Chinese with a neutral, concise, polite UI voice.
- Use Mainland terminology and characters; do not import Taiwan/Hong Kong vocabulary or Traditional characters.
- Chinese normally has no spaces between CJK words. Keep readable spaces around Latin placeholders, URLs, and codes when needed.
- Use Chinese punctuation such as `。`, `，`, `：`, and `？`; do not copy English comma/colon spacing mechanically.
- Add the correct measure word or classifier when a count requires one, and handle plural keys as natural Chinese rather than suffixing nouns.
- Small UI labels `From`/`To` for currency conversion are `源货币`/`目标货币`, not raw English. Line-item `Items` is `项目`.
- Source picker brand label is plain `Spliit Cloud` (never `Spliit Cloud导入`). Related importer titles keep a space before `Spliit Cloud` (`此文件应使用 Spliit Cloud 导入器`, `打开 Spliit Cloud 导入器`).
- Fixed-rate import must describe a single exchange rate per currency pair fetched from Frankfurter (custom rate allowed), not "精度较低但保证余额为零". Canonical: `对该货币对下的所有支出使用单一汇率。默认从 Frankfurter 获取所选日期的汇率；也可输入自定义汇率。`
- Exclusive settlement term: 结算. Never 报销 or 退款 for this concept. Income placeholder `工资或退款` uses `退款` as repayment (income) and is the only allowed `退款` occurrence.
