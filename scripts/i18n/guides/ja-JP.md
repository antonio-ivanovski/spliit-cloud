# ja-JP translation guide

Apply `default.md` first, then these Japanese (Japan) rules.

- Use contemporary Japanese with a consistent polite UI register (`です`/`ます` when a sentence needs a predicate); concise noun labels are fine.
- Avoid gendered, overly casual, or archaic language. Do not mix polite and plain endings within one related flow.
- Use natural Japanese particles, counters, and word order. Japanese often omits subjects; do not add pronouns merely because English has one.
- Use Japanese punctuation such as `。`, `、`, and `？`; normally do not insert spaces between Japanese words, but keep readable spacing around Latin placeholders and codes.
- Preserve the exact meaning of counts and money, and do not put a placeholder inside a word unless Japanese grammar requires it.
- Exclusive settlement term: 精算. Never 立替, 払い戻し, or 返金 for this concept.

### Terminology anchors

- Settlement family is always 精算 (e.g. `未精算の残高` for unsettled balances, `精算支出` for settlement expenses). Never 決済 (payment gateway) or 清算 for this concept. All 8 unsettled/settlement keys must use `精算` consistently.
- `Homepage.description` uses `共有費用を追跡して精算しましょう` (not `共有費用在追跡`).
- Currency conversion: `Groups.Import.CurrencyConversion.fixedDescription` must describe a single exchange rate per currency pair fetched from Frankfurter for the selected date, with optional custom rate — never the inverted “精度は劣りますが…ゼロになります” narrative.
- Item labels: `ExpenseCard.items.title` is `品目` (not the untranslated `Items`).
- Import step label: `Groups.Import.StepHeader.currencyConversion` is `通貨換算` (not the untranslated `Currency conversion`).
- Currency converter labels: `CurrencyConverter.fromLabel` is `変換元` and `toLabel` is `変換先` (not untranslated `From`/`To`); pattern `via {currencies}` is `{currencies} 経由`.
- Brand labels stay as-is: `Spliit Cloud` (never `Spliit Cloudインポート` in source pickers). Income placeholder `給与や返金` is repayment, not settlement, and is the only allowed `返金`.
