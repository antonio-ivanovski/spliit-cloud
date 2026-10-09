---
id: spliit-cloud-2-6-0
date: 2026-10-08
title: Spliit Cloud ora funziona offline — aiutaci a testarlo
inApp: true
email: true
---

Spliit Cloud 2.6.0 porta la lettura offline nell'app: i tuoi gruppi restano leggibili senza connessione. È la base della lettura offline — la scrittura offline completa, inclusa la creazione di spese, arriverà quando questa fase sarà solida. I dettagli sono nelle note della [v2.6.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.6.0).

## Cosa puoi fare offline

- Apri i tuoi gruppi e sfoglia la cronologia completa delle spese con commenti, saldi, l'elenco dei membri, le assegnazioni dei sottogruppi, le suddivisioni predefinite, i budget, le impostazioni del gruppo e l'attività recente.
- Gli elenchi si aprono subito dalla copia sul dispositivo e integrano le novità al momento della riconnessione, così anche le connessioni lente risultano molto più veloci.
- Installa Spliit Cloud come app sul tuo dispositivo con la nuova guida passo passo.

## Cosa richiede ancora una connessione

Creare o modificare spese, file e attività meno recenti oltre la finestra scaricata richiedono ancora una connessione, e i saldi avvisano quando non sono aggiornati. Se qualcosa non torna dopo la riconnessione, un aggiornamento recupera lo stato più recente.

## Aiutaci a sistemare gli ultimi difetti

La modalità offline è nuova e ha bisogno di test reali prima dell'arrivo della scrittura offline, e il client ha ricevuto un'importante ristrutturazione per renderla possibile — quindi i bug potrebbero comparire anche nella modalità online. Se noti qualcosa di strano, offline oppure online — un elenco che non si carica, un controllo che resta disabilitato dopo la riconnessione, o un saldo non aggiornato che non si risolve mai — [segnalalo](https://github.com/antonio-ivanovski/spliit-cloud/issues/new?template=bug_report.yml) indicando cosa stavi facendo, se eri offline in quel momento e cosa ti aspettavi. Per tranquillizzarti su un punto: nulla è cambiato nel modo in cui le spese vengono calcolate sul server — saldi, suddivisioni e liquidazioni vengono calcolati esattamente come prima. Ogni segnalazione aiuta a risolvere i bug rimanenti.
