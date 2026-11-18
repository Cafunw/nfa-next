mod vdf;

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};
use vdf::Vdf;
use winreg::enums::*;
use winreg::RegKey;

const STEAM_REG: &str = r"Software\Valve\Steam";

// ---------- data model ----------

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Account {
    pub steamid: String,      // SteamID64
    pub account_name: String, // Steam login name
    #[serde(default)]
    pub persona: String, // Steam display name
    #[serde(default)]
    pub nickname: String, // our custom label
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub color: String,
    #[serde(default)]
    pub favorite: bool,
    #[serde(default)]
    pub last_switch: u64,
    #[serde(default)]
    pub timestamp: u64, // steam last-login timestamp
    #[serde(default)]
    pub has_token: bool,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub token: String,
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
    for key in [
        r"SOFTWARE\WOW6432Node\Valve\Steam",
        r"SOFTWARE\Valve\Steam",
    ] {
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

// ---------- our store ----------

fn store_path() -> PathBuf {
    let mut p = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    p.push("nfa-next");
    let _ = fs::create_dir_all(&p);
    p.push("accounts.json");
    p
}

fn load_store() -> Vec<Account> {
    match fs::read_to_string(store_path()) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

fn save_store(list: &[Account]) -> Result<(), String> {
    let s = serde_json::to_string_pretty(list).map_err(|e| e.to_string())?;
    fs::write(store_path(), s).map_err(|e| e.to_string())
}

// ---------- vdf account ops ----------

fn read_loginusers() -> Result<Vdf, String> {
    let p = loginusers_path().ok_or("Steam not found — is it installed?")?;
    if !p.exists() {
        // empty users root
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

// ---------- commands ----------

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
    let mut store = load_store();

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
                None => store.push(Account {
                    steamid: steamid.clone(),
                    account_name: account_name.clone(),
                    persona,
                    nickname: String::new(),
                    note: String::new(),
                    tags: vec![],
                    color: pick_color(steamid),
                    favorite: false,
                    last_switch: 0,
                    timestamp: ts,
                    has_token: false,
                    token: String::new(),
                }),
            }
        }
    }
    save_store(&store)?;
    Ok(store)
}

#[tauri::command]
fn list_accounts() -> Vec<Account> {
    load_store()
}

/// Switch Steam to `steamid`: shut down Steam, set auto-login, mark MostRecent, relaunch.
#[tauri::command]
async fn switch_account(steamid: String) -> Result<String, String> {
    // blocking work (shutdown wait, file + registry IO) off the UI thread
    tauri::async_runtime::spawn_blocking(move || switch_impl(steamid))
        .await
        .map_err(|e| e.to_string())?
}

fn switch_impl(steamid: String) -> Result<String, String> {
    let mut store = load_store();
    let acc = store
        .iter()
        .find(|a| a.steamid == steamid)
        .cloned()
        .ok_or("Account not found.")?;
    if acc.account_name.is_empty() {
        return Err("Account has no Steam login name.".into());
    }
    steam_exe().ok_or("Steam not found — is it installed?")?;

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
            let most = if *sid == steamid { "1" } else { "0" };
            data.set_str("MostRecent", most);
            if *sid == steamid {
                data.set_str("RememberPassword", "1");
                data.set_str("AllowAutoLogin", "1");
            }
        }
    }
    write_loginusers(&root)?;

    // relaunch steam
    launch_steam()?;

    // record
    if let Some(a) = store.iter_mut().find(|a| a.steamid == steamid) {
        a.last_switch = now();
    }
    save_store(&store)?;

    Ok(format!("Switched to {}", display_name(&acc)))
}

