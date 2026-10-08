---
id: spliit-cloud-2-6-0
date: 2026-10-08
title: Spliit funkar nu offline — hjälp till att testa
inApp: true
email: true
---

Spliit 2.6.0 ger läs-offline till appen: dina grupper går att läsa utan anslutning. Det här är grunden för läs-offline — full skriv-offline, inklusive att skapa utgifter, kommer när det här steget är stabilt. Detaljer finns i [v2.6.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.6.0) anteckningarna.

## Vad du kan göra offline

- Öppna dina grupper och bläddra i hela utgiftshistoriken med kommentarer, saldon, medlemslistan, undergruppstilldelningar, delningsförinställningar, budgetar, gruppinställningar och senaste aktivitet.
- Listor öppnas direkt från kopian på enheten och slår samman nya ändringar på plats när du återansluter, så långsamma anslutningar känns mycket snabbare också.
- Installera Spliit som en app på din enhet med den nya steg-för-steg-guiden.

## Vad som fortfarande behöver en anslutning

Att skapa eller redigera utgifter, filer och äldre aktivitet utanför det nedladdade fönstret behöver fortfarande en anslutning, och saldon varnar när de är inaktuella. Om något ser fel ut efter återanslutningen hämtar en uppdatering det senaste läget.

## Hjälp till att slipa bort skavankerna

Offlineläget är nytt och behöver testas i verkligheten innan skriv-offline släpps, och klienten har byggts om rejält för att göra det möjligt — så buggar kan dyka upp i onlineläget också. Om du märker något konstigt, offline eller online — en lista som inte laddas, en knapp som förblir inaktiverad efter återanslutning eller ett inaktuellt saldo som aldrig rensas — [rapportera det](https://github.com/antonio-ivanovski/spliit-cloud/issues/new?template=bug_report.yml) med vad du gjorde, om du var offline just då och vad du förväntade dig. En lugnande sak: inget har ändrats i hur utgifter beräknas på servern — saldon, delningar och regleringar beräknas exakt som förut. Varje rapport hjälper till att fånga de sista buggarna.
