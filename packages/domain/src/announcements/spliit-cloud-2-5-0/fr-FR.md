---
id: spliit-cloud-2-5-0
date: 2026-10-05
title: Spliit Cloud 2.5.0 est disponible
inApp: true
email: true
---

Spliit Cloud 2.5.0 est disponible. Voici les nouveautés de cette version, suivies d'un récapitulatif des fonctions récentes que vous avez peut-être manquées. Nous ne partagerons de cette façon que les nouvelles fonctions et les annonces importantes, pas les petits correctifs qui sortent en continu.

## L'onglet Activité devient personnel

L'onglet Activité reflète désormais la chronologie des dépenses : un commutateur Pour vous / Toutes masque l'activité qui ne vous concerne pas derrière des lignes intégrées, et chaque dépense affiche votre part sur sa propre ligne Votre part :. Les détails sont dans les notes de la [v2.5.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.5.0).

## Supprimez votre compte, avec un filet de sécurité de 48 heures

Les paramètres du compte proposent une nouvelle Zone dangereuse avec une page de vérification dédiée : consultez les conséquences par groupe, choisissez la façon dont votre nom et les soldes restants sont traités, puis saisissez SUPPRIMER pour planifier. Votre compte reste actif pendant 48 heures et vous pouvez annuler à tout moment. Les détails sont dans les notes de la [v2.5.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.5.0).

## Une catégorisation bien plus rapide, avec un nettoyage groupé depuis les outils du groupe

Les dépenses sont désormais catégorisées en environ 250ms avec le modèle de décision Jev au lieu d'environ 3s avec le LLM, et les estimations incertaines apparaissent sous forme de suggestions en un toucher. Quand un groupe entier doit être rangé, la [catégorisation groupée](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.4.0) vérifie les suggestions et les enregistre ensemble depuis les outils du groupe. Les détails sont dans les notes des versions [v2.4.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.4.0) et [v2.3.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.3.0).

## Importez depuis presque tout CSV de banque ou de carte

Apportez vos dépenses existantes en téléversant un relevé bancaire ou un export de carte. L'[importateur CSV générique](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.0.0) associe les colonnes avec un aperçu en direct, associe les catégories et signale les doublons avant toute écriture.

## Des clés d'accès pour chaque compte, y compris les invités

Connectez-vous avec votre empreinte, votre visage ou une clé de sécurité au lieu d'un mot de passe. Les clés d'accès fonctionnent pour les comptes e-mail, sociaux et invités, et elles vont bien avec les comptes anonymes en remplacement du lien de récupération. Voir les notes de la [v2.3.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.3.0).

## Invitez toute une salle en quelques secondes

Partagez un unique QR code à scanner que toute la salle peut utiliser, valable 15 minutes avec une liste en direct des personnes qui ont rejoint. Les invités peuvent aussi rejoindre depuis l'appareil photo de leur téléphone ou l'action Scanner pour rejoindre. Voir les notes de la [v2.1.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.1.0).

## Une app plus calme qui montre ce qui vous concerne

Les chronologies masquent désormais les dépenses et l'activité qui ne vous concernent pas derrière des lignes intégrées, avec un commutateur Pour vous / Toutes. Vous pouvez aussi définir votre propre ordre des onglets du groupe et masquer ceux que vous n'utilisez pas, voir des répartitions détaillées par personne dans les détails des dépenses, et choisir les heures sur mobile avec de grandes molettes. Voir les notes des versions [v2.1.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.1.0) et [v2.4.1](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.4.1).

## Emportez vos données avec vous

Exportez une sauvegarde ZIP complète et réversible des groupes et des comptes, ainsi que des rapports CSV et PDF imprimables. Les imports et les exports sont décrits dans les notes de la [v2.0.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.0.0).

## Rendez chaque groupe reconnaissable

Donnez à chaque groupe son propre style avec un emoji et une couleur, affichés sur les cartes, les barres et les fonds d'ambiance. Voir les notes de la [v2.2.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.2.0).

## Pour les développeurs : des webhooks sortants

Poussez les créations, mises à jour et suppressions de dépenses vers votre propre point de terminaison HTTPS sous forme d'événements signés avec tentatives, historique de livraison et renvoi. La configuration est dans les notes de la [v2.2.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.2.0).
