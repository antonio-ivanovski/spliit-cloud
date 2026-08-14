# ko translation guide

Apply `default.md` first, then these Korean rules.

- Use standard South Korean Korean with one consistent polite UI register. Do not mix banmal with polite endings, and avoid honorifics that imply a person hierarchy the English does not have.
- Prefer concise labels and natural Korean word order; subjects and pronouns may be omitted when context is clear.
- Preserve spacing, Hangul spelling, particles, and native counters. Add a counter only when Korean requires it for a natural count.
- Use Korean punctuation and avoid unnecessary English capitalization or loanwords when an ordinary Korean term exists. For example, `백스페이스`/`Backspace` is not kept as loanword — use `지우기` for the calculator delete key. Import step label `통화 변환`, currency labels `기준 통화`/`대상 통화`, and section title `항목` must be natural Korean.
- Keep placeholders and tags outside grammatical endings unless attaching them is the only natural construction.
- Keep every required plural category natural for the locale. Korean distinguishes only `other` grammatically; alias `zero`/`one`/`two`/`few`/`many` to the `other` form to satisfy coverage (e.g. `항목별`, `통화 변환` families, balance/settlement notes).
- Exact amounts, percentages and placeholder names must stay intact; describe exchange-rate modes precisely. Itemized split is `항목별` (`지출의 개별 항목을 기준으로 참여자별 부담액을 계산해요.`). Fixed-rate import uses a single exchange rate per currency pair from Frankfurter (not "정확도는 떨어지지만/0으로 유지"). Brand is `Spliit Cloud` (never `Spliit Cloud 가져오기` in source pickers).
- Exclusive settlement term: 정산. Never 환급 or 환불 for this concept.
