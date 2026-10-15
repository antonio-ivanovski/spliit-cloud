---
id: spliit-cloud-2-7-0
date: 2026-10-12
title: Skanowanie paragonów jest 5× szybsze — i czyta już PDF-y
channels: [updates, modal, email]
---

Spliit Cloud 2.7.0 przebudowuje skanowanie paragonów od podstaw: skany działają około 5× szybciej, kategorie są sprytniejsze, a paragony nie muszą już być zdjęciami. Szczegóły znajdziesz w informacjach o wydaniu [v2.7.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.7.0).

## Szybsze skany

Paragony przechodzą teraz przez dedykowany krok wyodrębniania tekstu, zanim jakiekolwiek AI na nie spojrzy, więc szybki model zajmuje się strukturyzacją zamiast wolnego czytania zdjęcia. W naszych testach paragon z 10 pozycjami skrócił się z około 80 sekund do około 14, a mniejsze paragony regularnie kończą w około 6 sekund. Kategoryzacja przeszła na szybki model decyzyjny z pełną historią Twoich wydatków w tle, więc sugestie powinny trafiać lepiej.

## Więcej niż zdjęcia

Możesz teraz skanować faktury PDF — cyfrowe są czytane bezpośrednio, sfotografowane przełączają się automatycznie na tryb zapasowy — plus pliki TXT, CSV, DOCX i ODT. Ilości pozycji obsługują też ułamki, więc ważona pozycja jak 1,5 kg trafia dokładnie tak, jak wydrukowano, zamiast zostać zaokrąglona.

## Gdy suma się nie zgadza, decydujesz Ty

Gdy zeskanowane pozycje nie sumują się do kwoty z paragonu, podgląd pyta teraz, która kwota jest poprawna, zamiast zgadywać. Małe różnice z zaokrągleń oferują pozycję „Zaokrąglenie” z wstępnie wybraną kwotą z paragonu; większe różnice ostrzegają i oferują osobną pozycję „Inne”, a wszystko możesz zawsze poprawić w formularzu edycji.

## Daj nam znać, co źle odczytano

Ten nowy proces obsługuje już każde skanowanie w Spliit Cloud, więc Twoje paragony są prawdziwym zestawem testowym. Jeśli skan źle odczyta pozycję, wybierze złą kategorię albo poda dziwną sumę, [zgłoś to](https://github.com/antonio-ivanovski/spliit-cloud/issues/new?template=bug_report.yml), dołączając paragon, jeśli możesz go udostępnić.
