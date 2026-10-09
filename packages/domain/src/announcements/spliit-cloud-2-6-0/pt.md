---
id: spliit-cloud-2-6-0
date: 2026-10-08
title: O Spliit Cloud já funciona offline — ajuda a testar
inApp: true
email: true
---

O Spliit Cloud 2.6.0 traz a leitura offline para a app: os teus grupos ficam legíveis sem ligação. É a base da leitura offline — a escrita offline completa, incluindo criar despesas, chegará quando esta fase estiver sólida. Os detalhes estão nas notas da [v2.6.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.6.0).

## O que podes fazer offline

- Abre os teus grupos e consulta o historial completo de despesas com comentários, saldos, a lista de membros, atribuições de subgrupos, divisões predefinidas, orçamentos, as definições do grupo e a atividade recente.
- As listas abrem instantaneamente a partir da cópia no dispositivo e integram as novidades ao voltares a ligar-te, por isso as ligações lentas também parecem muito mais rápidas.
- Instala o Spliit Cloud como uma app no teu dispositivo com o novo guia passo a passo.

## O que ainda precisa de ligação

Criar ou editar despesas, ficheiros e atividade mais antiga além da janela descarregada ainda precisam de ligação, e os saldos avisam quando estão desatualizados. Se algo parecer errado depois de voltares a ligar-te, uma atualização traz o estado mais recente.

## Ajuda a limar as arestas

O modo offline é novo e precisa de testes reais antes de chegar a escrita offline, e o cliente passou por uma grande reestruturação para o tornar possível — por isso também podem aparecer erros no modo online. Se notares algo estranho, offline ou online — uma lista que não carrega, um controlo que fica desativado depois de voltares a ligar-te, ou um saldo desatualizado que nunca desaparece — [reporta](https://github.com/antonio-ivanovski/spliit-cloud/issues/new?template=bug_report.yml) o que estavas a fazer, se estavas offline nesse momento e o que esperavas que acontecesse. Uma garantia: nada mudou na forma como as despesas são calculadas no servidor — saldos, divisões e liquidações são calculados exatamente como antes. Cada reporte ajuda a resolver os erros restantes.
