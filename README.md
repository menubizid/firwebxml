# firwebxml — Jaringan Digital Nusantara

Paket lengkap lima situs yang dirangkai jadi satu aplikasi: **LPK Putri Ayu Mandiri**,
**Wedding Organizer Paes Nusa**, **Asosiasi Perias Nusantara**, **Personal Branding Mbak Ayu**,
dan **Personal Branding Pak Urip Sedyowidodo** — plus halaman panduan, Studio Data (CRUD), dan
panel koneksi REST API.

> Desain Web oleh **Firman Web**

Hanya ada **tiga berkas** yang perlu dijaga:

| Berkas | Isi | Ukuran |
|---|---|---|
| `index.html` | Seluruh aplikasi: 34 halaman, CSS, ikon, data contoh, LocalDB, router, Studio, panel API. Tanpa dependensi, tanpa build step. | ± 400 KB |
| `code.gs` | REST API di Google Apps Script (Spreadsheet sebagai basis data): `doGet`/`doPost`, 14 koleksi, validasi, LockService, notifikasi email + WhatsApp, menu admin, seeder. | ± 53 KB |
| `theme-blogspot-firman-web.xml` | Tema Blogger Layouts v3: satu tema, lima mode warna merek, widget hero/sidebar/footer, komentar, share, langganan. | ± 81 KB |

## Menjalankan

1. Buka `index.html` di browser (klik dua kali sudah cukup) atau jalankan server statis:
   ```bash
   python3 -m http.server 8080
   # lalu akses http://localhost:8080/index.html
   ```
2. Semua formulir (pendaftaran siswa, booking wedding, usulan anggota, undangan narasumber,
   aspirasi warga, testimoni, pesan) **langsung berfungsi**: data masuk ke LocalDB browser.
3. Opsional — sambungkan ke server: buka `#/api`, tempel URL Web App dari `code.gs`, lalu
   **Simpan & Uji Koneksi**. Setelah terhubung, setiap entri baru ikut terkirim ke Spreadsheet
   dan perubahan bisa ditarik balik ke perangkat (`Tarik Semua Data`).

### Rute

```
#/hub                     Peta lima situs (beranda jaringan)
#/hub/panduan             Panduan lengkap: struktur, data, API, pemasangan, SEO
#/studio                  Studio Data — CRUD semua koleksi + ekspor/impor
#/api                     Panel koneksi REST API

#/lpk /tentang /program /kemitraan /galeri /kontak        (+ #/lpk/program/{slug})
#/wo  /tentang /paket    /portfolio /testimoni /booking  (+ #/wo/paket/{slug})
#/asosiasi /tentang /kegiatan /anggota /publikasi /kontak
#/ayu /profil /pakem /mahakarya /artikel /kolaborasi
#/urip /profil /visi /gerakan /opini /kontak
```

Setiap situs punya header, footer, palet, dan tipografi sendiri, tetapi berbagi satu basis data
dan satu komponen — jadi perubahan di Studio langsung terlihat di semua halaman.

## REST API (`code.gs`)

```
GET    {BASE}                              health: versi, daftar koleksi, jumlah baris
GET    {BASE}/schema                       skema field tiap koleksi
GET    {BASE}/{koleksi}?q=&status=&sort=    daftar + pencarian + paginasi
GET    {BASE}/{koleksi}/{id}               satu baris
POST   {BASE}/{koleksi}                    buat baris
PATCH  {BASE}/{koleksi}/{id}               ubah sebagian
DELETE {BASE}/{koleksi}/{id}               arsipkan (?hard=1 + token admin untuk hapus permanen)
POST   {BASE}/bulk                         banyak aksi sekali jalan
GET    {BASE}/stats                        ringkasan agregat
GET    {BASE}/export?koleksi=booking       CSV
POST   {BASE}/admin                        seed / reindex / purge (butuh token)
```

Bila path sesudah `/exec` tidak ikut terkirim, semua rute tetap bisa dipanggil lewat parameter
`?_p=<koleksi>/<id>`. Tulis `registration` dan `message` diizinkan tanpa token (koleksi publik);
selebihnya membutuhkan `ADMIN_TOKEN` dari Script Properties.

**Pemasangan:** Extensions ▸ Apps Script ▸ tempel `code.gs` ▸ menu **Firman Web ▸ 1. Setup
Database** ▸ (opsional) **2. Isi Data Contoh** ▸ Deploy ▸ New deployment ▸ *Web app* ▸
Execute as *Me*, Who has access *Anyone* ▸ salin URL `/exec` ke panel `#/api`.

## Studio Data (CRUD penuh)

- 14 koleksi: `program`, `paket`, `event`, `anggota`, `people`, `artikel`, `testimonial`,
  `registration`, `booking`, `membership`, `collab`, `aspiration`, `message`, `subscriber`.
- Buat / lihat / ubah / hapus (arsip atau permanen), pencarian, urut, paginasi, status baris,
  penanda "lokal" bila belum tersinkron.
- Ekspor CSV per koleksi, ekspor JSON seluruh basis data, impor JSON, dan muat ulang data contoh.
- Tanpa halaman login: akses lewat `#/studio` (panel pribadi di perangkat Anda).

## Tema Blogspot

1. Blogger ▸ **Theme** ▸ ikon panah ▸ **Restore** ▸ unggah `theme-blogspot-firman-web.xml`.
2. **Customize ▸ Advanced ▸ Brand** ▸ isi `brandMode` dengan `lpk`, `wo`, `asosiasi`, `ayu`,
   atau `urip` — warna, font judul, sudut kartu, dan motif batik ikut berubah. Palet kustom
   tetap bisa diatur lewat variabel `keycolor`, `accentColor`, dst.
3. Widget siap pakai: Header, Navigasi (PageList), Hubungi Tim, Tulisan Teratas, Rubrik, Agenda
   Jaringan, Jaringan Situs, Kabar Bulanan, Peta Situs, Kanal Resmi, Kredit.
4. Agar form langganan mengalir ke basis data yang sama, isi `FW_API` di blok `<script>` tema
   dengan URL Web App dari `code.gs`.

## Catatan teknis

- Tipografi dasar 16–17 px, penaikan skala teks 1,08× / 1,16× lewat tombol **A/a** di header.
- Responsif mobile-first: navbar berubah jadi drawer, grid 4→2→1, dock bawah layar, target
  sentuh ≥ 44 px, tabel panjang bisa digeser.
- Gambar memakai Pexels CDN (`?auto=compress&cs=tinysrgb&w=…`) dengan `srcset` dua ukuran,
  `loading="lazy"`, dan poster fallback bermotif kawung bila jaringan foto terputus.
- Aksesibilitas: skip link, `aria-current`/`aria-selected`, dialog dengan focus-trap, Esc untuk
  menutup, `aria-live` untuk status form, kontras AA, dan animasi otomatis berhenti saat sistem
  meminta `prefers-reduced-motion` (bisa juga dimatikan manual dari menu Preferensi).
- Semua animasi berbasis `transform`/`opacity`; tidak ada dependensi JavaScript pihak ketiga.
