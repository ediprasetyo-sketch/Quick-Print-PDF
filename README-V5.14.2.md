# Revo Print Shop V5.14.2 — QZ Tray Self-Signed Provisioning Fix

V5.14.2 memperbaiki provisioning QZ Tray untuk penggunaan lokal tanpa membeli certificate/support QZ.

## Perubahan penting

V5.14.1 membuat satu self-signed certificate lalu mencoba memasukkannya ke `allowed.dat`. Pada QZ Tray 2.2.x, deployment certificate self-signed lebih tepat menggunakan **trusted root override** dan certificate signing yang diterbitkan oleh root tersebut.

V5.14.2 membuat dua tingkat certificate:

- `revo-qz-root.crt` — self-signed root CA lokal.
- `digital-certificate.txt` — leaf/signing certificate Revo Print Shop yang ditandatangani oleh root.
- `private-key.pem` — private key leaf untuk signing request.
- `revo-qz-root-key.pem` — private key root, tetap lokal dan tidak digunakan oleh renderer.

Setup kemudian:

1. Menyalin root certificate menjadi `C:\Program Files\QZ Tray\override.crt`.
2. Menulis `authcert.override=override.crt` ke `qz-tray.properties` jika file tersebut tersedia.
3. Menambahkan leaf certificate ke `allowed.dat` sebagai fallback.
4. Me-restart QZ Tray.
5. Aplikasi memakai `setCertificatePromise()` dan `setSignaturePromise()` untuk signed requests.

QZ Tray 2.2.5+ mendokumentasikan CA provisioning untuk custom/self-signed root dan `authcert.override`; QZ Tray juga mendukung `--allow` untuk certificate allow-list. Lihat dokumentasi QZ untuk detail: https://qz.io/docs/provisioning dan https://qz.io/docs/command-line.

## Instalasi

Pastikan QZ Tray 2.2.6 sudah terpasang.

Jalankan:

```bat
install-and-run.bat
```

`setup-qz-trust.bat` akan meminta hak Administrator karena perlu menulis `override.crt` dan konfigurasi QZ Tray di Program Files.

Jika hanya ingin memperbaiki trust tanpa menjalankan aplikasi:

```bat
setup-qz-trust.bat
```

## Verifikasi

Setelah setup berhasil, jalankan Revo Print Shop dan lihat status:

`◉ QZ Tray terhubung`

Dialog `Untrusted website` seharusnya tidak muncul.

Jika dialog tetap muncul, tutup semua instance QZ Tray terlebih dahulu dan jalankan `setup-qz-trust.bat` lagi sebagai Administrator. File `qz-trust.log` berisi output command `--allow`.

## Keamanan

Private key hanya disimpan pada komputer print shop di:

`%APPDATA%\revo-print-shop\qz-identity\`

Jangan upload atau membagikan folder tersebut. QR upload tidak pernah menerima private key.


## Revision 2 - Invalid Signature fix
QZ Tray 2.1+ is explicitly configured to verify SHA512, matching the Electron RSA-SHA512 signature. The fallback signing certificate is an end-entity certificate rather than a CA.

## Build fix V5.14.2

Electron Builder configuration is stored in `electron-builder.yml`. This avoids schema ambiguity from `package.json` and is compatible with current electron-builder releases. Run `build-windows-release.bat` on Windows.
