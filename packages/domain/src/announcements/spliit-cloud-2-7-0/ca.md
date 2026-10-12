---
id: spliit-cloud-2-7-0
date: 2026-10-12
title: Escanejar rebuts és 5 vegades més ràpid — i ja llegeix PDF
inApp: true
email: true
---

Spliit Cloud 2.7.0 renova l'escaneig de rebuts de dalt a baix: els escanejos són unes 5 vegades més ràpids, les categories surten més encertades i els rebuts ja no han de ser fotos. Trobareu més detalls a les notes de la [v2.7.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.7.0).

## Escanejos més ràpids

Els rebuts ara passen per un pas dedicat d'extracció de text abans que cap IA els miri, així un model ràpid fa l'estructuració en lloc d'un de lent llegint la foto. En les nostres proves, un rebut de 10 articles ha passat d'uns 80 segons a uns 14, i els rebuts més petits solen acabar en uns 6 segons. La categorització ha passat a un model ràpid de decisió amb tot el teu historial de despeses al darrere, així que els suggeriments haurien de ser més encertats.

## Més que fotos

Ara pots escanejar factures en PDF — les digitals es llegeixen directament, les fotografiades passen automàticament a l'alternativa — a més de fitxers TXT, CSV, DOCX i ODT. Les quantitats dels articles també accepten fraccions, així una línia pesada com 1.5 kg arriba exactament com està impresa en lloc d'arrodonir-se.

## Tu decideixes quan el total no quadra

Quan els articles escanejats no sumen el total del rebut, la vista prèvia ara et demana quin total és correcte en lloc d'endevinar-lo. Les petites diferències d'arrodoniment ofereixen una línia «Arrodoniment» amb el total del rebut preseleccionat; les diferències més grans t'avisen i ofereixen una línia explícita «Altres», i sempre pots corregir-ho al formulari d'edició.

## Explica'ns què llegeix malament

Aquest nou procés ja gestiona tots els escanejos a Spliit Cloud, així que els teus rebuts són la prova de foc real. Si un escaneig llegeix malament un article, tria una categoria equivocada o et dona un total estrany, [informa'n](https://github.com/antonio-ivanovski/spliit-cloud/issues/new?template=bug_report.yml) amb el rebut si el pots compartir.
