---
id: spliit-cloud-2-7-0
date: 2026-10-12
title: Fiş tarama 5 kat daha hızlı — artık PDF de okuyor
channels: [updates, modal, email]
---

Spliit Cloud 2.7.0, fiş taramayı baştan aşağı yeniliyor: taramalar yaklaşık 5 kat daha hızlı çalışıyor, kategoriler daha isabetli çıkıyor ve fişlerin artık fotoğraf olması gerekmiyor. Ayrıntılar [v2.7.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.7.0) notlarında.

## Daha hızlı taramalar

Fişler artık yapay zekâya gitmeden önce özel bir metin çıkarma adımından geçiyor; böylece fotoğrafı yavaş bir model okumak yerine hızlı bir model yapılandırma işini yapıyor. Denemelerimizde 10 kalemlik bir fiş yaklaşık 80 saniyeden 14 saniyeye indi, küçük fişler ise düzenli olarak 6 saniye civarında tamamlanıyor. Kategorizasyon da tüm gider geçmişini kullanan hızlı bir karar modeline taşındı, bu yüzden öneriler daha isabetli olmalı.

## Fotoğraftan fazlası

Artık PDF faturaları tarayabilirsin — dijital olanlar doğrudan okunuyor, fotoğrafı çekilmiş olanlara otomatik olarak dönülüyor — ayrıca TXT, CSV, DOCX ve ODT dosyaları da destekleniyor. Kalem miktarları kesirli değerleri de destekliyor; böylece 1.5 kg gibi tartımlı bir satır yuvarlanmadan, yazdığı gibi geliyor.

## Toplam tutmayınca karar senin

Taranan kalemler fiş toplamıyla tutmadığında, önizleme tahmin yürütmek yerine hangi toplamın doğru olduğunu soruyor. Küçük yuvarlama farkları, fiş toplamı önceden seçili bir "Yuvarlama" satırı öneriyor; daha büyük farklarda uyarı verip açık bir "Diğer" satırı sunuyor ve her şeyi düzenleme formunda düzeltebilirsin.

## Yanlış okumaları bize bildir

Bu yeni işlem hattı Spliit Cloud üzerindeki her taramada zaten devrede, yani fişlerin gerçek test paketi. Bir tarama bir kalemi yanlış okur, yanlış kategori seçer ya da tuhaf bir toplam verirse, paylaşabilirsen fişle birlikte lütfen [bildir](https://github.com/antonio-ivanovski/spliit-cloud/issues/new?template=bug_report.yml).
