mod dpapi;
mod profile;
mod vdf;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;
use vdf::Vdf;
use winreg::enums::*;
use winreg::RegKey;

const STEAM_REG: &str = r"Software\Valve\Steam";
const STEAMID64_BASE: u64 = 76561197960265728;
/// Re-check public profile info at most this often (seconds).
const PROFILE_TTL: u64 = 6 * 3600;

// ---------- data model ----------

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct Account {
    pub steamid: String,      // SteamID64
    pub account_name: String, // Steam login name
    pub persona: String,      // Steam display name
    pub nickname: String,     // our custom label
    pub note: String,
    pub tags: Vec<String>,
    pub color: String,
    pub favorite: bool,
    pub last_switch: u64,
    pub timestamp: u64, // steam last-login timestamp
    pub has_token: bool,
    /// Plain token, kept in memory only. Old (v1.0) stores have it on disk; it is
    /// migrated to `token_enc` on first load.
    #[serde(skip_serializing)]
    pub token: String,
    /// DPAPI-encrypted token (base64). Never sent to the UI.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub token_enc: String,

    // public profile (steamcommunity.com XML)
    pub vac_banned: bool,
    pub trade_ban: String,
    pub limited: bool,
    pub privacy: String,
    pub profile_found: bool,
    pub profile_checked: u64,

    // cooldown countdown
    pub cooldown_until: u64,
    pub cooldown_reason: String,

    /// live presence from the public profile: "online", "offline", "in-game"
    pub online_state: String,
    pub game_name: String,

    /// game to start after switching (Steam app id) and its launch options
    pub launch_appid: String,
    pub launch_args: String,

    /// "" (normal), "invisible" or "offline"
    pub login_mode: String,
    /// We set this account to invisible earlier and should restore it.
    pub invisible_applied: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct Status {
    pub steam_found: bool,
    pub steam_path: String,
    pub steam_running: bool,
    pub active_user: String,
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

// ---------- windows helpers ----------

#[cfg(windows)]
fn cmd(prog: &str) -> Command {
    use std::os::windows::process::CommandExt;
    let mut c = Command::new(prog);
    c.creation_flags(0x08000000); // CREATE_NO_WINDOW
    c
}
#[cfg(not(windows))]
fn cmd(prog: &str) -> Command {
    Command::new(prog)
}

fn is_running(image: &str) -> bool {
    let out = cmd("tasklist")
        .args(["/FI", &format!("IMAGENAME eq {image}"), "/NH"])
        .output();
    match out {
        Ok(o) => String::from_utf8_lossy(&o.stdout)
            .to_lowercase()
            .contains(&image.to_lowercase()),
        Err(_) => false,
    }
}

// ---------- steam discovery ----------

fn steam_path() -> Option<PathBuf> {
    // HKCU\Software\Valve\Steam\SteamPath
    if let Ok(k) = RegKey::predef(HKEY_CURRENT_USER).open_subkey(STEAM_REG) {
        if let Ok(p) = k.get_value::<String, _>("SteamPath") {
            let pb = PathBuf::from(p.replace('/', "\\"));
            if pb.exists() {
                return Some(pb);
            }
        }
    }
    // HKLM\SOFTWARE\WOW6432Node\Valve\Steam\InstallPath
    for key in [r"SOFTWARE\WOW6432Node\Valve\Steam", r"SOFTWARE\Valve\Steam"] {
        if let Ok(k) = RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey(key) {
            if let Ok(p) = k.get_value::<String, _>("InstallPath") {
                let pb = PathBuf::from(p);
                if pb.exists() {
                    return Some(pb);
                }
            }
        }
    }
    None
}

fn steam_exe() -> Option<PathBuf> {
    let p = steam_path()?.join("steam.exe");
    if p.exists() {
        Some(p)
    } else {
        Some(steam_path()?.join("Steam.exe"))
    }
}

fn loginusers_path() -> Option<PathBuf> {
    Some(steam_path()?.join("config").join("loginusers.vdf"))
}

fn config_vdf_path() -> Option<PathBuf> {
    Some(steam_path()?.join("config").join("config.vdf"))
}

fn steamid32(steamid64: &str) -> Option<u64> {
    steamid64.parse::<u64>().ok()?.checked_sub(STEAMID64_BASE)
}

fn localconfig_path(steamid64: &str) -> Option<PathBuf> {
    Some(
        steam_path()?
            .join("userdata")
            .join(steamid32(steamid64)?.to_string())
            .join("config")
            .join("localconfig.vdf"),
    )
}

// ---------- our store ----------

static STORE_LOCK: Mutex<()> = Mutex::new(());

fn app_dir() -> PathBuf {
    let mut p = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    p.push("nfa-next");
    let _ = fs::create_dir_all(&p);
    p
}

fn store_path() -> PathBuf {
    app_dir().join("accounts.json")
}

/// Load from disk, decrypt tokens, migrate any plaintext token from v1.0.
fn load_store_raw() -> Vec<Account> {
    let mut list: Vec<Account> = match fs::read_to_string(store_path()) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => Vec::new(),
    };
    let mut migrate = false;
    for a in list.iter_mut() {
        if !a.token.is_empty() && a.token_enc.is_empty() {
            migrate = true; // plaintext from an old version
        } else if !a.token_enc.is_empty() {
            a.token = dpapi::unprotect(&a.token_enc).unwrap_or_default();
        }
    }
    if migrate {
        let _ = save_store_raw(&mut list);
    }
    list
}

/// Encrypt tokens and write. Plain tokens never reach the disk.
fn save_store_raw(list: &mut [Account]) -> Result<(), String> {
    for a in list.iter_mut() {
        if a.token.is_empty() {
            a.token_enc.clear();
        } else if dpapi::unprotect(&a.token_enc).as_deref() != Some(a.token.as_str()) {
            a.token_enc = dpapi::protect(&a.token).ok_or("Could not encrypt the token (DPAPI).")?;
        }
    }
    let s = serde_json::to_string_pretty(list).map_err(|e| e.to_string())?;
    // write to a temp file first so a crash can't leave a half-written store
    let tmp = store_path().with_extension("json.tmp");
    fs::write(&tmp, s).map_err(|e| e.to_string())?;
    fs::rename(&tmp, store_path()).map_err(|e| e.to_string())
}

fn load_store() -> Vec<Account> {
    let _g = STORE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    load_store_raw()
}

/// Load, change and save the store under one lock, so concurrent commands
/// (a running switch, a profile refresh, an edit) can't overwrite each other.
fn modify_store<R>(f: impl FnOnce(&mut Vec<Account>) -> Result<R, String>) -> Result<R, String> {
    let _g = STORE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut list = load_store_raw();
    let r = f(&mut list)?;
    save_store_raw(&mut list)?;
    Ok(r)
}

/// What the UI gets: no secrets.
fn for_ui(mut list: Vec<Account>) -> Vec<Account> {
    for a in list.iter_mut() {
        a.token.clear();
        a.token_enc.clear();
    }
    list
}

// ---------- vdf account ops ----------

fn read_loginusers() -> Result<Vdf, String> {
    let p = loginusers_path().ok_or("Steam not found — is it installed?")?;
    if !p.exists() {
        return Ok(Vdf::Obj(vec![("users".into(), Vdf::Obj(vec![]))]));
    }
    let text = fs::read_to_string(&p).map_err(|e| format!("read loginusers.vdf: {e}"))?;
    vdf::parse(&text)
}

fn write_loginusers(root: &Vdf) -> Result<(), String> {
    let p = loginusers_path().ok_or("Steam not found.")?;
    fs::write(&p, vdf::serialize(root)).map_err(|e| format!("write loginusers.vdf: {e}"))
}

/// Active user from registry AutoLoginUser.
fn active_account_name() -> String {
    RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(STEAM_REG)
        .ok()
        .and_then(|k| k.get_value::<String, _>("AutoLoginUser").ok())
        .unwrap_or_default()
}

fn new_account(steamid: &str, account_name: &str, persona: &str, ts: u64) -> Account {
    Account {
        steamid: steamid.to_string(),
        account_name: account_name.to_string(),
        persona: persona.to_string(),
        color: pick_color(steamid),
        timestamp: ts,
        ..Default::default()
    }
}

// ---------- commands: status & accounts ----------

#[tauri::command]
async fn get_status() -> Status {
    tauri::async_runtime::spawn_blocking(status_impl)
        .await
        .unwrap_or(Status {
            steam_found: false,
            steam_path: String::new(),
            steam_running: false,
            active_user: String::new(),
        })
}

fn status_impl() -> Status {
    let sp = steam_path();
    Status {
        steam_found: sp.is_some(),
        steam_path: sp.map(|p| p.display().to_string()).unwrap_or_default(),
        steam_running: is_running("steam.exe"),
        active_user: active_account_name(),
    }
}

/// Merge accounts Steam remembers (loginusers.vdf) into our store and return it.
#[tauri::command]
fn capture_accounts() -> Result<Vec<Account>, String> {
    let root = read_loginusers()?;
    let list = modify_store(|store| {
        if let Some(users) = root.get("users").and_then(|u| u.obj()) {
            for (steamid, data) in users {
                let account_name = data.get_str("AccountName").unwrap_or("").to_string();
                let persona = data.get_str("PersonaName").unwrap_or("").to_string();
                let ts: u64 = data.get_str("Timestamp").and_then(|s| s.parse().ok()).unwrap_or(0);
                if account_name.is_empty() {
                    continue;
                }
                match store.iter_mut().find(|a| a.steamid == *steamid) {
                    Some(a) => {
                        a.account_name = account_name;
                        if !persona.is_empty() {
                            a.persona = persona;
                        }
                        if ts > 0 {
                            a.timestamp = ts;
                        }
                    }
                    None => store.push(new_account(steamid, &account_name, &persona, ts)),
                }
            }
        }
        Ok(store.clone())
    })?;
    Ok(for_ui(list))
}

#[tauri::command]
fn list_accounts() -> Vec<Account> {
    for_ui(load_store())
}

// ---------- commands: switching ----------

/// Switch Steam to `steamid`: shut down Steam, set auto-login, mark MostRecent, relaunch.
/// `mode` overrides the account's saved login mode for this one switch.
#[tauri::command]
async fn switch_account(steamid: String, mode: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || switch_impl(steamid, mode))
        .await
        .map_err(|e| e.to_string())?
}

