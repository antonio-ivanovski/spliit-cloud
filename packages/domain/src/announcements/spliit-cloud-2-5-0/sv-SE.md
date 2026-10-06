---
id: spliit-cloud-2-5-0
date: 2026-10-05
title: Spliit Cloud 2.5.0 är här
inApp: true
email: true
---

Spliit Cloud 2.5.0 är ute. Här är nyheterna i den här versionen, följt av en sammanfattning av nya funktioner du kanske har missat. På det här sättet delar vi bara nya funktioner och viktiga meddelanden — inte de små patchar och fixar som släpps hela tiden.

## Aktivitetsfliken är nu personlig

Aktivitetsfliken speglar nu utgiftstidslinjen: med växlaren För dig / Alla döljer du aktivitet som inte rör dig bakom inline-rader, och varje utgift visar din andel på en egen rad Din andel:. Detaljer finns i [v2.5.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.5.0) anteckningarna.

## Ta bort kontot, med 48 timmars skyddsnät

I kontoinställningarna finns en ny riskzon med en egen granskningssida: se konsekvenserna per grupp, välj hur ditt namn och kvarvarande saldon hanteras och skriv RADERA för att schemalägga. Ditt konto är aktivt i 48 timmar och du kan avbryta när som helst. Detaljer finns i [v2.5.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.5.0) anteckningarna.

## Mycket snabbare kategorisering, plus massrensning från gruppverktyg

Utgifter kategoriseras nu på cirka 250 ms med Jev-beslutsmodellen i stället för cirka 3 s med LLM:en, och osäkra förslag visas som förslag du väljer med ett tryck. När en hel grupp behöver städas granskar [masskategorisering](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.4.0) förslag och sparar dem tillsammans från gruppverktyg. Detaljer finns i [v2.4.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.4.0) och [v2.3.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.3.0) anteckningarna.

## Importera från nästan vilken bank- eller kort-CSV som helst

Ta med dina tidigare utgifter genom att ladda upp ett kontoutdrag eller en kortexport. Den [generiska CSV-importen](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.0.0) mappar kolumner med liveförhandsvisning, mappar kategorier och flaggar dubbletter innan något sparas.

## Passkeys för alla konton, även gäster

Logga in med fingeravtryck, ansikte eller säkerhetsnyckel i stället för lösenord. Passkeys fungerar för e-post-, sociala och gästkonton och passar bra med anonyma konton som ersättning för återställningslänken. Se [v2.3.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.3.0) anteckningarna.

## Bjud in ett helt rum på sekunder

Dela en QR-kod bara att skanna som hela rummet kan använda, giltig i 15 minuter med en livelista över vilka som anslutit. Gäster kan också ansluta från mobilkameran eller åtgärden Skanna för att ansluta. Se [v2.1.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.1.0) anteckningarna.

## En lugnare app som visar det som är ditt

Tidslinjer döljer nu utgifter och aktivitet som inte rör dig bakom inline-rader, med en växlare För dig / Alla. Du kan också ställa in din egen ordning på gruppflikar och dölja flikar du inte använder, se specificerade belopp per person i utgiftsdetaljer och välja tider på mobilen med stora scrollhjul. Se [v2.1.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.1.0) och [v2.4.1](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.4.1) anteckningarna.

## Ta med dig dina data

Exportera en fullständig ZIP-backup av grupper och konton, plus CSV- och utskrivbara PDF-rapporter. Import och export beskrivs i [v2.0.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.0.0) anteckningarna.

## Gör varje grupp igenkännbar

Ge varje grupp sitt eget utseende med emoji och färg, synligt på kort, lister och stämningsbakgrunder. Se [v2.2.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.2.0) anteckningarna.

## För utvecklare: utgående webhooks

Skicka skapade, uppdaterade och borttagna utgifter till din egen HTTPS-slutpunkt som signerade händelser med nya försök, leveranshistorik och omleverans. Installationen finns i [v2.2.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.2.0) anteckningarna.
