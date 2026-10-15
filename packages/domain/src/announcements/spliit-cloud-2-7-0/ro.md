---
id: spliit-cloud-2-7-0
date: 2026-10-12
title: Scanarea bonurilor e de 5 ori mai rapidă — și citește acum PDF-uri
channels: [updates, modal, email]
---

Spliit Cloud 2.7.0 reface scanarea bonurilor din temelii: scanările sunt de circa 5 ori mai rapide, categoriile ies mai bine alese, iar bonurile nu mai trebuie să fie fotografii. Detaliile sunt în notele [v2.7.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.7.0).

## Scanări mai rapide

Bonurile trec acum printr-un pas dedicat de extragere a textului înainte să se uite vreo inteligență artificială la ele, așa că un model rapid face structurarea în locul unuia lent care citește fotografia. În testele noastre, un bon cu 10 articole a scăzut de la circa 80 de secunde la circa 14, iar bonurile mai mici se termină de obicei în circa 6 secunde. Categorizarea a trecut la un model rapid de decizie cu tot istoricul tău de cheltuieli în spate, așa că sugestiile ar trebui să fie mai bune.

## Mai mult decât fotografii

Acum poți scana facturi PDF — cele digitale se citesc direct, cele fotografiate trec automat la alternativa — plus fișiere TXT, CSV, DOCX și ODT. Cantitățile articolelor acceptă și fracții, așa că o linie cântărită precum 1.5 kg ajunge exact cum e tipărită, fără să fie rotunjită.

## Tu decizi când totalul nu iese

Când articolele scanate nu adună totalul bonului, previzualizarea te întreabă acum care total e corect în loc să ghicească. Diferențele mici de rotunjire oferă o linie „Rotunjire" cu totalul bonului preselectat; diferențele mai mari te avertizează și oferă o linie explicită „Altele", iar tu poți corecta oricând lucrurile în formularul de editare.

## Spune-ne ce citește greșit

Acest proces nou gestionează deja toate scanările din Spliit Cloud, așa că bonurile tale sunt adevărata suită de teste. Dacă o scanare citește greșit un articol, alege o categorie greșită sau îți dă un total ciudat, te rugăm s-o [raportezi](https://github.com/antonio-ivanovski/spliit-cloud/issues/new?template=bug_report.yml) împreună cu bonul, dacă îl poți partaja.
