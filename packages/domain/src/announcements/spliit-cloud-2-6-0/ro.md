---
id: spliit-cloud-2-6-0
date: 2026-10-08
title: Spliit Cloud funcționează acum offline — ajută-ne să-l testăm
inApp: true
email: true
---

Spliit Cloud 2.6.0 aduce citirea offline în aplicație: grupurile tale rămân lizibile fără conexiune. Este baza citirii offline — scrierea offline completă, inclusiv crearea cheltuielilor, va urma după ce această etapă este solidă. Detaliile sunt în notele [v2.6.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.6.0).

## Ce poți face offline

- Deschide-ți grupurile și răsfoiește istoricul complet al cheltuielilor cu comentarii, solduri, lista de membri, alocările de subgrupuri, împărțirile prestabilite, bugetele, setările grupului și activitatea recentă.
- Listele se deschid instant din copia de pe dispozitiv și integrează noutățile pe loc la reconectare, așa că și conexiunile lente par mult mai rapide.
- Instalează Spliit Cloud ca aplicație pe dispozitivul tău cu noul ghid pas cu pas.

## Ce mai are nevoie de conexiune

Crearea sau editarea cheltuielilor, fișierele și activitatea mai veche dincolo de fereastra descărcată au în continuare nevoie de conexiune, iar soldurile avertizează când sunt învechite. Dacă ceva pare în neregulă după reconectare, o reîmprospătare aduce cea mai recentă stare.

## Ajută-ne să netezim asperitățile

Modul offline este nou și are nevoie de testare reală înainte să apară scrierea offline, iar clientul a trecut printr-o refactorizare amplă pentru a-l face posibil — așa că erorile pot apărea și în modul online. Dacă observi ceva ciudat, offline sau online — o listă care nu se încarcă, un control care rămâne dezactivat după reconectare sau un sold învechit care nu se actualizează niciodată — te rugăm să-l [raportezi](https://github.com/antonio-ivanovski/spliit-cloud/issues/new?template=bug_report.yml) cu ce făceai, dacă erai offline în acel moment și la ce te așteptai să se întâmple. Un lucru e sigur: nimic nu s-a schimbat în modul în care cheltuielile sunt calculate pe server — soldurile, împărțirile și decontările se calculează exact ca înainte. Fiecare raportare ajută la eliminarea erorilor rămase.
