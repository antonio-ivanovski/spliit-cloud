---
id: spliit-cloud-2-7-0
date: 2026-10-12
title: Kvittoskanning är 5× snabbare — och läser PDF:er nu
inApp: true
email: true
---

Spliit Cloud 2.7.0 bygger om kvittoskanningen från grunden: skanningar går cirka 5× snabbare, kategorierna blir smartare, och kvitton måste inte längre vara foton. Detaljer finns i [v2.7.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.7.0) anteckningarna.

## Snabbare skanningar

Kvitton går nu genom ett eget textutvinningssteg innan någon AI tittar på dem, så en snabb modell gör struktureringen i stället för att en långsam modell läser fotot. I våra körningar gick ett kvitto med 10 artiklar från cirka 80 sekunder till cirka 14, och mindre kvitton blir regelbundet klara på cirka 6 sekunder. Kategoriseringen körs nu på en snabb beslutsmodell med hela din utgiftshistorik bakom sig, så förslagen borde träffa bättre också.

## Mer än foton

Du kan nu skanna PDF-fakturor — digitala läses direkt, fotograferade faller tillbaka automatiskt — plus TXT-, CSV-, DOCX- och ODT-filer. Artikelmängder stöder också decimaler, så en vägd rad som 1,5 kg kommer in exakt som tryckt i stället för att avrundas bort.

## Du avgör när totalen inte stämmer

När skannade artiklar inte summerar till kvittototalen frågar förhandsvisningen nu vilken total som stämmer i stället för att gissa. Små avrundningsglapp får en rad ”Avrundning” med kvittototalen förvald; större glapp varnar dig och erbjuder en egen rad ”Övrigt”, och du kan alltid rätta till saker i redigeringsformuläret.

## Berätta vad som blir felläst

Den här nya pipelinen hanterar redan varje skanning på Spliit Cloud, så dina kvitton är det riktiga testpaketet. Om en skanning läser en artikel fel, väljer fel kategori eller ger dig en konstig total, [rapportera det](https://github.com/antonio-ivanovski/spliit-cloud/issues/new?template=bug_report.yml) med kvittot om du kan dela det.
