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
  <a href="#privacy">Privacy</a> ·
  <a href="#building-from-source">Build</a> ·
  <a href="#türkçe">Türkçe</a>
</p>

---

## Features

- **One-click switching** — closes Steam cleanly, sets auto-login, starts Steam signed in as the chosen account.
- **Invisible or offline sign-in** — per account, or one-off from the right-click menu.
- **Real profile photos** — from Steam's own avatar cache, refreshed from the public profile.
- **Ban badges** — VAC ban, trade ban, limited account and private profile at a glance, read from the public Steam profile (no API key).
- **Cooldown timers** — set "ends in 2 h" or an exact date on an account and watch the countdown on its card; you get a notice when it ends.
- **Import from Steam** — picks up every account Steam already remembers. No passwords or tokens needed.
- **Add with token** *(experimental)* — paste a Steam login token (JWT); the SteamID and expiry date are decoded live.
- **Encrypted tokens** — tokens are stored with Windows DPAPI, so only your Windows account on this PC can read them.
- **Backup / restore** — export nicknames, notes, tags, colors, cooldowns and sign-in modes to a JSON file and load them on another PC.
- **Auto-update** — installed copies find, verify (signed) and install new releases.
- **Organize** — nicknames, notes, tags (Main, Smurf, Prime, …), colors and favorites; filter by tag, cooldown or ban.
- **Keyboard first** — `1`–`9` quick switch, `Ctrl+F` search, `Ctrl+R` refresh, `Enter` / double-click to switch.
- **English & Turkish** — picks your system language, switchable in Settings.

## Install

1. Download the `…_x64-setup.exe` installer (recommended, updates itself) or `NFA-Next-portable.exe` from the [latest release](../../releases/latest).
2. Run it and accept the administrator prompt.

> Windows SmartScreen may warn on first launch because the executable is not code-signed. Click **More info → Run anyway**, or build it yourself from source.

Requires Windows 10/11 with [WebView2](https://developer.microsoft.com/microsoft-edge/webview2/) (preinstalled on Windows 11).

Releases are built by [GitHub Actions](.github/workflows/release.yml) from the tagged source, not on anyone's PC.

## How it works

For each account, sign in to Steam once with **Remember me** checked. Steam keeps that session. Then click **Import from Steam**.

When you switch, NFA Next:

1. Shuts Steam down (`steam.exe -shutdown`, forced only if it does not exit in ~8 s).
2. Writes `AutoLoginUser` and `RememberPassword` under `HKCU\Software\Valve\Steam`.
3. Marks the account as `MostRecent` / `AllowAutoLogin` in `Steam\config\loginusers.vdf` (plus `WantsOfflineMode` for offline sign-in).
4. For invisible sign-in, sets the friends status in `Steam\userdata\<id>\config\localconfig.vdf`, and once Steam is up sends `steam://friends/status/invisible` as a fallback.
5. Starts Steam again through `explorer.exe`, so Steam does **not** inherit administrator rights.

NFA Next keeps its own list in `%APPDATA%\nfa-next\accounts.json` and downloaded profile photos in `%APPDATA%\nfa-next\avatars\`.

### Why administrator?

The app asks for elevation on launch so it can reliably stop Steam and write Steam's config files. Steam itself is always started with normal user rights.

## Privacy

- No telemetry, no accounts, no third-party servers.
- **Online profile info** (on by default, can be turned off in Settings) requests `steamcommunity.com/profiles/<SteamID>?xml=1` for each account at most every 6 hours, and downloads the profile photo from Steam's image servers.
- **Update check** (can be turned off in Settings) downloads `latest.json` from this repository's releases. Updates are verified against the public key in `tauri.conf.json` before installing.
- Backups never contain tokens.

## Building from source

Prerequisites: [Rust](https://rustup.rs/) (stable), [Node.js](https://nodejs.org/) 18+, and the [Tauri prerequisites for Windows](https://tauri.app/start/prerequisites/).

```bash
npm install
npx tauri build
```

The updater needs a signing key. For a local build either set `TAURI_SIGNING_PRIVATE_KEY` to your own key (`npx tauri signer generate`) and replace `plugins.updater.pubkey`, or set `bundle.createUpdaterArtifacts` to `false`.

Output:

- `src-tauri/target/release/nfa-next.exe`
- `src-tauri/target/release/bundle/nsis/*-setup.exe`

Run the backend tests:

```bash
cd src-tauri && cargo test --lib
```

### Releasing

Bump the version in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`, add a `CHANGELOG.md` entry, then push a tag:

```bash
git tag v1.2.0 && git push origin v1.2.0
```

The workflow needs the repository secret `TAURI_SIGNING_PRIVATE_KEY` (and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` if the key has a password).

### Project layout

```
src/                 UI (plain HTML/CSS/JS, no bundler)
  i18n.js            English + Turkish strings
src-tauri/src/
  lib.rs             Tauri commands: import, switch, token, backup, updates
  profile.rs         Public profile lookup (bans, avatar)
  dpapi.rs           Token encryption (Windows DPAPI)
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

**Kurulum:** [Son sürümden](../../releases/latest) `…_x64-setup.exe` (kurulum, kendini günceller) ya da `NFA-Next-portable.exe` (kurulumsuz) dosyasını indirip çalıştır. Açılışta yönetici iznini onayla.

**Kullanım:**

1. Her hesapla Steam'e bir kez **"Beni hatırla"** işaretli giriş yap.
2. **Steam'den yakala** butonuna bas; hesapların listeye gelir.
3. Bir karta tıkla, ya da `1`–`9` tuşlarıyla hızlıca geç. Sağ tıkla **görünmez** ya da **çevrimdışı** geçebilirsin.

**Özellikler:** gerçek profil fotoğrafları; VAC / takas yasağı, kısıtlı hesap ve gizli profil rozetleri; bekleme süresi geri sayımı; görünmez ve çevrimdışı giriş; Windows şifrelemesiyle (DPAPI) saklanan token'lar; yedekle / geri yükle; otomatik güncelleme; takma ad, not, etiket, renk ve favori; arama ve filtreleme; klavye kısayolları; Türkçe / İngilizce arayüz.

**Gizlilik:** Telemetri yok. Uygulama yalnızca iki yere bağlanır, ikisi de Ayarlar'dan kapatılabilir: profil fotoğrafı ve ban durumu için `steamcommunity.com`, yeni sürüm kontrolü için bu deponun GitHub sürümleri. Hesap listen `%APPDATA%\nfa-next\accounts.json` dosyasında durur; yedek dosyalarına token'lar girmez.

Bu proje Valve veya Steam ile bağlantılı değildir.
