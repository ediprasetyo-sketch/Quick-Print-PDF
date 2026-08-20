# Revo Print Shop V5.14.2

V5.9 menambahkan **QR Upload melalui Internet**. QR tidak lagi dibatasi satu Wi-Fi/LAN. HP pelanggan dapat menggunakan 4G/5G atau Wi-Fi lain untuk mengirim PDF ke komputer print shop.

## Cara kerja
1. Klik **QR Upload**.
2. Aplikasi membuat server upload lokal sementara.
3. Aplikasi menjalankan **Cloudflare Quick Tunnel** (`cloudflared`) ke server tersebut.
4. QR berisi URL `https://....trycloudflare.com/u/<token>`.
5. Pelanggan scan QR dari HP, pilih PDF, lalu upload.
6. PDF masuk sebagai **print job** dengan nomor seperti `RP-1001` dan otomatis dibuka di preview desktop.

Cloudflare Tunnel dipakai sebagai reverse tunnel sehingga port komputer tidak perlu dibuka ke internet. Quick Tunnel menggunakan URL publik sementara; untuk URL/domain permanen sebaiknya gunakan named tunnel milik toko.

## Persiapan Windows
Jalankan:

```bat
setup-internet-qr.bat
```

Script mengunduh `cloudflared 2026.7.0` dari release resmi Cloudflare dan memverifikasi SHA-256 sebelum digunakan.

Lalu:

```bat
npm install
npm start
```

Atau gunakan:

```bat
install-and-run.bat
```

## Build EXE

```bat
build-windows.bat
```

Script akan menyiapkan `cloudflared.exe` terlebih dahulu. Electron Builder memasukkannya sebagai extra resource ke aplikasi.

## Keamanan
- Token upload acak 48 karakter.
- Token hanya aktif selama QR Upload dibuka.
- QR ditutup → tunnel dan server upload dihentikan.
- Hanya PDF yang diterima.
- Batas upload 50 MB.
- File upload disimpan sementara di folder temp Windows.
- Job memiliki ID unik.
- Jangan membagikan QR ke publik jika QR tersebut sedang aktif di meja toko.

## Catatan internet
Quick Tunnel adalah URL publik sementara. URL dapat berubah setiap kali QR Upload dimulai. Ini cocok untuk kebutuhan print shop tanpa konfigurasi domain. Untuk operasional permanen dengan domain sendiri, gunakan **Cloudflare Named Tunnel** dan hostname seperti `upload.tokocetak.com`.

## Dependency eksternal
`cloudflared` adalah client Cloudflare Tunnel dan didistribusikan oleh Cloudflare. V5.9 tidak mematikan Windows Firewall atau membuka port router secara otomatis.


## V5.9 — QR Internet gratis tanpa domain

V5.9 menggunakan Cloudflare Quick Tunnel (`trycloudflare.com`) untuk membuat URL HTTPS publik sementara tanpa domain dan tanpa membuka port router. Quick Tunnel tidak memerlukan akun Cloudflare atau DNS domain, tetapi URL berubah ketika tunnel dibuat ulang dan Cloudflare menyatakan Quick Tunnel ditujukan untuk testing/development, bukan production.

### Alur
1. Jalankan Revo Print Shop.
2. Klik **QR Upload**.
3. Aplikasi membuat server upload lokal + Cloudflare Quick Tunnel.
4. QR menampilkan URL `https://...trycloudflare.com`.
5. Pelanggan scan dari 4G/5G atau Wi-Fi lain.
6. PDF masuk sebagai **Print Job** dan otomatis dibuka di preview desktop.
7. Tutup QR Upload untuk menghentikan server dan tunnel.

### Catatan
- Maksimum upload: 50 MB.
- Hanya PDF.
- Gunakan Quick Tunnel ini untuk tahap uji/demo. Untuk penggunaan toko permanen, pindahkan ke Named Tunnel + domain.
- Jangan membagikan URL/QR publik di tempat yang tidak dimaksudkan karena siapa pun yang memiliki URL sementara dapat mengakses halaman upload selama tunnel aktif.


V5.11: fixed landscape printing by removing the duplicate Chromium landscape transform; the generated PDF page size now controls orientation.


## V5.14.1 QZ Tray local trust
Run `setup-qz-trust.bat` once after installing QZ Tray. It creates a per-PC self-signed signing certificate, stores the private key under the current user's AppData, configures `QZ_OPTS=-Dauthcert.override=...`, restarts QZ Tray, and enables signed print requests. The private key is never exposed to the renderer or QR upload server.


## QZ Tray trust fix

V5.14.1 provisions the local self-signed certificate by adding it to QZ Tray's `allowed.dat` using the official `--allow` command. This is preferred over setting `authcert.override` for this use case because the application certificate is explicitly allowed by QZ Tray.

Run `setup-qz-trust.bat` once as the same Windows user that will run Revo Print Shop. The script stops QZ Tray, adds the certificate to the user's allowed list, then restarts QZ Tray.


## GitHub Actions

Pushing a version tag such as `v5.14.2` runs `.github/workflows/build-windows.yml` on a Windows runner and produces the NSIS installer and portable EXE as workflow artifacts.
