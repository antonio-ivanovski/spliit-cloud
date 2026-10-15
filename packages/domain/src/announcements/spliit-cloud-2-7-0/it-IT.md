---
id: spliit-cloud-2-7-0
date: 2026-10-12
title: La scansione degli scontrini è 5 volte più veloce — e ora legge i PDF
channels: [updates, modal, email]
---

Spliit Cloud 2.7.0 rinnova la scansione degli scontrini da cima a fondo: le scansioni sono circa 5 volte più veloci, le categorie risultano più azzeccate e gli scontrini non devono più essere foto. I dettagli sono nelle note della [v2.7.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.7.0).

## Scansioni più veloci

Gli scontrini ora passano da un passaggio dedicato di estrazione del testo prima che qualsiasi IA li esamini, così un modello veloce fa il lavoro di strutturazione invece di uno lento che legge la foto. Nelle nostre prove, uno scontrino da 10 voci è passato da circa 80 secondi a circa 14, e gli scontrini più piccoli finiscono di solito in circa 6 secondi. La categorizzazione è passata a un modello decisionale veloce con dietro tutta la tua cronologia delle spese, quindi i suggerimenti dovrebbero risultare più azzeccati.

## Più che foto

Ora puoi scansionare fatture PDF — quelle digitali vengono lette direttamente, quelle fotografate passano automaticamente all'alternativa — oltre a file TXT, CSV, DOCX e ODT. Le quantità delle voci supportano anche le frazioni, così una riga pesata come 1.5 kg arriva esattamente come stampata invece di essere arrotondata.

## Decidi tu quando il totale non torna

Quando le voci scansionate non corrispondono al totale dello scontrino, l'anteprima ora chiede quale totale è corretto invece di indovinare. Piccole differenze di arrotondamento offrono una riga «Arrotondamento» con il totale dello scontrino preselezionato; differenze maggiori ti avvisano e offrono una riga esplicita «Altro», e puoi sempre correggere tutto nel modulo di modifica.

## Dicci cosa legge male

Questo nuovo processo gestisce già tutte le scansioni su Spliit Cloud, quindi i tuoi scontrini sono il vero banco di prova. Se una scansione legge male una voce, sceglie una categoria sbagliata o ti dà un totale strano, [segnalalo](https://github.com/antonio-ivanovski/spliit-cloud/issues/new?template=bug_report.yml) con lo scontrino se puoi condividerlo.
