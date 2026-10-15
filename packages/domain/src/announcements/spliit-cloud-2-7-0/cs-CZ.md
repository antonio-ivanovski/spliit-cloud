---
id: spliit-cloud-2-7-0
date: 2026-10-12
title: Skenování účtenek je 5× rychlejší — a nově čte i PDF
channels: [updates, modal, email]
---

Spliit Cloud 2.7.0 přepracovává skenování účtenek od základu: skeny běží asi 5× rychleji, kategorie vycházejí chytřeji a účtenky už nemusejí být fotky. Podrobnosti najdete v poznámkách k verzi [v2.7.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.7.0).

## Rychlejší skeny

Účtenky nyní procházejí vyhrazeným krokem extrakce textu, než se na ně podívá jakákoli AI, takže strukturování dělá rychlý model místo pomalého čtení fotky. V našich měřeních klesla účtenka s 10 položkami z přibližně 80 sekund na asi 14 a menší účtenky běžně končí kolem 6 sekund. Kategorizace přešla na rychlý rozhodovací model s celou vaší historií výdajů v zádech, takže návrhy by měly vycházet lépe.

## Víc než fotky

Nyní můžete skenovat PDF faktury — digitální se čtou přímo, vyfocené se automaticky přepnou na záložní zpracování — a k tomu soubory TXT, CSV, DOCX a ODT. Množství položek podporují i zlomky, takže vážená položka jako 1,5 kg dorazí přesně tak, jak je vytištěná, místo aby se zaokrouhlila.

## Když součet nesedí, rozhodujete vy

Když naskenované položky nesedí na celkovou částku účtenky, náhled se nově zeptá, která částka je správně, místo aby hádal. Malé rozdíly ze zaokrouhlení nabídnou řádek „Zaokrouhlení“ s předvybranou celkovou částkou účtenky; větší rozdíly varují a nabídnou explicitní řádek „Jiné“ a vše můžete vždy opravit v editačním formuláři.

## Dejte nám vědět, co se přečte špatně

Tento nový postup už obsluhuje každé skenování ve Spliit Cloud, takže vaše účtenky jsou tou pravou testovací sadou. Pokud sken přečte špatně položku, zvolí špatnou kategorii nebo nabídne podivný součet, [nahlaste to](https://github.com/antonio-ivanovski/spliit-cloud/issues/new?template=bug_report.yml) a pokud můžete, přiložte účtenku.
