# Spliit localization guide

English (`apps/web/src/messages/en-US.json`) defines product meaning; it is not a sentence template to translate word for word. Review the component using a key before translating it, preserve placeholders and rich-text tags exactly, and prefer language people use in expense-sharing and banking apps.

## Product terms

| English concept    | Meaning in Spliit                                                           | Translation rule                                                                                                         |
| ------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| participant        | A person represented in an expense, with or without app access              | Do not translate as “member” merely because the person belongs to a group.                                               |
| member             | A person with access to a group                                             | Reserve the local membership term for access, roles, invitations, and administration.                                    |
| payer / Paid by    | The person who supplied the money                                           | Use the ordinary local term for paying, not “owner” or “buyer.”                                                          |
| Split between      | The people whose shares make up an expense                                  | Translate as allocation/sharing, not who paid.                                                                           |
| settlement         | A payment that clears who owes whom; not spending and not a merchant refund | Use one exclusive local noun and verb (settle / settle up). Never use reimbursement, refund, or expense-report cognates. |
| settlement payment | The default title of a recorded settlement expense                          | Same exclusive settlement term as above; do not introduce a second synonym.                                              |
| friend expenses    | A one-to-one shared-expense space                                           | Translate contextually (“expenses with a friend”), never as an accounting book unless that is natural product language.  |

Keep Spliit Cloud, Spliit, GitHub, Splitwise, Settle Up, and Frankfurter as product names. Money amounts, email addresses, URLs, and formulas are not translated. Domain identifiers such as `paidFor` may remain in code. `isReimbursement` appears only as a legacy import alias.

## Voice and mechanics

- Use short, direct interface language. Avoid literal English idioms, unexplained technical terms, and unnecessary pronouns.
- Destructive actions must state what is lost, what remains, and whether the action can be undone.
- Preserve `{placeholders}` and tags such as `<strong>` exactly. Reorder them when the language requires it.
- Supply `_zero`, `_one`, `_two`, `_few`, `_many`, and `_other` for every plural family. Categories unused by a locale may repeat the natural fallback, but must remain grammatical.
- Check text in the actual screen at narrow and wide widths. For Hebrew, also check RTL flow and mixed-direction names, currencies, emails, and URLs.
- A locale remains provisional until a fluent reviewer has checked the full catalog in context. Financial settlement, invitations, account deletion, and member removal require an additional product review.

Use [locale-template.md](locale-template.md) for a review record and [locale-guides.md](locale-guides.md) for the agreed voice of each supported locale.