fn switch_impl(steamid: String, mode: Option<String>) -> Result<String, String> {
    let acc = load_store()
        .into_iter()
        .find(|a| a.steamid == steamid)
        .ok_or("Account not found.")?;
    if acc.account_name.is_empty() {
        return Err("Account has no Steam login name.".into());
    }
    steam_exe().ok_or("Steam not found — is it installed?")?;
    let mode = mode.unwrap_or_else(|| acc.login_mode.clone());

    stop_steam()?;

    // If this account carries an injected token, make sure config knows the name.
    if acc.has_token && !acc.token.is_empty() {
        let _ = ensure_config_account(&acc.account_name, &acc.steamid);
    }

    // registry: auto login this user
    let (key, _) = RegKey::predef(HKEY_CURRENT_USER)
        .create_subkey(STEAM_REG)
        .map_err(|e| format!("Registry error: {e}"))?;
    key.set_value("AutoLoginUser", &acc.account_name)
        .map_err(|e| format!("Registry write error: {e}"))?;
    key.set_value("RememberPassword", &1u32)
        .map_err(|e| format!("Registry write error: {e}"))?;

    // loginusers.vdf: MostRecent for target, clear others, ensure flags
    let mut root = read_loginusers()?;
    if let Some(users) = root.get_mut("users").and_then(|u| u.obj_mut()) {
        for (sid, data) in users.iter_mut() {
            let target = *sid == steamid;
            data.set_str("MostRecent", if target { "1" } else { "0" });
            if target {
                data.set_str("RememberPassword", "1");
                data.set_str("AllowAutoLogin", "1");
                if mode == "offline" {
                    data.set_str("WantsOfflineMode", "1");
                    data.set_str("SkipOfflineModeWarning", "1");
                } else {
                    data.set_str("WantsOfflineMode", "0");
                }
            }
        }
    }
    write_loginusers(&root)?;

    // friends status: invisible, or undo an invisible we set before
    let mut invisible_applied = acc.invisible_applied;
    if mode == "invisible" {
        let _ = set_persona_state(&steamid, 7);
        invisible_applied = true;
    } else if acc.invisible_applied {
        let _ = set_persona_state(&steamid, 1);
        invisible_applied = false;
    }

    launch_steam()?;
    let mut urls = Vec::new();
    if mode == "invisible" {
        urls.push("steam://friends/status/invisible".to_string());
    }
    if !acc.launch_appid.is_empty() && acc.launch_appid.chars().all(|c| c.is_ascii_digit()) {
        // steam://run/<appid>//<launch options>/
        urls.push(format!("steam://run/{}//{}/", acc.launch_appid, acc.launch_args.trim().replace('/', "")));
    }
    if !urls.is_empty() {
        after_steam_ready(acc.account_name.clone(), urls);
    }

    modify_store(|store| {
        if let Some(a) = store.iter_mut().find(|a| a.steamid == steamid) {
            a.last_switch = now();
            a.invisible_applied = invisible_applied;
        }
        Ok(())
    })?;

    Ok(format!("Switched to {}", display_name(&acc)))
}

