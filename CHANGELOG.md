# Changelog

## 1.2.0

### New
- **Live status** on every card: online, offline or "In game: Counter-Strike 2", from the public profile (no API key), refreshed every 3 minutes.
- **Tray icon** with a quick-switch menu. Optional: close to tray, hide after switching.
- **Start with Windows** in the tray, without an admin prompt (uses a logon task).
- **Launch a game after switching**, picked from your installed games, with launch options.
- **Command palette** (`Ctrl+K`): search accounts and commands; `Shift+Enter` switches invisible.
- **Streamer mode**: blurs names, SteamIDs, notes and photos. Can turn on by itself while OBS Studio runs.
- **Drag & drop ordering** with a new "My order" sort.
- **List view** for many accounts.
- **Accent color**, **interface size** (90–125%) and **reduce motion** settings.
- **Settings search** and grouped settings.
- **Desktop shortcuts** per account, **`nfa://switch/<SteamID>` links** and a **command line** (`--switch <id|login|nickname> [--mode invisible|offline|normal]`).
- Copy profile link and friend code.

## 1.1.0

### New
- **Profile photos** on every card, from Steam's local avatar cache and the public profile.
- **Ban badges**: VAC ban, trade ban, limited account and private profile, read from the public Steam profile (no API key). A "Clean" badge shows when nothing is found.
- **Cooldown countdown**: quick presets (30 min, 2 h, 1 day, 7 days) or an exact date, with an optional reason. A notice appears when it ends.
- **Invisible and offline sign-in**, saved per account or chosen once from the right-click menu.
- **Backup / restore** of nicknames, notes, tags, colors, cooldowns and sign-in modes (tokens are never exported).
- **Auto-update**: the installed app checks GitHub for a signed update on startup.
- Filter chips for accounts on cooldown and banned accounts.

### Security
- Tokens are now encrypted with Windows DPAPI. Plain-text tokens from 1.0.0 are encrypted automatically on first start.
- Tokens are no longer sent to the UI layer.
- The account list is written atomically and guarded against concurrent writes.
- Releases are built by GitHub Actions.

### Fixed
- VDF writer now re-escapes newlines and tabs it decoded.

## 1.0.0

First release: one-click switching, import from Steam, add with token, nicknames, notes, tags, colors, favorites, search, keyboard shortcuts, English and Turkish.
