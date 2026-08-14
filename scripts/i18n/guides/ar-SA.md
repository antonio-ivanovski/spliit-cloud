# ar-SA translation guide

Apply `default.md` first, then these Arabic (Saudi Arabia) rules.

- Write neutral Modern Standard Arabic suitable for users throughout Saudi Arabia; avoid colloquial Saudi expressions in core UI.
- Treat the interface as RTL. Keep Arabic word order natural while preserving placeholder names, tag nesting, and readable bidirectional text.
- Use Arabic punctuation where natural (`؟`, `،`, `؛`) and do not introduce awkward Latin spacing around Arabic text. Use ellipsis `…` (U+2026), never `...`.
- Prefer gender-neutral constructions. When gender is unavoidable, follow the grammatical gender of the noun rather than inventing English-style gender-neutral forms.
- Respect Arabic plural categories and agreement; do not translate every plural as a singular plus a number. Translate full sentences; do not truncate long descriptions to a short summary.
- Keep app terminology consistent: members, groups, expenses, shares, balances, and settlements should use one established Arabic term each. Brand is `Spliit Cloud` (never `استيراد Spliit Cloud` in source pickers). Itemized split is `حسب البنود` (`يُحتسب نصيب كل مشارك من البنود الفردية للمصروف.`). Balance chooser is `اختر طريقة عرض الأرصدة`; keeping each expense in its currency is `احتفظ بكل مصروف بالعملة التي أُدخل بها.`. Fixed-rate import uses a single exchange rate per currency pair from Frankfurter plus custom rate (never "أقل دقة/صافي صفر").
- Exclusive settlement term: _تسوية_ (noun) and _سوّى_ (verb). Never _تعويض_ or _استرداد_ for this concept. Income placeholder `راتب أو استرداد` is repayment (refund of salary/deposit), not a settlement — the only allowed _استرداد_. When settling, prefer `سوِّ`/`تسوية` forms; avoid debt-only phrasing where settlement is meant.
