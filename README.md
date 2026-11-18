<p align="center">
  <img src="src-tauri/icons/128x128.png" width="96" alt="NFA Next logo" />
</p>

<h1 align="center">NFA Next</h1>

<p align="center">
  A fast, good-looking Steam account switcher for Windows.<br/>
  One click to switch accounts — no passwords, no re-typing Steam Guard codes.
</p>

<p align="center">
  <a href="../../releases/latest"><b>Download</b></a> ·
  <a href="#features">Features</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#building-from-source">Build</a> ·
  <a href="#türkçe">Türkçe</a>
</p>

---

## Features

- **One-click switching** — closes Steam cleanly, sets auto-login, starts Steam signed in as the chosen account.
- **Import from Steam** — picks up every account Steam already remembers. No passwords or tokens needed.
- **Add with token** *(experimental)* — paste a Steam login token (JWT); the SteamID and expiry date are decoded live.
- **Organize** — nicknames, notes, tags (Main, Smurf, Prime, …), colors and favorites.
- **Find fast** — search across names, SteamIDs, notes and tags; filter by tag; four sort modes.
- **Keyboard first** — `1`–`9` quick switch, `Ctrl+F` search, `Ctrl+R` refresh, `Enter` / double-click to switch.
- **Live status** — see whether Steam is running and which account is active.
- **English & Turkish** — picks your system language, switchable in Settings.
- **Safe by default** — Steam is started un-elevated, and nothing is sent anywhere: no telemetry, no external servers.

## Install

1. Download `NFA-Next_x64-setup.exe` (installer) or `NFA-Next-portable.exe` from the [latest release](../../releases/latest).
2. Run it and accept the administrator prompt.

> Windows SmartScreen may warn on first launch because the executable is not code-signed. Click **More info → Run anyway**, or build it yourself from source.

Requires Windows 10/11 with [WebView2](https://developer.microsoft.com/microsoft-edge/webview2/) (preinstalled on Windows 11).

## How it works

For each account, sign in to Steam once with **Remember me** checked. Steam keeps that session. Then click **Import from Steam**.

When you switch, NFA Next:

1. Shuts Steam down (`steam.exe -shutdown`, forced only if it does not exit in ~8 s).
2. Writes `AutoLoginUser` and `RememberPassword` under `HKCU\Software\Valve\Steam`.
3. Marks the account as `MostRecent` / `AllowAutoLogin` in `Steam\config\loginusers.vdf`.
4. Starts Steam again through `explorer.exe`, so Steam does **not** inherit administrator rights.

NFA Next keeps its own list (nicknames, tags, notes) in `%APPDATA%\nfa-next\accounts.json`.

> **Keep that file private.** Tokens added with *Add with token* are stored in it as plain text.

### Why administrator?

The app asks for elevation on launch so it can reliably stop Steam and write Steam's config files. Steam itself is always started with normal user rights.

## Building from source

Prerequisites: [Rust](https://rustup.rs/) (stable), [Node.js](https://nodejs.org/) 18+, and the [Tauri prerequisites for Windows](https://tauri.app/start/prerequisites/).

```bash
npm install
npx tauri build
```

Output:

- `src-tauri/target/release/nfa-next.exe`
- `src-tauri/target/release/bundle/nsis/*-setup.exe`

Run the backend tests:

```bash
cd src-tauri && cargo test --lib
```

### Project layout

```
src/                 UI (plain HTML/CSS/JS, no bundler)
  i18n.js            English + Turkish strings
src-tauri/src/
  lib.rs             Tauri commands: import, switch, token, registry
  vdf.rs             Minimal Valve KeyValues (VDF) parser / writer
src-tauri/app.manifest  requireAdministrator manifest
```

Adding a language: copy the `en` block in `src/i18n.js`, translate it, and add the code to `LANGS`.

## Disclaimer

NFA Next is an independent project and is not affiliated with, endorsed by, or connected to Valve Corporation or Steam. Use at your own risk.

## License

[MIT](LICENSE)

---

## Türkçe

**NFA Next**, Windows için hızlı ve şık bir Steam hesap değiştiricidir. Tek tıkla hesap değiştirir; şifre ya da Steam Guard kodu girmen gerekmez.

**Kurulum:** [Son sürümden](../../releases/latest) `NFA-Next_x64-setup.exe` (kurulum) ya da `NFA-Next-portable.exe` (kurulumsuz) dosyasını indirip çalıştır. Açılışta yönetici iznini onayla.

**Kullanım:**

1. Her hesapla Steam'e bir kez **"Beni hatırla"** işaretli giriş yap.
2. **Steam'den yakala** butonuna bas; hesapların listeye gelir.
3. Bir karta tıkla, ya da `1`–`9` tuşlarıyla hızlıca geç.

**Özellikler:** takma ad, not, etiket, renk ve favori; arama ve filtreleme; klavye kısayolları; canlı Steam durumu; Türkçe / İngilizce arayüz.

**Gizlilik:** Hiçbir veri dışarı gönderilmez. Hesap listen `%APPDATA%\nfa-next\accounts.json` dosyasında durur. Token ile eklediğin hesapların token'ları bu dosyada düz metin olarak saklanır, bu dosyayı kimseyle paylaşma.

Bu proje Valve veya Steam ile bağlantılı değildir.
