---
id: spliit-cloud-2-6-0
date: 2026-10-08
title: Spliit už funguje offline — pomozte to otestovat
inApp: true
email: true
---

Spliit 2.6.0 přináší do aplikace čtení offline: vaše skupiny zůstanou čitelné i bez připojení. Je to základ čtení offline — úplný offline zápis včetně vytváření výdajů bude následovat, jakmile bude tato fáze stabilní. Podrobnosti najdete v poznámkách k verzi [v2.6.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.6.0).

## Co můžete dělat offline

- Otevírejte své skupiny a procházejte celou historii výdajů s komentáři, zůstatky, seznamem členů, přiřazením podskupin, předvolbami dělení, rozpočty, nastavením skupiny a nedávnou aktivitou.
- Seznamy se otevírají okamžitě z kopie v zařízení a po opětovném připojení do nich zapadnou nové změny, takže i pomalé připojení působí mnohem rychleji.
- Nainstalujte si Spliit jako aplikaci do zařízení s novým návodem krok za krokem.

## Co stále potřebuje připojení

Vytváření a úprava výdajů, souborů a starší aktivity mimo stažené období stále vyžadují připojení a u neaktuálních zůstatků se zobrazuje upozornění. Pokud po opětovném připojení něco vypadá špatně, obnovení načte nejnovější stav.

## Pomozte vychytat mouchy

Režim offline je nový a potřebuje reálné testování, než dorazí offline zápis, a klient prošel rozsáhlou přestavbou, aby to bylo možné — chyby se tak mohou objevit i v online režimu. Pokud si všimnete něčeho zvláštního, online i offline — seznamu, který se nenačte, ovládacího prvku, který po připojení zůstane vypnutý, nebo zastaralého zůstatku, který nezmizí — [nahlaste to](https://github.com/antonio-ivanovski/spliit-cloud/issues/new?template=bug_report.yml) s popisem, co jste dělali, zda jste byli zrovna offline a co jste očekávali. Pro uklidnění v jedné věci: na způsobu výpočtu výdajů na serveru se nic nezměnilo — zůstatky, podíly ani vyrovnání se počítají přesně jako dřív. Každé hlášení pomůže dotáhnout zbývající chyby.