/// Set the desired friends status in userdata/<id32>/config/localconfig.vdf.
/// 1 = online, 7 = invisible. Steam must be closed while this runs.
fn set_persona_state(steamid64: &str, state: u8) -> Result<(), String> {
    let p = localconfig_path(steamid64).ok_or("no localconfig path")?;
    if !p.exists() {
        return Ok(()); // never signed in on this PC; the steam:// fallback handles it
    }
    let text = fs::read_to_string(&p).map_err(|e| e.to_string())?;
    let mut root = vdf::parse(&text)?;
    let id32 = steamid32(steamid64).ok_or("bad steamid")?.to_string();
    let store = root.get_mut("UserLocalConfigStore").ok_or("unexpected localconfig layout")?;

    // newer clients: WebStorage/FriendStoreLocalPrefs_<id32> = JSON with ePersonaState
    let key = format!("FriendStoreLocalPrefs_{id32}");
    if store.get("WebStorage").is_none() {
        if let Some(o) = store.obj_mut() {
            o.push(("WebStorage".into(), Vdf::Obj(vec![])));
        }
    }
    if let Some(ws) = store.get_mut("WebStorage") {
        let mut json: serde_json::Value = ws
            .get_str(&key)
            .and_then(|s| serde_json::from_str(s).ok())
            .unwrap_or_else(|| serde_json::json!({ "strNonFriendsAllowedToMsg": "" }));
        if let Some(obj) = json.as_object_mut() {
            obj.insert("ePersonaState".into(), serde_json::json!(state));
        }
        ws.set_str(&key, &json.to_string());
    }
    // older clients: friends/PersonaStateDesired
    if let Some(friends) = store.get_mut("friends") {
        friends.set_str("PersonaStateDesired", &state.to_string());
    }
    fs::write(&p, vdf::serialize(&root)).map_err(|e| e.to_string())
}

/// Once Steam is up, open steam:// URLs (invisible status fallback, game launch).
/// Skipped if the user switched to another account meanwhile.
fn after_steam_ready(account_name: String, urls: Vec<String>) {
    std::thread::spawn(move || {
        for _ in 0..60 {
            if is_running("steamwebhelper.exe") {
                break;
            }
            std::thread::sleep(std::time::Duration::from_secs(1));
        }
        std::thread::sleep(std::time::Duration::from_secs(15));
        for url in urls {
            if !(active_account_name().eq_ignore_ascii_case(&account_name) && is_running("steam.exe")) {
                return;
            }
            // explorer.exe hands the URL to the (non-elevated) Steam
            let _ = cmd("explorer.exe").arg(&url).spawn();
            std::thread::sleep(std::time::Duration::from_secs(3));
        }
    });
}

