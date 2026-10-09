---
id: spliit-cloud-2-6-0
date: 2026-10-08
title: Spliit Cloud kini berfungsi offline — bantu uji coba
inApp: true
email: true
---

Spliit Cloud 2.6.0 menghadirkan mode baca offline ke aplikasi: grup Anda tetap bisa dibaca tanpa koneksi. Ini adalah fondasi baca offline — tulis offline penuh, termasuk membuat pengeluaran, akan menyusul setelah tahap ini stabil. Detailnya ada di catatan [v2.6.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.6.0).

## Yang bisa Anda lakukan secara offline

- Buka grup Anda dan jelajahi seluruh riwayat pengeluaran lengkap dengan komentar, saldo, daftar anggota, penugasan subgrup, preset pembagian, anggaran, pengaturan grup, dan aktivitas terkini.
- Daftar terbuka seketika dari salinan di perangkat dan menggabungkan perubahan baru di tempat saat Anda tersambung kembali, sehingga koneksi lambat pun terasa jauh lebih cepat.
- Pasang Spliit Cloud sebagai aplikasi di perangkat Anda dengan panduan langkah demi langkah yang baru.

## Yang masih membutuhkan koneksi

Membuat atau mengedit pengeluaran, file, dan aktivitas lama di luar jendela unduhan masih membutuhkan koneksi, dan saldo memberi peringatan saat tidak terbaru. Jika ada yang terlihat janggal setelah tersambung kembali, muat ulang untuk menarik status terbaru.

## Bantu merapikan yang belum beres

Mode offline masih baru dan membutuhkan pengujian di dunia nyata sebelum tulis offline dirilis, dan klien mengalami refaktor besar agar hal ini memungkinkan — jadi bug bisa saja muncul dalam mode online juga. Jika Anda melihat sesuatu yang aneh, baik offline maupun online — daftar yang tidak termuat, kontrol yang tetap nonaktif setelah tersambung kembali, atau saldo usang yang tidak pernah hilang — harap [laporkan](https://github.com/antonio-ivanovski/spliit-cloud/issues/new?template=bug_report.yml) disertai apa yang sedang Anda lakukan, apakah Anda sedang offline saat itu, dan apa yang Anda harapkan terjadi. Satu hal yang pasti: tidak ada yang berubah dalam cara pengeluaran dihitung di server — saldo, pembagian, dan pelunasan dihitung persis seperti sebelumnya. Setiap laporan membantu menuntaskan bug yang tersisa.
