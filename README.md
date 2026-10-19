# 📝 Ujian Sekolah Dasar — Ulangan Harian Online

Aplikasi ulangan harian untuk siswa SD. Tampilan di **GitHub Pages** (gratis), data tersimpan di **Google Sheets** lewat **Google Apps Script** (gratis).

```
Siswa/Guru ──► GitHub Pages (index.html) ──► Apps Script (Code-Master.gs) ──► Google Sheets
```

## 📁 Isi repositori

| File | Fungsi |
|---|---|
| `index.html` | Aplikasi (siswa, dasbor guru, admin) |
| `config.js` | **Satu-satunya file yang diedit**: tempat URL server |
| `apps-script/Code-Master.gs` | Kode server (ditempel ke Google Apps Script) |
| `apps-script/appsscript.json` | Pengaturan Apps Script (opsional, untuk `clasp`) |
| `README.md` | Panduan ini |

---

## Bagian A — Pasang server (± 5 menit)

1. Buka [sheets.new](https://sheets.new), beri nama misalnya **Database Ujian SD**.
2. Menu **Ekstensi → Apps Script**.
3. Hapus isi `Code.gs`, lalu **tempel seluruh isi** `apps-script/Code-Master.gs`.
   Jika sebelumnya sudah ada file server lama, **hapus file lama itu** agar tidak bentrok. Cukup satu file ini.
4. Di bagian atas kode, ganti `ADMIN_PASS` dengan password admin pilihan Anda (username default `admin`).
5. Klik 💾 **Simpan**. Pilih fungsi **`setup`** di menu atas, lalu klik **▶ Jalankan**.
   Saat diminta izin, pilih akun Google Anda → **Lanjutan** → **Buka … (tidak aman)** → **Izinkan**. Ini normal untuk skrip buatan sendiri.
6. Klik **Terapkan → Deployment baru**:
   - Jenis: **Aplikasi web**
   - Jalankan sebagai: **Saya**
   - Yang memiliki akses: **Siapa saja**
7. Klik **Terapkan**, lalu **salin URL Aplikasi Web** (berakhiran `/exec`).

> ✅ Cek: buka URL itu di browser. Jika muncul `"Server aktif"`, server sudah benar.

## Bagian B — Taruh di GitHub

1. Buat akun di [github.com](https://github.com) (jika belum punya).
2. Klik **New repository** → nama, misalnya `ujian-sd` → **Public** → **Create repository**.
3. Klik **uploading an existing file**, lalu seret semua isi folder ini
   (`index.html`, `config.js`, `README.md`, `.nojekyll`, `.gitignore`, folder `apps-script`) → **Commit changes**.
4. Buka **config.js** di GitHub → ikon ✏️ **Edit** → ganti isi `GAS_URL` dengan URL dari Bagian A langkah 7 → **Commit changes**.
5. Buka **Settings → Pages**:
   - Source: **Deploy from a branch**
   - Branch: **main** dan folder **/ (root)** → **Save**
6. Tunggu 1–2 menit. Alamat aplikasi Anda:
   **`https://NAMA-GITHUB-ANDA.github.io/ujian-sd/`**

Bagikan alamat itu ke siswa (bisa dibuat QR code atau dipasang sebagai pintasan di layar HP).

## Bagian C — Pemakaian pertama

1. Buka aplikasi → tombol **🏫 Admin / Guru Mapel** → masuk dengan akun admin dari Bagian A.
2. Tab **🎓 Siswa**: impor data siswa (Excel/CSV), atau tambah satu per satu.
3. Tab **👩‍🏫 Guru**: tambah guru, lalu pilih **kelas dan mata pelajaran** yang diampu.
4. Tab **🔐 Akun**: ganti password admin.
5. Guru masuk lewat **⚙️ Guru** (PIN = password guru dari tab Guru) untuk membuat soal dan token ulangan.
6. Siswa membuka aplikasi: **Pendidik → Kelas → Nama** (nama hanya dari kelas yang dipilih) → mapel, UH, token → mulai.

> Daftar kelas dan nama siswa otomatis diambil dari Data Induk sesuai kelas yang diampu pendidik. Tidak perlu impor siswa lagi di dasbor guru.

---

## 🔄 Memperbarui

| Yang diubah | Caranya |
|---|---|
| Tampilan / fitur aplikasi | Ganti `index.html` di GitHub (**Add file → Upload files**, nama sama). `config.js` tidak tersentuh. |
| Kode server | Tempel kode baru di Apps Script → **Terapkan → Kelola deployment → ✏️ → Versi baru → Terapkan**. **URL tetap sama.** |
| URL server | Edit `config.js` saja |

> Jangan pilih "Deployment baru" untuk pembaruan, karena URL akan berubah. Pakai **Kelola deployment → Versi baru**.

## 🧰 Perawatan

- **Lupa password admin** → ubah `ADMIN_USER`/`ADMIN_PASS` di kode, jalankan fungsi `resetAdminPassword`.
- **Sheet terasa berat setelah banyak ujian** → jalankan fungsi `compactResults` (di luar jam ujian) untuk membersihkan hasil yang sudah direset.
- **Cadangan** → **File → Buat salinan** pada Google Sheets, atau unduh sebagai `.xlsx`. Jangan edit sheet `Master`, `Config`, `Results` secara manual.

## 🩺 Masalah umum

| Gejala | Penyebab / solusi |
|---|---|
| Pojok kiri bawah tertulis **💾 Mode lokal** | `GAS_URL` di `config.js` kosong atau salah |
| **🔴 Offline** padahal internet nyala | Akses deployment belum **Siapa saja**, atau URL bukan yang berakhiran `/exec` |
| "Tidak terhubung ke server, atau server belum memuat Code-Master.gs" | Kode belum ditempel, atau belum dibuat **Versi baru** setelah mengubah kode |
| Perubahan di GitHub belum tampil | Tunggu 1–2 menit lalu muat ulang paksa (`Ctrl+Shift+R`) |
| "Terlalu banyak percobaan" | Salah login 5×, tunggu 10 menit |
| Sesi guru berakhir | Sesi 6 jam, masuk lagi |
| Pendidik tidak muncul di halaman siswa | Guru belum diberi kelas/mapel di tab Guru |

## 🔒 Catatan keamanan

- Password admin disimpan terenkripsi (SHA-256 + salt). Password guru disimpan apa adanya agar admin bisa membagikannya. Pakai password khusus aplikasi ini.
- Token ulangan dikirim ke browser siswa untuk dicocokkan, jadi pengamanannya setara kunci kelas, bukan ujian tingkat tinggi. Ganti token tiap ulangan.
- Jangan membagikan URL `/exec` secara luas selain lewat alamat aplikasi.

## ⚙️ Kuota

Apps Script gratis cukup untuk satu sekolah. Jika puluhan siswa mengumpulkan serentak, hasil dikirim ulang otomatis bila gagal, jadi aman. Untuk ujian ratusan siswa sekaligus, bagi per sesi.