// ---------- installed games ----------

#[derive(Serialize)]
struct Game {
    appid: String,
    name: String,
}

/// Installed games from every Steam library (steamapps/appmanifest_*.acf).
#[tauri::command]
async fn list_games() -> Vec<Game> {
    tauri::async_runtime::spawn_blocking(|| {
        let Some(sp) = steam_path() else { return vec![] };
        let mut libs = vec![sp.clone()];
        if let Ok(t) = fs::read_to_string(sp.join("steamapps").join("libraryfolders.vdf")) {
            if let Ok(v) = vdf::parse(&t) {
                for (_, lib) in v.get("libraryfolders").and_then(|l| l.obj()).into_iter().flatten() {
                    if let Some(p) = lib.get_str("path") {
                        libs.push(PathBuf::from(p.replace("\\\\", "\\")));
                    }
                }
            }
        }
        let mut games: Vec<Game> = Vec::new();
        for lib in libs {
            let Ok(dir) = fs::read_dir(lib.join("steamapps")) else { continue };
            for e in dir.flatten() {
                let name = e.file_name().to_string_lossy().to_string();
                if !(name.starts_with("appmanifest_") && name.ends_with(".acf")) {
                    continue;
                }
                let Some(v) = fs::read_to_string(e.path()).ok().and_then(|t| vdf::parse(&t).ok()) else { continue };
                let Some(app) = v.get("AppState") else { continue };
                let (Some(id), Some(n)) = (app.get_str("appid"), app.get_str("name")) else { continue };
                // skip redistributables / tools
                if n.contains("Redistributable") || n.starts_with("Steamworks") || n.contains("Proton") {
                    continue;
                }
                if !games.iter().any(|g| g.appid == id) {
                    games.push(Game { appid: id.to_string(), name: n.to_string() });
                }
            }
        }
        games.sort_by_key(|g| g.name.to_lowercase());
        games
    })
    .await
    .unwrap_or_default()
}

// ---------- tray ----------

#[derive(Deserialize)]
struct TrayItem {
    steamid: String,
    label: String,
    active: bool,
}

