# PLAN — Webnovel Reader (brief umum)

## Produk
Sebuah aplikasi web statis untuk **membaca webnovel/novel ringan** di browser — nyaman, cepat, dan terasa seperti produk baca digital kelas atas.

## Fitur utama (inti produk)
1. **Perpustakaan / rak buku** — menampilkan koleksi novel (banyak volume/buku), sampul buku, progres baca per buku, "lanjutkan membaca" dari posisi terakhir di paling atas.
2. **Pembaca yang nyaman** — dua cara membaca: scroll kontinu & mode halaman (paged). Navigasi antar bab mudah (daftar isi, tombol, keyboard, swipe).
3. **Tema & kenyamanan mata** — beberapa tema baca (gelap/terang/sepia dll.), kontrol ukuran font, jarak baris, lebar kolom, pilihan font. Posisi baca tersimpan otomatis.
4. **Dengar (text-to-speech)** — baca nyaring dengan voice browser (gratis), mulai dari paragraf mana pun, sorot kalimat yang dibacakan, atur kecepatan & suara.
5. **Ilustrasi** — gambar/seni per bab tampil di posisi yang tepat dalam teks; ketuk untuk memperbesar (zoom/pan), galeri seni per buku.
6. **Pencarian** — temukan kata/frasa di seluruh buku, langsung melompat ke paragrafnya.
7. **Penanda & sorotan** — tandai bagian favorit, sorot kutipan, semua tersimpan di perangkat dan user bisa mengakses itu lagi.
8. **Statistik membaca** — riwayat progres, streak hari, perkiraan kata terbaca.
9. **Offline & portabel** — PWA: bisa dipasang, dibaca offline; zero dependensi/CDN.

## Prinsip UI/UX (level konsep, bukan salinan)
- **Satu aksen warna** yang tegas, dasar netral; tanpa elemen dekoratif berlebihan; kontras terbaca (AA) tapi tidak hitam putih full. Ada pilihan tema gelap/terang/sepia.
- **Tipografi** = bagian dari identitas: bedakan wajah untuk teks novel, judul, dan angka/keterangan.
- **Ilustrasi & cover adalah bintang** — tampilkan besar dan sinematik, jangan mengecilkannya jadi dekorasi.
- **Overlay yang sopan** (pengaturan, daftar isi, panel penanda): selalu bisa ditutup, tidak menutupi tombol lain.
- **Realtime/langsung jadi** — navigasi terekam di URL; tombol selalu merespons; posisi baca selamat dari refresh.
- Responsif penuh (mobile-first tak masalah, tapi fokus juga bagian desktop), tap-target nyaman, hormati prefers-reduced-motion.

## Teknis (ringkas)
- Vanilla HTML/CSS/JS statis, tanpa framework wajib — yang penting: tanpa CDN/dependensi jaringan demi offline.
- Gunakan skills frontend seperti:
  - [Interaction Design](https://www.aura.build/skills/9c72d1e4-c647-46ef-b64c-ec5d371c7447/interaction-design)
  - [Anime.js v4](https://www.aura.build/skills/aa65a9aa-54de-4686-b94a-3a0e07d99035/anime-js-v4-skill)
  Jangan lupa untuk memprioritaskan pelibatan skills ini untuk membuat design yang masterpiece.
- Data per buku: teks bab + metadata + daftar gambar; generator sederhana dari Markdown.
- Kontrak kualitas: tidak boleh ada error JavaScript saat dipakai, semua tombol berfungsi, semua tema terbaca.

## Batasan desain (untuk generasi desain baru)
- BRIEF INI GENERAL: silakan ciptakan ulang arah visual & interaksi dari nol.
- Wajib dipertahankan: seluruh fitur utama di atas (1–9) beserta perilakunya.
- Bebas diubah: palet, tipografi, layout perpustakaan, bentuk toolbar/panel/lightbox, urutan & penyajian fitur.