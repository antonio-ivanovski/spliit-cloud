---
id: spliit-cloud-2-6-0
date: 2026-10-08
title: Spliit toimii nyt offline — auta testaamaan
inApp: true
email: true
---

Spliit 2.6.0 tuo sovellukseen offline-luvun: ryhmäsi pysyvät luettavina ilman yhteyttä. Tämä on offline-luvun perusta — täysi offline-kirjoitus, mukaan lukien kulujen luominen, seuraa kun tämä vaihe on vakaa. Lisätiedot [v2.6.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.6.0) -julkaisutiedoissa.

## Mitä voit tehdä offline

- Avaa ryhmäsi ja selaa täyttä kuluhistoriaa kommenteilla, saldoilla, jäsenluettelolla, alaryhmäjaoilla, jakoesiasetuksilla, budjeteilla, ryhmäasetuksilla ja viimeaikaisella toiminnalla.
- Listat avautuvat välittömästi laitteen kopiosta ja yhdistävät uudet muutokset paikoilleen kun yhdistät uudelleen, joten hitaatkin yhteydet tuntuvat paljon nopeammilta.
- Asenna Spliit sovelluksena laitteellesi uusien vaiheittaisten ohjeiden avulla.

## Mikä tarvitsee edelleen yhteyden

Kulujen tai tiedostojen luominen tai muokkaaminen sekä ladatun ikkunan ulkopuolinen vanhempi toiminta tarvitsevat edelleen yhteyden, ja saldot varoittavat kun ne ovat vanhentuneita. Jos jokin näyttää oudolta uudelleenyhdistämisen jälkeen, päivitys hakee uusimman tilan.

## Auta hiomaan kulmat

Offline-tila on uusi ja tarvitsee käytännön testausta ennen offline-kirjoituksen julkaisua, ja sovellus on käynyt läpi ison uudistuksen sen mahdollistamiseksi — joten bugeja voi näkyä myös online-tilassa. Jos huomaat jotain outoa, offline- tai online-tilassa — lista joka ei lataudu, painike joka jää pois käytöstä uudelleenyhdistämisen jälkeen tai vanhentunut saldo joka ei koskaan päivity — [ilmoita siitä](https://github.com/antonio-ivanovski/spliit-cloud/issues/new?template=bug_report.yml) kertomalla mitä olit tekemässä, olitko tuolloin offline-tilassa ja mitä odotit tapahtuvan. Yksi rauhoittava asia: kulujen laskennassa palvelimella ei ole muuttunut mikään — saldot, jaot ja tasaukset lasketaan täsmälleen kuten ennen. Jokainen ilmoitus auttaa nappaamaan loput bugit.
