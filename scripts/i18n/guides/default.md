# Translation baseline

Apply this baseline together with the guide for every locale you own.

- Translate for a real Spliit user, not word-for-word from English. Keep labels short, friendly, clear, and consistent with nearby translations.
- Preserve every rich-text tag, its nesting, and its semantic emphasis.
- Runtime interpolation uses exactly one pair of braces: `{name}` and `{count}`. Never emit `{{name}}`, `{{count}}`, or change a placeholder name. If English contains doubled braces, normalize the translated value to single braces and report the source issue.
- Preserve placeholder meaning and placement. Keep `{count}` in every plural form and keep placeholders inside the same rich-text context as English.
- Preserve numbers, dates, currency codes, percentage meanings, URLs, product names, and user-provided names. Do not localize a value by changing its amount.
- Follow the locale guide for punctuation, spacing, script, formality, gender, cases, counters, and plural forms. Do not import vocabulary from a neighboring language just because it looks similar.
- Use `bun i18n usages <key> --json` when the English text is ambiguous, and use neighboring translations only as terminology references—not as text to copy blindly.
- Translate accessibility labels and error messages explicitly and unambiguously. Do not add jokes, slang, or ambiguity to destructive, security, money, or validation messages.
- Keep every required plural category natural for the locale. Do not collapse categories or copy the English sentence into every form.
- Never use English as a placeholder translation. Preserve brands and technical tokens only when the baseline or locale guide says they are proper names.
