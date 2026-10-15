---
id: spliit-cloud-2-7-0
date: 2026-10-12
title: Digitalizar recibos é 5 vezes mais rápido — e já lê PDF
channels: [updates, modal, email]
---

O Spliit Cloud 2.7.0 renova a digitalização de recibos de cima a baixo: as digitalizações são cerca de 5 vezes mais rápidas, as categorias saem mais certeiras e os recibos já não têm de ser fotos. Os detalhes estão nas notas da [v2.7.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.7.0).

## Digitalizações mais rápidas

Os recibos passam agora por um passo dedicado de extração de texto antes de qualquer IA olhar para eles, por isso um modelo rápido faz o trabalho de estruturação em vez de um lento a ler a foto. Nos nossos testes, um recibo de 10 itens passou de cerca de 80 segundos para cerca de 14, e os recibos mais pequenos terminam normalmente em cerca de 6 segundos. A categorização passou para um modelo rápido de decisão com todo o teu historial de despesas por trás, por isso as sugestões devem ser mais certeiras.

## Mais do que fotos

Agora podes digitalizar faturas em PDF — as digitais são lidas diretamente, as fotografadas mudam automaticamente para a alternativa — além de ficheiros TXT, CSV, DOCX e ODT. As quantidades dos itens também aceitam frações, por isso uma linha pesada como 1.5 kg chega exatamente como está impressa em vez de ser arredondada.

## Tu decides quando o total não bate certo

Quando os itens digitalizados não somam o total do recibo, a pré-visualização pergunta agora qual é o total correto em vez de adivinhar. Pequenas diferenças de arredondamento oferecem uma linha «Arredondamento» com o total do recibo pré-selecionado; diferenças maiores avisam-te e oferecem uma linha explícita «Outro», e podes sempre corrigir tudo no formulário de edição.

## Diz-nos o que corre mal

Este novo processo já trata de todas as digitalizações no Spliit Cloud, por isso os teus recibos são o verdadeiro teste. Se uma digitalização ler mal um item, escolher uma categoria errada ou der-te um total estranho, [reporta](https://github.com/antonio-ivanovski/spliit-cloud/issues/new?template=bug_report.yml) com o recibo se o puderes partilhar.