/// Add an account by a Steam login token (best-effort). Registers it so it can be switched to.
#[tauri::command]
fn add_account_token(
    token: String,
    account_name: String,
    persona: String,
) -> Result<Account, String> {
    let token = token.trim().to_string();
    if token.is_empty() {
        return Err("Token is empty.".into());
    }
    // derive steamid from the JWT payload (sub)
    let steamid = steamid_from_token(&token)
        .ok_or("That token doesn't look like a valid Steam login token.")?;

    let name = if account_name.trim().is_empty() {
        format!("user_{}", &steamid[steamid.len().saturating_sub(6)..])
    } else {
        account_name.trim().to_string()
    };

    // register in loginusers.vdf
    let mut root = read_loginusers()?;
    {
        let users = root
            .get_mut("users")
            .and_then(|u| u.obj_mut())
            .ok_or("loginusers.vdf is malformed.")?;
        let entry = match users.iter_mut().find(|(sid, _)| *sid == steamid) {
            Some((_, v)) => v,
            None => {
                users.push((steamid.clone(), Vdf::Obj(vec![])));
                &mut users.last_mut().unwrap().1
            }
        };
        entry.set_str("AccountName", &name);
        if !persona.trim().is_empty() {
            entry.set_str("PersonaName", persona.trim());
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

    // save into our store
    let mut store = load_store();
    let acc = Account {
        steamid: steamid.clone(),
        account_name: name.clone(),
        persona: persona.trim().to_string(),
        nickname: String::new(),
        note: String::new(),
        tags: vec!["Token".into()],
        color: pick_color(&steamid),
        favorite: false,
        last_switch: 0,
        timestamp: now(),
        has_token: true,
        token,
    };
    match store.iter_mut().find(|a| a.steamid == steamid) {
        Some(a) => {
            a.account_name = acc.account_name.clone();
            a.has_token = true;
            a.token = acc.token.clone();
            if !acc.persona.is_empty() {
                a.persona = acc.persona.clone();
            }
        }
        None => store.push(acc.clone()),
    }
    save_store(&store)?;
    Ok(acc)
}

#[derive(Deserialize)]
pub struct AccountEdit {
    pub steamid: String,
    pub nickname: Option<String>,
    pub note: Option<String>,
    pub tags: Option<Vec<String>>,
    pub color: Option<String>,
    pub favorite: Option<bool>,
}

#[tauri::command]
fn update_account(edit: AccountEdit) -> Result<(), String> {
    let mut store = load_store();
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
    save_store(&store)
}

#[tauri::command]
fn remove_account(steamid: String, forget_steam: bool) -> Result<(), String> {
    let mut store = load_store();
    store.retain(|a| a.steamid != steamid);
    save_store(&store)?;
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
    save_store(&[])?;
    if forget_steam {
        let mut root = read_loginusers()?;
        if let Some(users) = root.get_mut("users").and_then(|u| u.obj_mut()) {
            users.clear();
        }
        write_loginusers(&root)?;
    }
    Ok(())
}

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
        let _ = cmd(exe.to_string_lossy().as_ref())
            .arg("-shutdown")
            .spawn();
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
    let _ = cmd("taskkill")
        .args(["/F", "/IM", "steamwebhelper.exe", "/T"])
        .output();
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
    // navigate InstallConfigStore/Software/Valve/Steam/Accounts
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
    // Accounts block
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
    const T: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut lut = [255u8; 256];
    for (i, &c) in T.iter().enumerate() {
        lut[c as usize] = i as u8;
    }
    let mut out = Vec::new();
    let mut buf = 0u32;
    let mut bits = 0u32;
    for &c in s.as_bytes() {
        if c == b'=' {
            break;
        }
        let v = lut[c as usize];
        if v == 255 {
            return None;
        }
        buf = (buf << 6) | v as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
        }
    }
    Some(out)
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
        .invoke_handler(tauri::generate_handler![
            get_status,
            capture_accounts,
            list_accounts,
            switch_account,
            add_account_token,
            update_account,
            remove_account,
            clear_all,
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
    fn jwt_sub_decodes() {
        // header.{"sub":"76561198000000001"}.sig (base64url, no padding)
        let tok = "eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiI3NjU2MTE5ODAwMDAwMDAwMSJ9.sig";
        assert_eq!(steamid_from_token(tok).as_deref(), Some("76561198000000001"));
        assert_eq!(steamid_from_token("not.a.token"), None);
        assert_eq!(steamid_from_token("garbage"), None);
    }
}
