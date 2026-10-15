---
id: spliit-cloud-2-7-0
date: 2026-10-12
title: Bonnetjes scannen is 5× sneller — en leest nu ook pdf's
channels: [updates, modal, email]
---

Spliit Cloud 2.7.0 vernieuwt het scannen van bonnetjes van boven tot onder: scans zijn ongeveer 5× sneller, categorieën vallen slimmer uit, en bonnetjes hoeven geen foto's meer te zijn. Details staan in de [v2.7.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.7.0) notities.

## Snellere scans

Bonnetjes gaan nu eerst door een eigen tekstextractiestap voordat een AI ernaar kijkt, zodat een snel model het structureren doet in plaats van een traag model dat de foto leest. In onze tests ging een bonnetje met 10 artikelen van ongeveer 80 seconden naar zo'n 14, en kleinere bonnetjes zijn regelmatig in ongeveer 6 seconden klaar. Categorisering draait nu op een snel beslismodel met je volledige uitgavengeschiedenis erachter, dus suggesties zouden beter moeten uitkomen.

## Meer dan foto's

Je kunt nu pdf-facturen scannen — digitale worden direct gelezen, gefotografeerde vallen automatisch terug — plus TXT-, CSV-, DOCX- en ODT-bestanden. Aantallen bij artikelen ondersteunen ook breuken, dus een gewogen regel zoals 1,5 kg komt precies zo binnen als afgedrukt, in plaats van te worden weggerond.

## Jij beslist als het totaal niet klopt

Wanneer gescande artikelen niet optellen tot het bonnetjestotaal, vraagt de voorvertoning nu welk totaal klopt in plaats van te gokken. Kleine afrondingsverschillen krijgen een regel ”Afronding” met het bonnetjestotaal voorgeselecteerd; grotere verschillen waarschuwen je en bieden een aparte regel ”Overig”, en in het bewerkformulier kun je alles altijd corrigeren.

## Vertel ons wat er misgaat

Deze nieuwe pipeline verwerkt al elke scan op Spliit Cloud, dus jouw bonnetjes zijn de echte testsuite. Als een scan een artikel verkeerd leest, een verkeerde categorie kiest of je een vreemd totaal geeft, [meld het dan](https://github.com/antonio-ivanovski/spliit-cloud/issues/new?template=bug_report.yml) met het bonnetje als je dat kunt delen.
