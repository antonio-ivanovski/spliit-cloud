---
id: spliit-cloud-2-7-0
date: 2026-10-12
title: La numérisation des reçus est 5 fois plus rapide — et lit désormais les PDF
channels: [updates, modal, email]
---

Spliit Cloud 2.7.0 repense la numérisation des reçus de fond en comble : les analyses sont environ 5 fois plus rapides, les catégories sont plus pertinentes, et les reçus ne doivent plus être des photos. Les détails sont dans les notes de la [v2.7.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.7.0).

## Des analyses plus rapides

Les reçus passent désormais par une étape dédiée d'extraction de texte avant qu'une IA ne les examine, de sorte qu'un modèle rapide fait le travail de structuration au lieu d'un modèle lent lisant la photo. Lors de nos tests, un reçu de 10 articles est passé d'environ 80 secondes à environ 14, et les reçus plus petits se terminent régulièrement en 6 secondes environ. La catégorisation repose sur un modèle de décision rapide avec tout votre historique de dépenses en appui, si bien que les suggestions devraient être plus pertinentes.

## Plus que des photos

Vous pouvez désormais numériser des factures PDF — les versions numériques sont lues directement, celles photographiées basculent automatiquement — ainsi que des fichiers TXT, CSV, DOCX et ODT. Les quantités des articles acceptent aussi les fractions, de sorte qu'une ligne pesée comme 1.5 kg arrive exactement comme imprimée au lieu d'être arrondie.

## Vous décidez quand le total ne correspond pas

Lorsque les articles numérisés ne correspondent pas au total du reçu, l'aperçu vous demande désormais quel total est correct au lieu de deviner. Les petits écarts d'arrondi proposent une ligne « Arrondi » avec le total du reçu présélectionné ; les écarts plus importants vous avertissent et proposent une ligne explicite « Autre », et vous pouvez toujours corriger les choses dans le formulaire de modification.

## Dites-nous ce qui est mal lu

Ce nouveau processus gère déjà toutes les numérisations sur Spliit Cloud, vos reçus sont donc le véritable banc d'essai. Si une analyse lit mal un article, choisit une mauvaise catégorie ou vous donne un total étrange, veuillez le [signaler](https://github.com/antonio-ivanovski/spliit-cloud/issues/new?template=bug_report.yml) avec le reçu si vous pouvez le partager.
