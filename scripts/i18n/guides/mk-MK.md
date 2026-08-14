# mk-MK translation guide

Apply `default.md` first, then these Macedonian rules.

- Use standard Macedonian in Cyrillic, with a friendly neutral UI voice. Do not substitute Serbian or Bulgarian vocabulary or orthography.
- Preserve Macedonian diacritics and definite-article behavior, and use natural case/preposition patterns rather than English word order.
- Match grammatical gender and number; rephrase when a short label can stay neutral without sounding forced.
- Fill the locale's CLDR plural categories with complete natural Macedonian phrases and keep `{count}` in each required form.
- Keep terminology stable for members, groups, expenses, shares, balances, and settlements. Brand label `Spliit Cloud` stays as-is in the import source picker (never `Spliit Cloud увоз`).
- Exclusive settlement term: _порамнување_ (noun) and _порамни_ (verb). Never _надомест_ or _рефундација_ for this concept. Unsettled balances are `непорамнети салда` (never `нерешени салда` which means unresolved); itemized split is `По ставки` (`Уделот на секој учесник се пресметува од поединечните ставки на трошокот.`). Fixed-rate import uses a single exchange rate per currency pair from Frankfurter. `Homepage.description` settle is `порамнете се`, not `пресметувајте се` (calculation).
