---
id: spliit-cloud-2-7-0
date: 2026-10-12
title: Pemindaian struk 5× lebih cepat — dan kini bisa membaca PDF
inApp: true
email: true
---

Spliit Cloud 2.7.0 merombak pemindaian struk dari hulu ke hilir: pemindaian berjalan sekitar 5× lebih cepat, kategori keluar lebih cerdas, dan struk tidak lagi harus berupa foto. Detailnya ada di catatan [v2.7.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.7.0).

## Pemindaian lebih cepat

Struk kini melewati langkah ekstraksi teks khusus sebelum AI apa pun melihatnya, sehingga model yang cepat mengerjakan penataan struktur alih-alih model lambat yang membaca foto. Dalam pengujian kami, struk berisi 10 item turun dari sekitar 80 detik menjadi sekitar 14 detik, dan struk yang lebih kecil rutin selesai dalam sekitar 6 detik. Kategorisasi berpindah ke model keputusan yang cepat dengan seluruh riwayat pengeluaran Anda di belakangnya, sehingga sarannya seharusnya lebih tepat juga.

## Lebih dari sekadar foto

Anda kini bisa memindai faktur PDF — yang digital dibaca langsung, yang difoto beralih otomatis — plus file TXT, CSV, DOCX, dan ODT. Jumlah item juga mendukung pecahan, jadi baris timbangan seperti 1.5 kg tiba persis seperti tercetak alih-alih dibulatkan hilang.

## Anda yang menentukan saat totalnya tidak cocok

Saat item baris hasil pindaian tidak berjumlah sama dengan total struk, pratinjau kini menanyakan total mana yang benar alih-alih menebak. Selisih pembulatan kecil menawarkan baris "Pembulatan" dengan total struk sudah terpilih; selisih yang lebih besar memberi peringatan dan menawarkan baris "Lainnya" yang eksplisit, dan Anda selalu bisa memperbaikinya di formulir edit.

## Beri tahu kami yang salah terbaca

Alur baru ini sudah menangani setiap pemindaian di Spliit Cloud, jadi struk Anda adalah rangkaian uji yang sesungguhnya. Jika pemindaian salah membaca item, memilih kategori yang salah, atau memberi total yang aneh, harap [laporkan](https://github.com/antonio-ivanovski/spliit-cloud/issues/new?template=bug_report.yml) beserta struknya jika bisa Anda bagikan.