/// Rebuild the tray menu. The UI sends the (already sorted, translated) entries.
#[tauri::command]
fn refresh_tray(app: AppHandle, items: Vec<TrayItem>, show: String, quit: String) -> Result<(), String> {
    use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
    let menu = Menu::new(&app).map_err(|e| e.to_string())?;
    for it in items.iter().take(20) {
        let item = CheckMenuItem::with_id(&app, format!("sw:{}", it.steamid), &it.label, true, it.active, None::<&str>)
            .map_err(|e| e.to_string())?;
        menu.append(&item).map_err(|e| e.to_string())?;
    }
    if !items.is_empty() {
        menu.append(&PredefinedMenuItem::separator(&app).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    }
    menu.append(&MenuItem::with_id(&app, "show", show, true, None::<&str>).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    menu.append(&MenuItem::with_id(&app, "quit", quit, true, None::<&str>).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    if let Some(tray) = app.tray_by_id("main") {
        tray.set_menu(Some(menu)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn show_main(app: &AppHandle) {
    use tauri::Manager;
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    use tauri::Emitter;
    let mut b = TrayIconBuilder::with_id("main")
        .tooltip("NFA Next")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, e| match e.id().as_ref() {
            "show" => show_main(app),
            "quit" => app.exit(0),
            id => {
                if let Some(sid) = id.strip_prefix("sw:") {
                    let _ = app.emit("tray-switch", sid.to_string());
                }
            }
        })
        .on_tray_icon_event(|tray, e| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        b = b.icon(icon.clone());
    }
    b.build(app)?;
    Ok(())
}

// ---------- autostart (Task Scheduler, so the admin app starts without a UAC prompt) ----------

const TASK_NAME: &str = "NFA Next";

#[tauri::command]
fn get_autostart() -> bool {
    cmd("schtasks").args(["/Query", "/TN", TASK_NAME]).output().map(|o| o.status.success()).unwrap_or(false)
}

#[tauri::command]
fn set_autostart(enabled: bool) -> Result<(), String> {
    let out = if enabled {
        #[cfg(windows)]
        use std::os::windows::process::CommandExt;
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let mut c = cmd("schtasks");
        // raw_arg: schtasks wants the nested quotes exactly like this
        c.args(["/Create", "/F", "/SC", "ONLOGON", "/RL", "HIGHEST", "/TN", TASK_NAME, "/TR"]);
        #[cfg(windows)]
        c.raw_arg(format!("\"\\\"{}\\\" --minimized\"", exe.display()));
        c.output()
    } else {
        cmd("schtasks").args(["/Delete", "/F", "/TN", TASK_NAME]).output()
    }
    .map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

// ---------- commands: token ----------

/// Add an account by a Steam login token (best-effort). Registers it so it can be switched to.
#[tauri::command]
fn add_account_token(token: String, account_name: String, persona: String) -> Result<Account, String> {
    let token = token.trim().to_string();
    if token.is_empty() {
        return Err("Token is empty.".into());
    }
    let steamid = steamid_from_token(&token)
        .ok_or("That token doesn't look like a valid Steam login token.")?;
    let name = if account_name.trim().is_empty() {
        format!("user_{}", &steamid[steamid.len().saturating_sub(6)..])
    } else {
        account_name.trim().to_string()
    };
    let persona = persona.trim().to_string();

    // register in loginusers.vdf
    let mut root = read_loginusers()?;
    {
        let users = root
            .get_mut("users")
            .and_then(|u| u.obj_mut())
            .ok_or("loginusers.vdf is malformed.")?;
        let entry = match users.iter_mut().position(|(sid, _)| *sid == steamid) {
            Some(i) => &mut users[i].1,
            None => {
                users.push((steamid.clone(), Vdf::Obj(vec![])));
                &mut users.last_mut().unwrap().1
            }
        };
        entry.set_str("AccountName", &name);
        if !persona.is_empty() {
            entry.set_str("PersonaName", &persona);
        }
        entry.set_str("RememberPassword", "1");
        entry.set_str("AllowAutoLogin", "1");
        entry.set_str("WantsOfflineMode", "0");
        entry.set_str("SkipOfflineModeWarning", "0");
        entry.set_str("MostRecent", "0");
        entry.set_str("Timestamp", &now().to_string());
    }
    write_loginusers(&root)?;
    let _ = ensure_config_account(&name, &steamid);

    let acc = modify_store(|store| {
        let idx = match store.iter().position(|a| a.steamid == steamid) {
            Some(i) => i,
            None => {
                let mut a = new_account(&steamid, &name, &persona, now());
                a.tags = vec!["Token".into()];
                store.push(a);
                store.len() - 1
            }
        };
        let a = &mut store[idx];
        a.account_name = name.clone();
        a.has_token = true;
        a.token = token.clone();
        if !persona.is_empty() {
            a.persona = persona.clone();
        }
        Ok(a.clone())
    })?;
    Ok(for_ui(vec![acc]).remove(0))
}

// ---------- commands: editing ----------

#[derive(Deserialize)]
pub struct AccountEdit {
    pub steamid: String,
    pub nickname: Option<String>,
    pub note: Option<String>,
    pub tags: Option<Vec<String>>,
    pub color: Option<String>,
    pub favorite: Option<bool>,
    pub cooldown_until: Option<u64>,
    pub cooldown_reason: Option<String>,
    pub login_mode: Option<String>,
    pub launch_appid: Option<String>,
    pub launch_args: Option<String>,
}

#[tauri::command]
fn update_account(edit: AccountEdit) -> Result<(), String> {
    modify_store(|store| {
        let a = store
            .iter_mut()
            .find(|a| a.steamid == edit.steamid)
            .ok_or("Account not found.")?;
        if let Some(v) = edit.nickname {
            a.nickname = v;
        }
        if let Some(v) = edit.note {
            a.note = v;
        }
        if let Some(v) = edit.tags {
            a.tags = v;
        }
        if let Some(v) = edit.color {
            a.color = v;
        }
        if let Some(v) = edit.favorite {
            a.favorite = v;
        }
        if let Some(v) = edit.cooldown_until {
            a.cooldown_until = v;
        }
        if let Some(v) = edit.cooldown_reason {
            a.cooldown_reason = v;
        }
        if let Some(v) = edit.launch_appid {
            a.launch_appid = v.chars().filter(|c| c.is_ascii_digit()).collect();
        }
        if let Some(v) = edit.launch_args {
            a.launch_args = v;
        }
        if let Some(v) = edit.login_mode {
            a.login_mode = match v.as_str() {
                "invisible" | "offline" => v,
                _ => String::new(),
            };
        }
        Ok(())
    })
}

#[tauri::command]
fn remove_account(steamid: String, forget_steam: bool) -> Result<(), String> {
    modify_store(|store| {
        store.retain(|a| a.steamid != steamid);
        Ok(())
    })?;
    let _ = fs::remove_file(profile::avatar_dir().join(format!("{steamid}.jpg")));
    if forget_steam {
        let mut root = read_loginusers()?;
        if let Some(users) = root.get_mut("users").and_then(|u| u.obj_mut()) {
            users.retain(|(sid, _)| *sid != steamid);
        }
        write_loginusers(&root)?;
    }
    Ok(())
}

#[tauri::command]
fn clear_all(forget_steam: bool) -> Result<(), String> {
    modify_store(|store| {
        store.clear();
        Ok(())
    })?;
    if forget_steam {
        let mut root = read_loginusers()?;
        if let Some(users) = root.get_mut("users").and_then(|u| u.obj_mut()) {
            users.clear();
        }
        write_loginusers(&root)?;
    }
    Ok(())
}

// ---------- commands: profiles & avatars ----------

/// steamid -> data: URL. Our downloaded avatar first, then Steam's local avatar cache.
#[tauri::command]
async fn get_avatars() -> HashMap<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let cache = steam_path().map(|p| p.join("config").join("avatarcache"));
        let mut out = HashMap::new();
        for a in load_store() {
            let ours = profile::avatar_dir().join(format!("{}.jpg", a.steamid));
            let url = profile::data_url(&ours).or_else(|| {
                cache.as_ref().and_then(|c| profile::data_url(&c.join(format!("{}.png", a.steamid))))
            });
            if let Some(u) = url {
                out.insert(a.steamid, u);
            }
        }
        out
    })
    .await
    .unwrap_or_default()
}

/// Look up public profile info (bans, privacy, avatar) for accounts that are
/// due, or all of them with `force`. Returns the updated list.
#[tauri::command]
async fn refresh_profiles(force: bool) -> Result<Vec<Account>, String> {
    tauri::async_runtime::spawn_blocking(move || refresh_profiles_impl(force))
        .await
        .map_err(|e| e.to_string())?
}

fn refresh_profiles_impl(force: bool) -> Result<Vec<Account>, String> {
    // presence is live, so every account is fetched; avatars only when stale
    let due: Vec<(String, bool)> = load_store()
        .into_iter()
        .map(|a| {
            let stale = force
                || now().saturating_sub(a.profile_checked) > PROFILE_TTL
                || !profile::avatar_dir().join(format!("{}.jpg", a.steamid)).exists();
            (a.steamid, stale)
        })
        .collect();

    // network work happens outside the store lock
    let mut results: Vec<(String, profile::ProfileInfo)> = Vec::new();
    let mut failures = 0;
    for (i, (sid, stale)) in due.iter().enumerate() {
        if i > 0 {
            std::thread::sleep(std::time::Duration::from_millis(400)); // be polite
        }
        match profile::fetch_profile(sid) {
            Ok(info) => {
                if *stale && info.found && !info.avatar_url.is_empty() {
                    let _ = profile::download_avatar(sid, &info.avatar_url);
                }
                results.push((sid.clone(), info));
            }
            Err(_) => failures += 1,
        }
    }
    if !due.is_empty() && results.is_empty() && failures > 0 {
        return Err("Couldn't reach steamcommunity.com.".into());
    }

    let list = modify_store(|store| {
        for (sid, info) in &results {
            if let Some(a) = store.iter_mut().find(|a| a.steamid == *sid) {
                a.profile_checked = now();
                a.profile_found = info.found;
                a.online_state = info.online_state.clone();
                a.game_name = info.game_name.clone();
                if info.found {
                    a.vac_banned = info.vac_banned;
                    a.trade_ban = info.trade_ban.clone();
                    a.limited = info.limited;
                    a.privacy = info.privacy.clone();
                    if a.persona.is_empty() && !info.persona.is_empty() {
                        a.persona = info.persona.clone();
                    }
                }
            }
        }
        Ok(store.clone())
    })?;
    Ok(for_ui(list))
}

// ---------- commands: backup ----------

#[derive(Serialize, Deserialize)]
struct Backup {
    app: String,
    version: u32,
    exported: u64,
    accounts: Vec<BackupAccount>,
}

/// Everything a user typed, but no tokens: DPAPI blobs only open on this PC anyway.
#[derive(Serialize, Deserialize, Default)]
#[serde(default)]
struct BackupAccount {
    steamid: String,
    account_name: String,
    persona: String,
    nickname: String,
    note: String,
    tags: Vec<String>,
    color: String,
    favorite: bool,
    cooldown_until: u64,
    cooldown_reason: String,
    login_mode: String,
    launch_appid: String,
    launch_args: String,
}

#[derive(Serialize)]
struct ImportResult {
    added: usize,
    updated: usize,
    accounts: Vec<Account>,
}

#[tauri::command]
async fn export_backup(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    tauri::async_runtime::spawn_blocking(move || {
        let date = {
            // yyyy-mm-dd without a date crate
            let days = (now() / 86400) as i64;
            let (y, m, d) = civil_from_days(days);
            format!("{y:04}-{m:02}-{d:02}")
        };
        let Some(path) = app
            .dialog()
            .file()
            .add_filter("JSON", &["json"])
            .set_file_name(format!("nfa-next-backup-{date}.json"))
            .blocking_save_file()
        else {
            return Ok(None);
        };
        let path = path.into_path().map_err(|e| e.to_string())?;
        let backup = Backup {
            app: "nfa-next".into(),
            version: 1,
            exported: now(),
            accounts: load_store()
                .into_iter()
                .map(|a| BackupAccount {
                    steamid: a.steamid,
                    account_name: a.account_name,
                    persona: a.persona,
                    nickname: a.nickname,
                    note: a.note,
                    tags: a.tags,
                    color: a.color,
                    favorite: a.favorite,
                    cooldown_until: a.cooldown_until,
                    cooldown_reason: a.cooldown_reason,
                    login_mode: a.login_mode,
                    launch_appid: a.launch_appid,
                    launch_args: a.launch_args,
                })
                .collect(),
        };
        let s = serde_json::to_string_pretty(&backup).map_err(|e| e.to_string())?;
        fs::write(&path, s).map_err(|e| e.to_string())?;
        Ok(Some(path.display().to_string()))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn import_backup(app: AppHandle) -> Result<Option<ImportResult>, String> {
    use tauri_plugin_dialog::DialogExt;
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = app.dialog().file().add_filter("JSON", &["json"]).blocking_pick_file() else {
            return Ok(None);
        };
        let path = path.into_path().map_err(|e| e.to_string())?;
        let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let backup: Backup = serde_json::from_str(&text).map_err(|_| "This isn't an NFA Next backup file.".to_string())?;
        if backup.app != "nfa-next" {
            return Err("This isn't an NFA Next backup file.".into());
        }
        let r = merge_backup(backup.accounts)?;
        Ok(Some(r))
    })
    .await
    .map_err(|e| e.to_string())?
}

fn merge_backup(items: Vec<BackupAccount>) -> Result<ImportResult, String> {
    let (added, updated, list) = modify_store(|store| {
        let (mut added, mut updated) = (0, 0);
        for b in items {
            if b.steamid.is_empty() || !b.steamid.chars().all(|c| c.is_ascii_digit()) {
                continue;
            }
            let idx = match store.iter().position(|a| a.steamid == b.steamid) {
                Some(i) => {
                    updated += 1;
                    i
                }
                None => {
                    added += 1;
                    store.push(new_account(&b.steamid, &b.account_name, &b.persona, 0));
                    store.len() - 1
                }
            };
            let a = &mut store[idx];
            if a.account_name.is_empty() {
                a.account_name = b.account_name;
            }
            if a.persona.is_empty() {
                a.persona = b.persona;
            }
            a.nickname = b.nickname;
            a.note = b.note;
            a.tags = b.tags;
            if !b.color.is_empty() {
                a.color = b.color;
            }
            a.favorite = b.favorite;
            a.cooldown_until = b.cooldown_until;
            a.cooldown_reason = b.cooldown_reason;
            a.login_mode = b.login_mode;
            a.launch_appid = b.launch_appid;
            a.launch_args = b.launch_args;
        }
        Ok((added, updated, store.clone()))
    })?;
    Ok(ImportResult { added, updated, accounts: for_ui(list) })
}

/// Days since 1970-01-01 -> (year, month, day). Howard Hinnant's algorithm.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719468;
    let era = z.div_euclid(146097);
    let doe = z.rem_euclid(146097);
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    (y, m, d)
}

// ---------- commands: updates ----------

#[derive(Serialize)]
struct UpdateInfo {
    version: String,
    notes: String,
}

#[tauri::command]
async fn check_update(app: AppHandle) -> Result<Option<UpdateInfo>, String> {
    use tauri_plugin_updater::UpdaterExt;
    let update = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?;
    Ok(update.map(|u| UpdateInfo { version: u.version.clone(), notes: u.body.clone().unwrap_or_default() }))
}

#[tauri::command]
async fn install_update(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;
    let update = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or("No update available.")?;
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| e.to_string())?;
    app.restart();
}

// ---------- commands: steam process ----------

#[tauri::command]
async fn stop_steam_cmd() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(stop_steam)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn open_steam() -> Result<(), String> {
    launch_steam()
}

/// Start Steam through explorer.exe so it runs un-elevated even though NFA Next is admin.
fn launch_steam() -> Result<(), String> {
    let exe = steam_exe().ok_or("Steam not found.")?;
    cmd("explorer.exe")
        .arg(&exe)
        .spawn()
        .map_err(|e| format!("Could not start Steam: {e}"))?;
    Ok(())
}

// ---------- internals ----------

fn stop_steam() -> Result<(), String> {
    if let Some(exe) = steam_exe() {
        let _ = cmd(exe.to_string_lossy().as_ref()).arg("-shutdown").spawn();
    }
    // wait up to ~8s for a clean exit
    for _ in 0..16 {
        if !is_running("steam.exe") {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(500));
    }
    if is_running("steam.exe") {
        let _ = cmd("taskkill").args(["/F", "/IM", "steam.exe", "/T"]).output();
    }
    let _ = cmd("taskkill").args(["/F", "/IM", "steamwebhelper.exe", "/T"]).output();
    std::thread::sleep(std::time::Duration::from_millis(700));
    Ok(())
}

/// Ensure config.vdf has the name -> steamid mapping under the Accounts block.
fn ensure_config_account(name: &str, steamid: &str) -> Result<(), String> {
    let p = config_vdf_path().ok_or("Steam not found.")?;
    if !p.exists() {
        return Ok(());
    }
    let text = fs::read_to_string(&p).map_err(|e| format!("read config.vdf: {e}"))?;
    let mut root = vdf::parse(&text)?;
    fn child<'a>(v: &'a mut Vdf, key: &str) -> Option<&'a mut Vdf> {
        v.obj_mut()?
            .iter_mut()
            .find(|(k, _)| k.eq_ignore_ascii_case(key))
            .map(|(_, val)| val)
    }
    let mut cur = &mut root;
    for seg in ["InstallConfigStore", "Software", "Valve", "Steam"] {
        cur = match child(cur, seg) {
            Some(c) => c,
            None => return Ok(()), // unexpected layout; skip quietly
        };
    }
    if child(cur, "Accounts").is_none() {
        if let Some(obj) = cur.obj_mut() {
            obj.push(("Accounts".into(), Vdf::Obj(vec![])));
        }
    }
    if let Some(accounts) = child(cur, "Accounts") {
        if child(accounts, name).is_none() {
            if let Some(obj) = accounts.obj_mut() {
                obj.push((name.to_string(), Vdf::Obj(vec![])));
            }
        }
        if let Some(entry) = child(accounts, name) {
            entry.set_str("SteamID", steamid);
        }
    }
    fs::write(&p, vdf::serialize(&root)).map_err(|e| format!("write config.vdf: {e}"))
}

