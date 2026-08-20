# Revo Print Shop — GitHub Development

This project is developed from the `Quick-Print-PDF` repository.

## Windows build

Local:

```bat
npm install
npm run dist
```

The output is placed in `release/`.

GitHub Actions builds automatically when a tag matching `v*` is pushed. The workflow produces both NSIS installer and portable EXE artifacts.

## Important security rules

Never commit QZ Tray private keys, local identity folders, `.env` secrets, generated EXEs, or `cloudflared.exe`.
