# he translation guide

Apply `default.md` first, then these Hebrew rules.

- Use contemporary Israeli Hebrew in a neutral, clear register; avoid slang unless the surrounding bundle explicitly calls for it.
- Treat the interface as RTL and use Hebrew punctuation (`?` is commonly used in Hebrew UI, but keep punctuation placement natural). Preserve bidi readability around Latin placeholders and numbers.
- Hebrew requires gender and number agreement. Prefer concise neutral constructions; when agreement is unavoidable, match the grammatical subject rather than guessing a user's gender.
- Respect Hebrew plural forms and noun patterns instead of adding an English-style plural suffix.
- Keep terminology distinct from Arabic and avoid literal English word order where Hebrew syntax would be clearer. Brand is `Spliit Cloud` (never `ייבוא Spliit Cloud` in source pickers). `Balances` section title is `יתרות` (never `מאזנים`). Line-item `Items` is `פריטים` (never untranslated `Items`). Fixed-rate import uses a single exchange rate per currency pair from Frankfurter (not "פחות מדויק/מאוזנת").
- Exclusive settlement term: _הסדרה_ (noun) and _להסדיר_ (verb). Never _החזר_ for this concept. Use only `הסדר`/`הסדרים`/`מוסדר`/`מוסדרת`/`הסדרת` for settlement (never `סליקות`/`סילוק` — those mean payment clearing).
