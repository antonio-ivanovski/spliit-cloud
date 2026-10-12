---
id: spliit-cloud-2-7-0
date: 2026-10-12
title: Belegscan ist 5× schneller — und liest jetzt PDFs
inApp: true
email: true
---

Spliit Cloud 2.7.0 überarbeitet den Belegscan von Grund auf: Scans laufen etwa 5× schneller, Kategorien werden treffsicherer, und Belege müssen keine Fotos mehr sein. Details stehen in den [v2.7.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.7.0) Hinweisen.

## Schnellere Scans

Belege durchlaufen jetzt einen eigenen Texterkennungs-Schritt, bevor eine KI sie sieht, sodass ein schnelles Modell die Strukturierung übernimmt, statt dass ein langsames das Foto liest. In unseren Läufen sank ein Beleg mit 10 Artikeln von rund 80 Sekunden auf etwa 14, und kleinere Belege sind regelmäßig in rund 6 Sekunden fertig. Die Kategorisierung läuft jetzt über ein schnelles Entscheidungsmodell mit deiner kompletten Ausgabenhistorie im Rücken, sodass die Vorschläge besser passen sollten.

## Mehr als Fotos

Du kannst jetzt PDF-Rechnungen scannen — digitale werden direkt gelesen, fotografierte fallen automatisch zurück — plus TXT-, CSV-, DOCX- und ODT-Dateien. Artikelmengen unterstützen auch Bruchteile, sodass eine gewogene Zeile wie 1,5 kg genau so ankommt, wie sie gedruckt ist, statt weggerundet zu werden.

## Du entscheidest, wenn die Summe nicht stimmt

Wenn gescannte Artikel nicht zur Belegsumme passen, fragt dich die Vorschau jetzt, welche Summe stimmt, statt zu raten. Kleine Rundungsdifferenzen bieten eine „Rundung“-Zeile mit vorausgewählter Belegsumme; größere Differenzen warnen dich und bieten eine eigene „Sonstiges“-Zeile, und im Bearbeitungsformular kannst du alles jederzeit korrigieren.

## Sag uns, was falsch erkannt wird

Diese neue Pipeline übernimmt bereits jeden Scan auf Spliit Cloud, also sind deine Belege die echte Testreihe. Wenn ein Scan einen Artikel falsch liest, eine falsche Kategorie wählt oder dir eine komische Summe liefert, [melde es bitte](https://github.com/antonio-ivanovski/spliit-cloud/issues/new?template=bug_report.yml) mit dem Beleg, falls du ihn teilen kannst.
