---
id: spliit-cloud-2-7-0
date: 2026-10-12
title: Escanear recibos es 5 veces más rápido — y ya lee PDF
inApp: true
email: true
---

Spliit Cloud 2.7.0 renueva el escaneo de recibos de arriba abajo: los escaneos son unas 5 veces más rápidos, las categorías salen más acertadas y los recibos ya no tienen que ser fotos. Encontrarás más detalles en las notas de la [v2.7.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.7.0).

## Escaneos más rápidos

Los recibos ahora pasan por un paso dedicado de extracción de texto antes de que ninguna IA los mire, así un modelo rápido hace el trabajo de estructuración en lugar de uno lento leyendo la foto. En nuestras pruebas, un recibo de 10 artículos pasó de unos 80 segundos a unos 14, y los recibos más pequeños suelen terminar en unos 6 segundos. La categorización pasó a un modelo rápido de decisión con todo tu historial de gastos detrás, así que las sugerencias deberían ser más acertadas.

## Más que fotos

Ahora puedes escanear facturas en PDF — las digitales se leen directamente, las fotografiadas cambian automáticamente a la alternativa — además de archivos TXT, CSV, DOCX y ODT. Las cantidades de los artículos también aceptan fracciones, así una línea pesada como 1.5 kg llega exactamente como está impresa en lugar de redondearse.

## Tú decides cuando el total no cuadra

Cuando los artículos escaneados no suman el total del recibo, la vista previa ahora te pregunta qué total es correcto en lugar de adivinarlo. Las pequeñas diferencias de redondeo ofrecen una línea «Redondeo» con el total del recibo preseleccionado; las diferencias mayores te avisan y ofrecen una línea explícita «Otros», y siempre puedes corregirlo en el formulario de edición.

## Cuéntanos qué lee mal

Este nuevo proceso ya gestiona todos los escaneos en Spliit Cloud, así que tus recibos son la prueba de fuego real. Si un escaneo lee mal un artículo, elige una categoría equivocada o te da un total extraño, [repórtalo](https://github.com/antonio-ivanovski/spliit-cloud/issues/new?template=bug_report.yml) con el recibo si puedes compartirlo.
