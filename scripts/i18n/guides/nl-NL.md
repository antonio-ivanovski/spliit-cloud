# nl-NL translation guide

Apply `default.md` first, then these Dutch (Netherlands) rules.

- Use standard Netherlands Dutch with an informal `je/jij` or impersonal UI voice. Avoid Flemish `gij` and Belgium-specific terms. The anonymous-account recovery flow keeps formal `u/uw` for trust/privacy tone (9 keys: `AnonymousAccount.*` and `Header.anonymousSignOutWarning`); do not normalize those to `je`.
- Keep compounds readable and concise; do not preserve English word boundaries when Dutch normally writes one compound.
- Use correct `de`/`het` agreement and natural Dutch word order. Dutch usually does not need gendered user language.
- Capitalize sentence starts and proper names normally; do not capitalize every UI label as in English.
- Preserve Dutch punctuation, accents, and exact amounts while keeping placeholders and tags intact. Itemized split is `Per artikel` (`Bereken het aandeel van elke deelnemer op basis van de afzonderlijke artikelen in de uitgave.`). Category `Games` is `Spelletjes`; line-item `Items`/`Item` is `Artikelen`/`Artikel`.
- Keep every required plural category natural for the locale. Dutch uses `one`/`other` but the bundle expects `zero`/`two`/`few`/`many` aliased to the `other` form to avoid coverage gaps (72 keys: `nSelected`, `more`, `memberCount`, `sourceParticipants`, `expenseCount`, `scopePickerMembers`, `participantsSummary`, `expenseCount`, `previewWillCreate`, `imported`, `targetExceedsCap`, `saveAll`, `saved`, `introDescription`, `introStepLook`, `introStepReview`, `leftUncategorized`, `attachments`).
- Exclusive settlement term: _verrekening_ (noun) and _verrekenen_ (verb). Never _terugbetaling_ or _vergoeding_. Prefer _verrekening_ over _vereffening_ when both appear — use only _verrekening_/_verrekenen_/_verrekend_ for settlement (never _vereffening_/_vereffenen_/_vereffend_). Income placeholder `Salaris of terugbetaling` is repayment, not settlement, and is the only allowed _terugbetaling_. Placeholder `Members.removeDialog.unsettled.description` uses a single `{name}` with a generic subject (`Deze persoon heeft …`), not `{name} … {name}`.
