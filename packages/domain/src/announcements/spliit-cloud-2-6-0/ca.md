---
id: spliit-cloud-2-6-0
date: 2026-10-08
title: Spliit Cloud ja funciona sense connexió — ajuda'ns a provar-ho
inApp: true
email: true
---

Spliit Cloud 2.6.0 porta la lectura sense connexió a l'app: els teus grups es poden llegir sense connexió. És la base de la lectura sense connexió — l'escriptura completa sense connexió, inclosa la creació de despeses, arribarà quan aquesta fase sigui sòlida. Trobaràs més detalls a les notes de la [v2.6.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.6.0).

## El que pots fer sense connexió

- Obre els teus grups i consulta l'historial complet de despeses amb comentaris, saldos, la llista de participants, assignacions de subgrups, repartiments predefinits, pressupostos, la configuració del grup i l'activitat recent.
- Les llistes s'obren a l'instant des de la còpia del dispositiu i incorporen els canvis nous al moment en tornar a connectar-te, així que les connexions lentes també se senten molt més ràpides.
- Instal·la Spliit Cloud com una app al teu dispositiu amb la nova guia pas a pas.

## El que encara necessita connexió

Crear o editar despeses, fitxers i activitat antiga més enllà de la finestra descarregada encara necessiten connexió, i els saldos avisen quan estan desactualitzats. Si alguna cosa no quadra després de tornar a connectar-te, una actualització recupera l'estat més recent.

## Ajuda'ns a polir els detalls

El mode sense connexió és nou i necessita proves reals abans que arribi l'escriptura sense connexió, i el client ha rebut una gran refactorització per fer-ho possible — així que també poden aparèixer errors en el mode en línia. Si notes res estrany, tant sense connexió com amb connexió — una llista que no carrega, un control que queda desactivat després de tornar a connectar-te o un saldo desactualitzat que no s'actualitza — [informa'n](https://github.com/antonio-ivanovski/spliit-cloud/issues/new?template=bug_report.yml) amb el que feies, si estaves sense connexió en aquell moment i què esperaves. Una tranquil·litat: no ha canviat res en com es calculen les despeses al servidor — els saldos, els repartiments i les liquidacions es calculen exactament igual. Cada informe ajuda a trobar els errors que queden.