/// Decode SteamID64 from a Steam JWT login token (middle segment "sub").
fn steamid_from_token(token: &str) -> Option<String> {
    let seg = token.split('.').nth(1)?;
    let bytes = b64url_decode(seg)?;
    let json: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    let sub = json.get("sub")?.as_str()?.to_string();
    if sub.len() >= 10 && sub.chars().all(|c| c.is_ascii_digit()) {
        Some(sub)
    } else {
        None
    }
}

fn b64url_decode(s: &str) -> Option<Vec<u8>> {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    URL_SAFE_NO_PAD.decode(s.trim_end_matches('=')).ok()
}

fn pick_color(seed: &str) -> String {
    const PALETTE: [&str; 8] = [
        "#10b981", "#3b82f6", "#8b5cf6", "#f59e0b", "#ef4444", "#ec4899", "#06b6d4", "#84cc16",
    ];
    let sum: u32 = seed.bytes().map(|b| b as u32).sum();
    PALETTE[(sum as usize) % PALETTE.len()].to_string()
}

fn display_name(a: &Account) -> String {
    if !a.nickname.is_empty() {
        a.nickname.clone()
    } else if !a.persona.is_empty() {
        a.persona.clone()
    } else {
        a.account_name.clone()
    }
}

// ---------- run ----------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            use tauri::Manager;
            build_tray(app.handle())?;
            // started by the logon task: stay in the tray
            if std::env::args().any(|a| a == "--minimized") {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.hide();
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_status,
            capture_accounts,
            list_accounts,
            switch_account,
            add_account_token,
            update_account,
            remove_account,
            clear_all,
            get_avatars,
            refresh_profiles,
            export_backup,
            import_backup,
            check_update,
            install_update,
            list_games,
            refresh_tray,
            get_autostart,
            set_autostart,
            stop_steam_cmd,
            open_steam
        ])
        .run(tauri::generate_context!())
        .expect("error while running NFA Next");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vdf_roundtrip_and_edit() {
        let src = "\"users\"\n{\n\t\"76561198000000001\"\n\t{\n\t\t\"AccountName\"\t\t\"alice\"\n\t\t\"MostRecent\"\t\t\"1\"\n\t}\n\t// comment\n\t\"76561198000000002\"\n\t{\n\t\t\"AccountName\"\t\t\"bo\\\"b\"\n\t}\n}\n";
        let mut v = vdf::parse(src).unwrap();
        let users = v.get_mut("users").unwrap();
        assert_eq!(users.obj().unwrap().len(), 2);
        assert_eq!(users.obj().unwrap()[1].1.get_str("AccountName"), Some("bo\"b"));
        users.obj_mut().unwrap()[1].1.set_str("MostRecent", "1");
        let again = vdf::parse(&vdf::serialize(&v)).unwrap();
        let u2 = &again.get("users").unwrap().obj().unwrap()[1].1;
        assert_eq!(u2.get_str("MostRecent"), Some("1"));
        assert_eq!(u2.get_str("AccountName"), Some("bo\"b"));
    }

    #[test]
    fn vdf_keeps_utf8() {
        let src = "\"users\"\n{\n\t\"1\"\n\t{\n\t\t\"PersonaName\"\t\t\"Türkçe çğıöşü ÇĞİÖŞÜ ✈☃ 🎮\"\n\t}\n}\n";
        let v = vdf::parse(src).unwrap();
        let name = v.get("users").unwrap().get("1").unwrap().get_str("PersonaName").unwrap().to_string();
        assert_eq!(name, "Türkçe çğıöşü ÇĞİÖŞÜ ✈☃ 🎮");
        let again = vdf::parse(&vdf::serialize(&v)).unwrap();
        assert_eq!(again.get("users").unwrap().get("1").unwrap().get_str("PersonaName"), Some(name.as_str()));
    }

    #[test]
    fn vdf_keeps_escapes() {
        let src = "\"a\"\n{\n\t\"j\"\t\t\"{\\\"x\\\":1}\"\n\t\"n\"\t\t\"line1\\nline2\\ttab\"\n}\n";
        let v = vdf::parse(src).unwrap();
        assert_eq!(v.get("a").unwrap().get_str("j"), Some("{\"x\":1}"));
        assert_eq!(vdf::serialize(&v), src);
    }

    #[test]
    fn jwt_sub_decodes() {
        // header.{"sub":"76561198000000001"}.sig (base64url, no padding)
        let tok = "eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiI3NjU2MTE5ODAwMDAwMDAwMSJ9.sig";
        assert_eq!(steamid_from_token(tok).as_deref(), Some("76561198000000001"));
        assert_eq!(steamid_from_token("not.a.token"), None);
        assert_eq!(steamid_from_token("garbage"), None);
    }

    #[test]
    fn steamid_conversion() {
        assert_eq!(steamid32("76561198000000001"), Some(39734273));
        assert_eq!(steamid32("12"), None);
    }

    #[test]
    fn dates() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(20775), (2026, 11, 18));
    }

    #[cfg(windows)]
    #[test]
    fn dpapi_roundtrip() {
        let enc = dpapi::protect("eyJ.secret.token").unwrap();
        assert!(!enc.contains("secret"));
        assert_eq!(dpapi::unprotect(&enc).as_deref(), Some("eyJ.secret.token"));
        assert_eq!(dpapi::unprotect("bm90LWEtYmxvYg=="), None);
    }

    #[test]
    fn token_never_serialized() {
        let a = Account { token: "eyJ.secret".into(), token_enc: "ENC".into(), ..Default::default() };
        let s = serde_json::to_string(&a).unwrap();
        assert!(!s.contains("eyJ.secret"));
        let ui = serde_json::to_string(&for_ui(vec![a])).unwrap();
        assert!(!ui.contains("ENC"));
        // v1.0 files had a plaintext "token" field; it must still load
        let old: Account = serde_json::from_str(r#"{"steamid":"1","account_name":"x","token":"eyJ.old"}"#).unwrap();
        assert_eq!(old.token, "eyJ.old");
    }
}
