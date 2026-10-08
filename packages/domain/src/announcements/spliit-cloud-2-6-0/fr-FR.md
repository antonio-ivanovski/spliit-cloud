---
id: spliit-cloud-2-6-0
date: 2026-10-08
title: Spliit fonctionne désormais hors ligne — aidez-nous à le tester
inApp: true
email: true
---

Spliit 2.6.0 apporte la lecture hors ligne à l'app : vos groupes restent lisibles sans connexion. C'est la base de la lecture hors ligne — l'écriture complète hors ligne, y compris la création de dépenses, suivra une fois cette étape stabilisée. Les détails sont dans les notes de la [v2.6.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.6.0).

## Ce que vous pouvez faire hors ligne

- Ouvrez vos groupes et parcourez l'historique complet des dépenses avec les commentaires, les soldes, la liste des membres, les affectations de sous-groupes, les répartitions prédéfinies, les budgets, les paramètres du groupe et l'activité récente.
- Les listes s'ouvrent instantanément depuis la copie sur l'appareil et intègrent les nouveautés dès la reconnexion, si bien que les connexions lentes semblent beaucoup plus rapides aussi.
- Installez Spliit comme une app sur votre appareil grâce au nouveau guide étape par étape.

## Ce qui nécessite encore une connexion

La création ou la modification de dépenses, les fichiers et l'activité ancienne au-delà de la fenêtre téléchargée nécessitent encore une connexion, et les soldes signalent quand ils sont obsolètes. Si quelque chose semble incorrect après la reconnexion, une actualisation récupère le dernier état.

## Aidez-nous à corriger les derniers défauts

Le mode hors ligne est nouveau et a besoin de tests réels avant l'arrivée de l'écriture hors ligne, et le client a subi une lourde refonte pour le rendre possible — des bogues peuvent donc apparaître en mode en ligne aussi. Si vous remarquez quoi que ce soit d'étrange, hors ligne ou en ligne — une liste qui ne charge pas, un contrôle qui reste désactivé après la reconnexion, ou un solde obsolète qui ne s'efface jamais — veuillez le [signaler](https://github.com/antonio-ivanovski/spliit-cloud/issues/new?template=bug_report.yml) en précisant ce que vous faisiez, si vous étiez hors ligne à ce moment-là, et ce à quoi vous vous attendiez. Pour vous rassurer sur un point : rien n'a changé dans la façon dont les dépenses sont calculées sur le serveur — les soldes, les répartitions et les règlements sont calculés exactement comme avant. Chaque signalement aide à éliminer les derniers bogues.
