---
id: spliit-cloud-2-5-0
date: 2026-10-05
title: Spliit Cloud 2.5.0 ist da
inApp: true
email: true
---

Spliit Cloud 2.5.0 ist da. Hier erfährst du, was in dieser Version neu ist, plus einen Überblick über aktuelle Funktionen, die du vielleicht verpasst hast. Auf diesem Weg teilen wir nur neue Funktionen und wichtige Ankündigungen – keine kleinen Patches und Fixes, die laufend erscheinen.

## Aktivitäts-Tab wird persönlich

Der Aktivitäts-Tab spiegelt jetzt die Ausgaben-Timeline wider: Mit dem Schalter Für dich / Alle blendest du Aktivitäten, die dich nicht betreffen, hinter eingebetteten Zeilen aus, und jede Ausgabe zeigt deinen Anteil in einer eigenen Zeile Dein Anteil:. Details findest du in den [v2.5.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.5.0) Hinweisen.

## Konto löschen, mit 48-Stunden-Sicherheitsnetz

In den Kontoeinstellungen gibt es eine neue Gefahrenzone mit eigener Überprüfungsseite: Sieh dir die Folgen pro Gruppe an, wähle, wie dein Name und deine offenen Salden behandelt werden, und gib LÖSCHEN ein, um die Löschung zu planen. Dein Konto bleibt 48 Stunden aktiv und du kannst jederzeit abbrechen. Details findest du in den [v2.5.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.5.0) Hinweisen.

## Viel schnelleres Kategorisieren, plus Massenbereinigung aus den Gruppen-Tools

Ausgaben werden jetzt in etwa 250 ms mit dem Jev-Entscheidungsmodell kategorisiert statt in rund 3 s mit dem LLM, und unsichere Treffer erscheinen als antippbare Vorschlags-Chips. Wenn eine ganze Gruppe aufgeräumt werden muss, prüft die [Massencategorisierung](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.4.0) Vorschläge und speichert sie gemeinsam aus den Gruppen-Tools. Details findest du in den [v2.4.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.4.0) und [v2.3.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.3.0) Hinweisen.

## Import aus fast jeder Bank- oder Karten-CSV

Nimm deine bisherigen Ausgaben mit, indem du einen Kontoauszug oder Kartenexport hochlädst. Der [generische CSV-Importer](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.0.0) ordnet Spalten mit Live-Vorschau zu, ordnet Kategorien zu und markiert Duplikate, bevor etwas gespeichert wird.

## Passkeys für jedes Konto, auch für Gäste

Melde dich mit Fingerabdruck, Gesicht oder Sicherheitsschlüssel statt mit Passwort an. Passkeys funktionieren für E-Mail-, Social- und Gastkonten und passen gut zu anonymen Konten als Ersatz für den Wiederherstellungslink. Siehe die [v2.3.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.3.0) Hinweise.

## Lade einen ganzen Raum in Sekunden ein

Teile einen QR-Code nur zum Scannen, den der ganze Raum nutzen kann, gültig für 15 Minuten mit einer Live-Liste aller Beitritte. Gäste können auch über ihre Handykamera oder die Aktion Scannen zum Beitreten beitreten. Siehe die [v2.1.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.1.0) Hinweise.

## Eine ruhigere App, die zeigt, was dich betrifft

Timelines blenden jetzt Ausgaben und Aktivitäten aus, die dich nicht betreffen, hinter eingebetteten Zeilen aus, mit einem Schalter Für dich / Alle. Du kannst außerdem deine eigene Gruppen-Tab-Reihenfolge festlegen und ungenutzte Tabs ausblenden, aufgeschlüsselte Beträge pro Person in den Ausgabendetails sehen und auf dem Handy Zeiten mit großen Scrollrädern wählen. Siehe die [v2.1.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.1.0) und [v2.4.1](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.4.1) Hinweise.

## Nimm deine Daten mit

Exportiere ein vollständiges ZIP-Backup deiner Gruppen und Konten für den Roundtrip, plus CSV- und druckbare PDF-Berichte. Importe und Exporte werden in den [v2.0.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.0.0) Hinweisen behandelt.

## Mach jede Gruppe erkennbar

Gib jeder Gruppe ihren eigenen Look mit Emoji und Farbe, sichtbar auf Karten, Leisten und stimmungsvollen Hintergründen. Siehe die [v2.2.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.2.0) Hinweise.

## Für Entwickler: ausgehende Webhooks

Sende Erstellungen, Aktualisierungen und Löschungen von Ausgaben als signierte Ereignisse mit Wiederholungen, Zustellverlauf und erneuter Zustellung an deinen eigenen HTTPS-Endpunkt. Die Einrichtung steht in den [v2.2.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.2.0) Hinweisen.
