//! Public Steam profile lookups (no API key) and avatar files.
//!
//! Uses https://steamcommunity.com/profiles/<id>?xml=1, which returns the
//! profile avatar, privacy state, VAC ban flag, trade ban state and limited flag.

use std::fs;
use std::io::Read;
use std::path::PathBuf;
use std::time::Duration;

#[derive(Debug, Default, Clone, PartialEq)]
pub struct ProfileInfo {
    pub found: bool,
    pub persona: String,
    pub vac_banned: bool,
    pub trade_ban: String,
    pub limited: bool,
    pub privacy: String,
    pub avatar_url: String,
    /// "online", "offline" or "in-game"
    pub online_state: String,
    pub game_name: String,
}

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(10))
        .user_agent("NFA-Next")
        .build()
}

/// Text between <tag> and </tag>, with CDATA unwrapped. First match wins,
/// which is the profile's own value (group entries come later in the document).
pub fn xml_tag(xml: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let start = xml.find(&open)? + open.len();
    let end = xml[start..].find(&close)? + start;
    let mut v = xml[start..end].trim();
    if let Some(inner) = v.strip_prefix("<![CDATA[") {
        v = inner.strip_suffix("]]>").unwrap_or(inner);
    }
    Some(v.trim().to_string())
}

pub fn parse_profile_xml(xml: &str) -> ProfileInfo {
    if xml_tag(xml, "error").is_some() || xml_tag(xml, "steamID64").is_none() {
        return ProfileInfo::default();
    }
    let flag = |t: &str| xml_tag(xml, t).map(|v| v == "1").unwrap_or(false);
    ProfileInfo {
        found: true,
        persona: xml_tag(xml, "steamID").unwrap_or_default(),
        vac_banned: flag("vacBanned"),
        trade_ban: xml_tag(xml, "tradeBanState").unwrap_or_default(),
        limited: flag("isLimitedAccount"),
        privacy: xml_tag(xml, "privacyState").unwrap_or_default(),
        avatar_url: xml_tag(xml, "avatarFull").unwrap_or_default(),
        online_state: xml_tag(xml, "onlineState").unwrap_or_default(),
        game_name: xml_tag(xml, "inGameInfo")
            .and_then(|g| xml_tag(&g, "gameName"))
            .unwrap_or_default(),
    }
}

pub fn fetch_profile(steamid: &str) -> Result<ProfileInfo, String> {
    if !steamid.chars().all(|c| c.is_ascii_digit()) {
        return Err("bad steamid".into());
    }
    let url = format!("https://steamcommunity.com/profiles/{steamid}?xml=1");
    let body = agent()
        .get(&url)
        .call()
        .map_err(|e| e.to_string())?
        .into_string()
        .map_err(|e| e.to_string())?;
    Ok(parse_profile_xml(&body))
}

/// Only download avatars from Steam's own image hosts.
fn allowed_avatar_url(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://") else { return false };
    let host = rest.split('/').next().unwrap_or("").to_ascii_lowercase();
    ["steamstatic.com", "akamaihd.net", "steamcommunity.com"]
        .iter()
        .any(|d| host == *d || host.ends_with(&format!(".{d}")))
}

pub fn avatar_dir() -> PathBuf {
    let mut p = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    p.push("nfa-next");
    p.push("avatars");
    let _ = fs::create_dir_all(&p);
    p
}

pub fn download_avatar(steamid: &str, url: &str) -> Result<(), String> {
    if !allowed_avatar_url(url) {
        return Err("avatar host not allowed".into());
    }
    let resp = agent().get(url).call().map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    resp.into_reader()
        .take(2 * 1024 * 1024)
        .read_to_end(&mut buf)
        .map_err(|e| e.to_string())?;
    if buf.len() < 64 {
        return Err("avatar too small".into());
    }
    fs::write(avatar_dir().join(format!("{steamid}.jpg")), buf).map_err(|e| e.to_string())
}

/// Turn an image file into a data: URL for the webview.
pub fn data_url(path: &PathBuf) -> Option<String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let bytes = fs::read(path).ok()?;
    if bytes.is_empty() || bytes.len() > 4 * 1024 * 1024 {
        return None;
    }
    let mime = if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        "image/png"
    } else if bytes.starts_with(b"GIF") {
        "image/gif"
    } else {
        "image/jpeg"
    };
    Some(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_profile_xml() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<profile>
	<steamID64>76561198000000001</steamID64>
	<steamID><![CDATA[Ünlü Oyuncu]]></steamID>
	<privacyState>public</privacyState>
	<onlineState>in-game</onlineState>
	<inGameInfo><gameName><![CDATA[Counter-Strike 2]]></gameName></inGameInfo>
	<vacBanned>1</vacBanned>
	<tradeBanState>None</tradeBanState>
	<isLimitedAccount>0</isLimitedAccount>
	<avatarFull><![CDATA[https://avatars.steamstatic.com/abc_full.jpg]]></avatarFull>
	<groups><group><avatarFull><![CDATA[https://example.com/x.jpg]]></avatarFull></group></groups>
</profile>"#;
        let p = parse_profile_xml(xml);
        assert!(p.found);
        assert_eq!(p.persona, "Ünlü Oyuncu");
        assert!(p.vac_banned);
        assert!(!p.limited);
        assert_eq!(p.trade_ban, "None");
        assert_eq!(p.privacy, "public");
        assert_eq!(p.avatar_url, "https://avatars.steamstatic.com/abc_full.jpg");
        assert_eq!(p.online_state, "in-game");
        assert_eq!(p.game_name, "Counter-Strike 2");
    }

    #[test]
    fn missing_profile_is_not_found() {
        let xml = "<response><error><![CDATA[The specified profile could not be found.]]></error></response>";
        assert!(!parse_profile_xml(xml).found);
    }

    #[test]
    fn avatar_host_allowlist() {
        assert!(allowed_avatar_url("https://avatars.steamstatic.com/a_full.jpg"));
        assert!(allowed_avatar_url("https://steamcdn-a.akamaihd.net/a.jpg"));
        assert!(!allowed_avatar_url("http://avatars.steamstatic.com/a.jpg"));
        assert!(!allowed_avatar_url("https://evil.com/steamstatic.com/a.jpg"));
        assert!(!allowed_avatar_url("https://steamstatic.com.evil.com/a.jpg"));
    }
}
