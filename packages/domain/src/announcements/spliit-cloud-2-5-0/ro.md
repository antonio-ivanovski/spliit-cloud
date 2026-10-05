---
id: spliit-cloud-2-5-0
date: 2026-10-05
title: Spliit Cloud 2.5.0 a sosit
inApp: true
email: true
---

Spliit Cloud 2.5.0 este disponibil. Iată noutățile din această versiune, urmate de un rezumat al funcțiilor recente pe care s-ar putea să le fi ratat. Vom partaja în acest fel doar funcțiile noi și anunțurile importante, nu micile remedieri care apar continuu.

## Fila Activitate este acum personală

Fila Activitate reflectă acum cronologia cheltuielilor: un comutator Pentru tine / Toate ascunde activitatea care nu te implică în spatele unor rânduri integrate, iar fiecare cheltuială îți arată partea ta pe propriul rând Partea ta:. Detaliile sunt în notele [v2.5.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.5.0).

## Șterge-ți contul, cu o plasă de siguranță de 48 de ore

Setările contului au o nouă Zonă periculoasă cu o pagină de verificare dedicată: vezi consecințele pentru fiecare grup, alege cum sunt gestionate numele tău și soldurile rămase, apoi tastează ȘTERGE pentru a programa. Contul tău rămâne activ 48 de ore și poți anula oricând. Detaliile sunt în notele [v2.5.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.5.0).

## Categorizare mult mai rapidă, cu curățare în masă din instrumentele grupului

Cheltuielile sunt acum categorizate în circa 250ms cu modelul de decizie Jev în locul celor circa 3s cu LLM-ul, iar estimările incerte apar ca sugestii cu o singură atingere. Când un grup întreg are nevoie de ordine, [categorizarea în masă](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.4.0) verifică sugestiile și le salvează împreună din instrumentele grupului. Detaliile sunt în notele [v2.4.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.4.0) și [v2.3.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.3.0).

## Importă din aproape orice CSV de bancă sau card

Adu cheltuielile existente încărcând un extras bancar sau un export de card. [Importatorul CSV generic](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.0.0) mapează coloanele cu o previzualizare live, mapează categoriile și semnalează duplicatele înainte ca ceva să fie scris.

## Chei de acces pentru fiecare cont, inclusiv pentru invitați

Autentifică-te cu amprenta, fața sau o cheie de securitate în locul unei parole. Cheile de acces funcționează pentru conturile de e-mail, sociale și de invitat și se potrivesc bine cu conturile anonime ca înlocuitor al legăturii de recuperare. Vezi notele [v2.3.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.3.0).

## Invită o cameră întreagă în câteva secunde

Partajează un singur cod QR doar pentru scanare pe care îl poate folosi toată camera, valabil 15 minute cu o listă live a celor care s-au alăturat. Invitații se pot alătura și din camera telefonului sau din acțiunea Scanează pentru a te alătura. Vezi notele [v2.1.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.1.0).

## O aplicație mai calmă care arată ce e al tău

Cronologiile ascund acum cheltuielile și activitatea care nu te implică în spatele unor rânduri integrate, cu un comutator Pentru tine / Toate. De asemenea, poți seta propria ordine a filelor grupului și ascunde filele pe care nu le folosești, poți vedea defalcări detaliate per persoană în detaliile cheltuielii și poți alege orele pe mobil cu rotițe mari de derulare. Vezi notele [v2.1.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.1.0) și [v2.4.1](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.4.1).

## Ia-ți datele cu tine

Exportă o copie de rezervă ZIP completă și reversibilă a grupurilor și conturilor, plus rapoarte CSV și PDF printabile. Importurile și exporturile sunt descrise în notele [v2.0.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.0.0).

## Fă fiecare grup ușor de recunoscut

Dă fiecărui grup propriul aspect cu un emoji și o culoare, afișate pe carduri, bare și fundaluri ambientale. Vezi notele [v2.2.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.2.0).

## Pentru dezvoltatori: webhook-uri de ieșire

Trimite creările, actualizările și ștergerile de cheltuieli către propriul endpoint HTTPS ca evenimente semnate cu reîncercări, istoric de livrare și retrimitere. Configurarea este în notele [v2.2.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.2.0).
