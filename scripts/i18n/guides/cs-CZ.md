# cs-CZ translation guide

Apply `default.md` first, then these Czech (Czechia) rules.

- Use standard Czech with full diacritics and a friendly, consistent UI register. Do not drift into Slovak or Polish vocabulary.
- Keep grammatical case and gender agreement correct when labels combine names, counts, or actions.
- Czech plural forms depend on the number and the noun; write each required CLDR form as a natural Czech phrase, not a mechanical suffix change.
- Prefer concise infinitive/action labels and consistent terminology for members, groups, expenses, shares, and balances.
- Use Czech quotation marks and punctuation where appropriate, while leaving URLs, tags, and placeholders untouched. Itemized split is `Podle položek` (`Podíl každého účastníka se vypočítá z jednotlivých položek výdaje.`). Fixed-rate import uses a single exchange rate per currency pair from Frankfurter (not "Méně přesné/na nule"). `Balances.currencyDisplay.originalNote` must use `nevyrovnané`/`vyrovnat` for settlement, never `nesplacené`/`vypořádání`.
- Exclusive settlement term: _vyrovnání_ (noun) and _vyrovnat_ (verb). Never _refundace_ or _náhrada_ for this concept.
