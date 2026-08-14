# bn-BD translation guide

Apply `default.md` first, then these Bangla (Bangladesh) rules.

- Use standard Bangla as used in Bangladesh, with a polite, approachable UI voice; avoid Hindi-specific vocabulary and colloquial internet spellings.
- Write in Bengali script with correct vowel signs and punctuation. Keep Latin brand names, URLs, and placeholders unchanged. Brand source `Spliit Cloud` stays as-is (never `Spliit Cloud আমদানি` in source pickers).
- Prefer neutral phrasing that does not force a person's gender. Use respectful forms consistently rather than switching between familiar and formal address.
- Bangla often expresses plurality through context; still fill every CLDR plural key with a natural sentence and keep `{count}` where required. Aliasing `_other` to missing `_zero`/`_two`/`_few`/`_many` is acceptable when Bangla only distinguishes one/other.
- Use Bangladesh-appropriate terms for groups, members, expenses, and money, while preserving the exact numeric meaning supplied by the app. Itemized split is `আইটেম অনুযায়ী` (`খরচের পৃথক আইটেম থেকে প্রতিটি অংশগ্রহণকারীর ভাগ গণনা করুন।`).
- Exclusive settlement term: _নিষ্পত্তি_ (noun and verb). Never _রিফান্ড_ or _ক্ষতিপূরণ_ for this concept.
