---
id: spliit-cloud-2-6-0
date: 2026-10-08
title: Spliit Cloud artık çevrimdışı çalışıyor — test etmeye yardımcı ol
inApp: true
email: true
---

Spliit Cloud 2.6.0 uygulamaya çevrimdışı okuma getiriyor: bağlantı olmadan da grupların okunabilir kalıyor. Bu, çevrimdışı okumanın temeli — bu aşama sağlamlaştıktan sonra gider oluşturma dahil tam çevrimdışı yazma gelecek. Ayrıntılar [v2.6.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.6.0) notlarında.

## Çevrimdışıyken neler yapabilirsin

- Gruplarını aç ve yorumlar, bakiyeler, üye listesi, alt grup atamaları, bölüşüm ön ayarları, bütçeler, grup ayarları ve son etkinliklerle birlikte eksiksiz gider geçmişine göz at.
- Listeler cihazdaki kopyadan anında açılıyor ve yeniden bağlandığında yeni değişiklikleri olduğu yerde birleştiriyor, bu yüzden yavaş bağlantılar da çok daha hızlı hissettiriyor.
- Yeni adım adım yönlendirmeyle Spliit Cloud'i cihazına bir uygulama olarak kur.

## Hâlâ bağlantı gerektirenler

Gider, dosya oluşturma veya düzenleme ile indirilen aralığın dışındaki eski etkinlikler hâlâ bağlantı gerektiriyor ve bakiyeler güncel olmadığında uyarı veriyor. Yeniden bağlandıktan sonra bir şeyler tuhaf görünürse yenileme en güncel durumu getiriyor.

## Pürüzleri gidermeye yardımcı ol

Çevrimdışı modu yeni ve çevrimdışı yazma gelmeden önce gerçek kullanımda test edilmeye ihtiyacı var; bunu mümkün kılmak için istemci baştan aşağı elden geçirildi — bu yüzden çevrimiçi modda da hatalar görünebilir. Olağandışı bir şey fark edersen, çevrimdışıyken de çevrimiçiyken de — yüklenmeyen bir liste, yeniden bağlandıktan sonra devre dışı kalan bir denetim ya da hiç güncellenmeyen eski bir bakiye — lütfen ne yaptığını, o sırada çevrimdışı olup olmadığını ve ne olmasını beklediğini yazarak [bildir](https://github.com/antonio-ivanovski/spliit-cloud/issues/new?template=bug_report.yml). Bir noktada için rahat olsun: giderlerin sunucuda hesaplanma biçiminde hiçbir şey değişmedi — bakiyeler, bölüşümler ve borç kapatmalar eskisi gibi hesaplanıyor. Her bildirim kalan hataları yakalamaya yardımcı oluyor.
