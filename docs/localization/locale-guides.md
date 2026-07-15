# Locale voice guides

These choices keep each catalog internally consistent. A fluent reviewer may change a choice, but must update this guide and the whole affected workflow together rather than mixing registers.

## Romance

### Catalan (`ca`)

Use central Catalan and informal singular **tu**, with concise imperatives. Prefer _participant_, _membre_, _pagat per_, _repartit entre_, _pagament de liquidació_, and contextual _despeses amb un amic/una amiga_. Avoid slash forms such as `membre(s)`; use plural keys.

### Spanish (`es`)

Use international Spanish and informal singular **tú**; avoid region-specific banking slang. Prefer _participante_, _miembro_, _pagado por_, _dividido entre_, _pago de liquidación_, and _gastos con un amigo/una amiga_. _Reembolso_ means a refund and is not the settlement term.

### Basque (`eu`)

Use standard Batua and neutral direct instructions, avoiding gendered friend wording where possible. Prefer _parte-hartzaile_, _kide_, _nork ordaindua_, _hauen artean banatuta_, _zor-kitapenaren ordainketa_, and contextual one-to-one expense wording. Have a native reviewer confirm case endings in interpolated sentences.

### French (`fr-FR`)

Use metropolitan French and consistent **vous**. Prefer _participant·e_ only where inclusive forms fit the UI; otherwise rewrite neutrally. Use _membre_, _payé par_, _réparti entre_, _paiement de règlement_, and _dépenses avec un proche_. Never use parenthetical plurals such as `sélectionné(s)`.

### Italian (`it-IT`)

Use standard Italian and informal singular **tu**. Prefer _partecipante_, _membro_, _pagato da_, _diviso tra_, _pagamento di saldo_, and _spese con un amico_. Avoid slash plurals such as `membro/i`.

### Portuguese (`pt`)

Use European Portuguese and informal singular **tu**, with European vocabulary and verb forms. Prefer _participante_, _membro_, _pago por_, _dividido entre_, _pagamento de acerto_, and _despesas com um amigo/uma amiga_.

### Brazilian Portuguese (`pt-BR`)

Use Brazilian Portuguese and **você**, not European second-person forms. Prefer _participante_, _membro_, _pago por_, _dividido entre_, _pagamento de acerto_, and _despesas com um amigo/uma amiga_.

### Romanian (`ro`)

Use standard Romanian and informal singular **tu**. Prefer _participant_, _membru_, _plătit de_, _împărțit între_, _plată de decontare_, and _cheltuieli cu un prieten/o prietenă_. Use plural keys instead of `membru/membri`.

## Germanic and Nordic

### German (`de-DE`)

Use standard German and consistent informal **du**; do not mix it with _Sie_. Prefer _Teilnehmende_ when space permits, _Mitglied_ for access, _bezahlt von_, _aufgeteilt auf_, _Ausgleichszahlung_, and _Ausgaben mit einer befreundeten Person_. Keep compounds readable rather than mirroring English word order.

### Dutch (`nl-NL`)

Use Netherlands Dutch and informal **je/jij**. Prefer _deelnemer_, _lid_, _betaald door_, _verdeeld over_, _vereffeningsbetaling_, and _uitgaven met een vriend(in)_ or a neutral rewrite. Never use `lid/leden` in displayed text.

### Finnish (`fi`)

Use standard Finnish, concise neutral imperatives, and avoid unnecessary pronouns. Prefer _osallistuja_, _jäsen_, _maksaja/maksanut_, _jaettu osallistujien kesken_, _tasausmaksu_, and contextual _yhteiset kulut ystävän kanssa_. Review noun cases after numeric placeholders.

## Slavic

### Czech (`cs-CZ`)

Use standard Czech with polite plural instructions consistently. Prefer _účastník_, _člen_, _zaplatil(a)_ or a neutral construction, _rozděleno mezi_, _vyrovnávací platba_, and _výdaje s přítelem/přítelkyní_. Check all Czech plural categories in full sentences.

### Macedonian (`mk-MK`)

Use standard Macedonian and consistent polite plural **вие**. Prefer _учесник_, _член_, _платено од_, _поделено меѓу_, _порамнителна уплата_, and contextual _трошоци со пријател/пријателка_. Do not translate “AI” inconsistently within one workflow.

### Polish (`pl-PL`)

Use standard Polish with neutral direct instructions and avoid unnecessary gendered past tense. Prefer _uczestnik_, _członek_, _zapłacone przez_, _podzielone między_, _płatność rozliczeniowa_, and _wydatki ze znajomą osobą_. Check one/few/many forms, especially values ending in 2–4 and 12–14.

### Russian (`ru-RU`)

Use standard Russian and polite **вы** consistently. Prefer _участник_, _член группы_, _оплачено_, _разделено между_, _платёж для погашения долга_, and _расходы с другом_. Avoid literal calques of “ledger” and verify one/few/many forms.

### Ukrainian (`uk-UA`)

Use standard Ukrainian and polite **ви** consistently; avoid Russian calques. Prefer _учасник_, _член групи_, _сплачено_, _розподілено між_, _платіж для погашення боргу_, and _витрати з другом/подругою_. Verify one/few/many forms and natural vocative/case usage around names.

## East Asian

### Japanese (`ja-JP`)

Use natural product Japanese in polite **です・ます** style, with concise labels. Prefer `参加者`, `メンバー`, `支払った人`, `分割対象`, `精算金`, and contextual `友人との支出`. Do not force English subjects or plural distinctions into Japanese.

### Korean (`ko`)

Use standard South Korean product language in consistent **해요체**. Prefer `참여자`, `멤버`, `결제한 사람`, `분할 대상`, `정산금`, and `친구와의 지출`. Use counters naturally and avoid transliterating “ledger.”

### Simplified Chinese (`zh-CN`)

Use concise Mainland Chinese product language and `你` only when needed. Prefer `参与者`, `成员`, `付款人`, `分摊给`, `结算付款`, and `与好友的共同支出`. Use Chinese punctuation and counters; do not add artificial plural wording.

### Traditional Chinese (`zh-TW`)

Use Taiwan Traditional Chinese vocabulary, not mechanically converted Simplified Chinese. Prefer `參與者`, `成員`, `付款人`, `分攤給`, `結算付款`, and `與好友的共同支出`. Use Taiwan punctuation and natural counters.

## Other

### Hebrew (`he`)

Use modern Israeli Hebrew and rewrite instructions to avoid gender where natural; do not alternate masculine and feminine forms randomly. Prefer `משתתף/ת` only in compact labels, `חבר/ת קבוצה` for access, `שולם על ידי`, `פוצל בין`, `תשלום להסדרת היתרה`, and contextual friend-expense wording. Review all text in RTL, especially interpolated names, amounts, currencies, emails, and URLs.

### Indonesian (`id`)

Use standard Indonesian and consistent polite **Anda** where a pronoun is necessary. Prefer _peserta_, _anggota_, _dibayar oleh_, _dibagi antara_, _pembayaran pelunasan_, and _pengeluaran bersama teman_. Avoid English financial terms when an established Indonesian term is clear.

### Turkish (`tr-TR`)

Use standard Turkish and polite plural **siz** consistently. Prefer _katılımcı_, _üye_, _ödeyen_, _arasında bölüştürülen_, _borç kapatma ödemesi_, and _arkadaşla ortak harcamalar_. Check suffix harmony after interpolated values and do not translate sentence fragments in English order.
