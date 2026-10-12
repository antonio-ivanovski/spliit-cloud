---
id: spliit-cloud-2-7-0
date: 2026-10-12
title: Kuittiskannaus on 5× nopeampi — ja lukee nyt PDF:t
inApp: true
email: true
---

Spliit Cloud 2.7.0 uudistaa kuittiskannauksen kokonaan: skannaukset ovat noin 5× nopeampia, kategoriat osuvat paremmin, eikä kuittien tarvitse enää olla valokuvia. Lisätiedot [v2.7.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.7.0) -julkaisutiedoissa.

## Nopeammat skannaukset

Kuitit kulkevat nyt erillisen tekstinpoimintavaiheen läpi ennen kuin tekoäly koskee niihin, joten nopea malli hoitaa jäsentämisen sen sijaan että hidas malli lukisi valokuvaa. Testeissämme 10 nimikkeen kuitti nopeutui noin 80 sekunnista noin 14 sekuntiin, ja pienemmät kuitit valmistuvat säännöllisesti noin 6 sekunnissa. Kategorisointi siirtyi nopeaan päätösmalliin, jonka tukena on koko kuluhistoriasi, joten ehdotusten pitäisi osua paremmin.

## Enemmän kuin valokuvia

Voit nyt skannata PDF-laskuja — digitaaliset luetaan suoraan, kuvatut tunnistetaan automaattisesti varavaihtoehdolla — sekä TXT-, CSV-, DOCX- ja ODT-tiedostoja. Nimikemäärät tukevat myös murtolukuja, joten punnittu rivi kuten 1,5 kg saapuu täsmälleen painetussa muodossa pyöristymisen sijaan.

## Sinä päätät, kun summa ei täsmää

Kun skannatut nimikkeet eivät summaudu kuitin loppusummaan, esikatselu kysyy nyt kumpi summa on oikein arvaamisen sijaan. Pieniin pyöristyseroihin tarjotaan ”Pyöristys”-rivi kuitin loppusumma esivalittuna; suuremmat erot varoittavat ja tarjoavat erillisen ”Muu”-rivin, ja voit aina korjata asiat muokkauslomakkeessa.

## Kerro mikä lukee väärin

Tämä uusi prosessi hoitaa jo kaikki skannaukset Spliit Cloudissa, joten kuittisi ovat todellinen testisarja. Jos skannaus lukee nimikkeen väärin, valitsee väärän kategorian tai antaa oudon summan, [ilmoita siitä](https://github.com/antonio-ivanovski/spliit-cloud/issues/new?template=bug_report.yml) liittämällä kuitti mukaan jos voit jakaa sen.
