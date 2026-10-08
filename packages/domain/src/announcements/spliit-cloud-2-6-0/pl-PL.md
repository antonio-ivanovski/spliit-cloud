---
id: spliit-cloud-2-6-0
date: 2026-10-08
title: Spliit działa już offline — pomóż to przetestować
inApp: true
email: true
---

Spliit 2.6.0 wprowadza do aplikacji odczyt offline: Twoje grupy pozostają czytelne bez połączenia. To fundament odczytu offline — pełny zapis offline, w tym tworzenie wydatków, pojawi się, gdy ten etap będzie solidny. Szczegóły znajdziesz w informacjach o wydaniu [v2.6.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.6.0).

## Co możesz robić offline

- Otwieraj swoje grupy i przeglądaj pełną historię wydatków z komentarzami, saldami, listą członków, przypisaniami podgrup, zapisanymi podziałami, budżetami, ustawieniami grupy i ostatnią aktywnością.
- Listy otwierają się natychmiast z kopii na urządzeniu i scalamy nowe zmiany na miejscu po ponownym połączeniu, więc wolne połączenia też wydają się znacznie szybsze.
- Zainstaluj Spliit jako aplikację na swoim urządzeniu dzięki nowemu przewodnikowi krok po kroku.

## Co nadal wymaga połączenia

Tworzenie lub edytowanie wydatków, plików oraz starszej aktywności spoza pobranego okna nadal wymaga połączenia, a salda ostrzegają, gdy są nieaktualne. Jeśli coś wygląda nie tak po ponownym połączeniu, odświeżenie pobiera najnowszy stan.

## Pomóż wygładzić niedoróbki

Tryb offline jest nowy i potrzebuje testów w realnym świecie, zanim pojawi się zapis offline, a klient przeszedł dużą przebudowę, żeby to było możliwe — błędy mogą więc pojawiać się także w trybie online. Jeśli zauważysz coś dziwnego, offline czy online — listę, która się nie ładuje, kontrolkę, która po ponownym połączeniu zostaje wyłączona, albo nieaktualne saldo, które nigdy nie znika — [zgłoś to](https://github.com/antonio-ivanovski/spliit-cloud/issues/new?template=bug_report.yml), opisując, co robiłeś, czy byłeś wtedy offline i czego się spodziewałeś. Dla uspokojenia w jednej kwestii: nic nie zmieniło się w sposobie obliczania wydatków na serwerze — salda, udziały i rozliczenia są liczone dokładnie tak jak wcześniej. Każde zgłoszenie pomaga wyłapać pozostałe błędy.
