"use strict";
// UI strings. Keys missing in a language fall back to English.

const I18N = {
  tr: {
    steamChecking: "Steam kontrol ediliyor…",
    steamMissing: "Steam bulunamadı",
    steamOn: "Steam açık",
    steamOff: "Steam kapalı",
    steamPathMissing: "Steam kurulum yolu bulunamadı",
    minimize: "Küçült", maximize: "Büyüt", close: "Kapat",
    heroTitle: "Hesapların",
    heroSub: "Tek tıkla Steam hesabı değiştir. Şifre yok, bekleme yok.",
    statAccounts: "Hesap", statFav: "Favori", statActive: "Aktif",
    searchPh: "Hesap, takma ad, SteamID veya etiket ara…",
    sortTitle: "Sırala", sortSmart: "Akıllı sıralama", sortRecent: "Son geçilen", sortName: "İsim (A-Z)", sortLogin: "Son giriş",
    capture: "Steam'den yakala", captureTitle: "Steam'in hatırladığı hesapları içe aktar",
    addToken: "Token ile ekle", settings: "Ayarlar",
    emptyTitle: "Henüz hesap yok",
    emptyText: "Steam'e her hesapla bir kez <b>\"Beni hatırla\"</b> işaretli giriş yap,<br/>sonra hepsini tek tıkla içe aktar.",
    footHint: "<kbd>1</kbd>–<kbd>9</kbd> hızlı geçiş · <kbd>Ctrl R</kbd> yenile · <kbd>Esc</kbd> kapat",
    step0: "Steam kapatılıyor", step1: "Otomatik giriş ayarlanıyor", step2: "Steam başlatılıyor",
    switchingTo: "{name} hesabına geçiliyor",
    switched: "Geçildi: {name}",
    steamNotFoundErr: "Steam bulunamadı — kurulu mu?",
    // time
    never: "—", justNow: "az önce", minAgo: "{n} dk önce", hourAgo: "{n} sa önce", dayAgo: "{n} gün önce",
    // chips / cards
    chipAll: "Tümü", chipFav: "★ Favoriler",
    favorite: "Favori", more: "Daha fazla", copyTitle: "Kopyala", lastSwitch: "Son geçiş",
    activeAccount: "Aktif hesap", doSwitch: "Geçiş yap",
    noMatch: "\"{q}\" ile eşleşen hesap yok.",
    // capture
    capturedN: "{n} yeni hesap yakalandı", capturedNone: "Hesaplar güncellendi — yeni hesap yok",
    // edit modal
    editTitle: "Hesabı düzenle", nickname: "Takma ad", note: "Not", notePh: "Örn. ana hesap, 2FA telefonda…",
    tags: "Etiketler", newTagPh: "Yeni etiket yaz + Enter", color: "Renk",
    cancel: "Vazgeç", save: "Kaydet", saved: "Kaydedildi",
    // token modal
    tokenTitle: "Token ile hesap ekle",
    tokenSub: "Steam login token'ını (eyJ… ile başlayan JWT) yapıştır. SteamID otomatik çözülür.",
    tokenLabel: "Login token", loginName: "Kullanıcı adı (login)", loginNamePh: "steam_login_adi",
    personaOpt: "Görünen ad (opsiyonel)", personaPh: "Profil adı",
    tokenWarn: "⚠ Deneysel: Token ile otomatik giriş, Steam istemcisinin token'ı kabul etmesine bağlıdır. En güvenilir yol: hesaba bir kez \"Beni hatırla\" ile giriş yapıp <b>Steam'den yakala</b>.",
    add: "Ekle", added: "Hesap eklendi",
    tokenBad: "✕ Geçerli bir JWT değil", tokenExpiry: " · bitiş: {d}", tokenExpired: " (SÜRESİ DOLMUŞ)",
    // remove
    removeTitle: "Hesabı kaldır", removeSub: "<b>{name}</b> listeden kaldırılacak.",
    forgetSteam: "Steam'in kayıtlı giriş listesinden de sil (loginusers.vdf)",
    remove: "Kaldır", removed: "Hesap kaldırıldı",
    // settings
    steamAt: "Steam: {p}",
    language: "Dil", languageSub: "Arayüz dili",
    startSteam: "Steam'i başlat", startSteamSub: "Son kullanılan hesapla açar", start: "Başlat", steamStarting: "Steam başlatılıyor",
    stopSteam: "Steam'i kapat", stopSteamSub: "Düzgün kapatır, gerekirse zorla", stop: "Kapat", steamStopped: "Steam kapatıldı",
    autoCapture: "Açılışta otomatik yakala", autoCaptureSub: "Yeni Steam girişlerini otomatik listeye ekle",
    clearAll: "Tümünü temizle", clearAllSub: "NFA Next listesini sıfırlar", clear: "Temizle",
    clearConfirm: "Tüm hesapları temizle?", clearConfirmSub: "{n} hesap NFA Next listesinden kaldırılacak.",
    clearForget: "Steam'in kayıtlı giriş listesini de temizle", clearGo: "Hepsini temizle", cleared: "Liste temizlendi",
    closeBtn: "Kapat",
    // menu
    mEdit: "Düzenle", mCopyId: "SteamID kopyala", mCopyName: "Kullanıcı adını kopyala", mProfile: "Steam profilini aç",
    copiedId: "SteamID kopyalandı", copiedName: "Kullanıcı adı kopyalandı", copyFail: "Kopyalanamadı",
  },
  en: {
    steamChecking: "Checking Steam…",
    steamMissing: "Steam not found",
    steamOn: "Steam running",
    steamOff: "Steam closed",
    steamPathMissing: "Steam install path not found",
    minimize: "Minimize", maximize: "Maximize", close: "Close",
    heroTitle: "Your accounts",
    heroSub: "Switch Steam accounts in one click. No passwords, no waiting.",
    statAccounts: "Accounts", statFav: "Favorites", statActive: "Active",
    searchPh: "Search account, nickname, SteamID or tag…",
    sortTitle: "Sort", sortSmart: "Smart order", sortRecent: "Recently switched", sortName: "Name (A-Z)", sortLogin: "Last login",
    capture: "Import from Steam", captureTitle: "Import the accounts Steam remembers",
    addToken: "Add with token", settings: "Settings",
    emptyTitle: "No accounts yet",
    emptyText: "Sign in to Steam once with each account with <b>\"Remember me\"</b> checked,<br/>then import them all in one click.",
    footHint: "<kbd>1</kbd>–<kbd>9</kbd> quick switch · <kbd>Ctrl R</kbd> refresh · <kbd>Esc</kbd> close",
    step0: "Closing Steam", step1: "Setting up auto-login", step2: "Starting Steam",
    switchingTo: "Switching to {name}",
    switched: "Switched to {name}",
    steamNotFoundErr: "Steam not found — is it installed?",
    never: "—", justNow: "just now", minAgo: "{n} min ago", hourAgo: "{n} h ago", dayAgo: "{n} days ago",
    chipAll: "All", chipFav: "★ Favorites",
    favorite: "Favorite", more: "More", copyTitle: "Copy", lastSwitch: "Last switch",
    activeAccount: "Active account", doSwitch: "Switch",
    noMatch: "No accounts match \"{q}\".",
    capturedN: "Imported {n} new account(s)", capturedNone: "Accounts updated — nothing new",
    editTitle: "Edit account", nickname: "Nickname", note: "Note", notePh: "e.g. main account, 2FA on phone…",
    tags: "Tags", newTagPh: "Type a new tag + Enter", color: "Color",
    cancel: "Cancel", save: "Save", saved: "Saved",
    tokenTitle: "Add account with token",
    tokenSub: "Paste a Steam login token (a JWT starting with eyJ…). The SteamID is decoded automatically.",
    tokenLabel: "Login token", loginName: "Username (login)", loginNamePh: "steam_login_name",
    personaOpt: "Display name (optional)", personaPh: "Profile name",
    tokenWarn: "⚠ Experimental: token auto-login depends on the Steam client accepting the token. The most reliable way: sign in once with \"Remember me\" and use <b>Import from Steam</b>.",
    add: "Add", added: "Account added",
    tokenBad: "✕ Not a valid JWT", tokenExpiry: " · expires: {d}", tokenExpired: " (EXPIRED)",
    removeTitle: "Remove account", removeSub: "<b>{name}</b> will be removed from the list.",
    forgetSteam: "Also remove it from Steam's saved logins (loginusers.vdf)",
    remove: "Remove", removed: "Account removed",
    steamAt: "Steam: {p}",
    language: "Language", languageSub: "Interface language",
    startSteam: "Start Steam", startSteamSub: "Opens with the last used account", start: "Start", steamStarting: "Starting Steam",
    stopSteam: "Close Steam", stopSteamSub: "Shuts down cleanly, forces if needed", stop: "Close", steamStopped: "Steam closed",
    autoCapture: "Import on startup", autoCaptureSub: "Add new Steam logins to the list automatically",
    clearAll: "Clear everything", clearAllSub: "Resets the NFA Next list", clear: "Clear",
    clearConfirm: "Clear all accounts?", clearConfirmSub: "{n} account(s) will be removed from the NFA Next list.",
    clearForget: "Also clear Steam's saved logins", clearGo: "Clear all", cleared: "List cleared",
    closeBtn: "Close",
    mEdit: "Edit", mCopyId: "Copy SteamID", mCopyName: "Copy username", mProfile: "Open Steam profile",
    copiedId: "SteamID copied", copiedName: "Username copied", copyFail: "Couldn't copy",
  },
};

const LANGS = { tr: "Türkçe", en: "English" };

function detectLang() {
  try {
    const saved = localStorage.getItem("lang");
    if (saved && I18N[saved]) return saved;
  } catch (_) { /* storage blocked */ }
  return (navigator.language || "").toLowerCase().startsWith("tr") ? "tr" : "en";
}

let LANG = detectLang();
const locale = () => (LANG === "tr" ? "tr-TR" : "en-US");

/** t("key", {n: 3}) — {var} placeholders; falls back to English, then the key itself. */
function t(key, vars) {
  let s = I18N[LANG][key] ?? I18N.en[key] ?? key;
  if (vars) for (const k in vars) s = s.split(`{${k}}`).join(vars[k]);
  return s;
}

/** Fill every element tagged with data-i18n* attributes. */
function applyStatic() {
  document.documentElement.lang = LANG;
  document.querySelectorAll("[data-i18n]").forEach((el) => (el.textContent = t(el.dataset.i18n)));
  document.querySelectorAll("[data-i18n-html]").forEach((el) => (el.innerHTML = t(el.dataset.i18nHtml)));
  document.querySelectorAll("[data-i18n-ph]").forEach((el) => (el.placeholder = t(el.dataset.i18nPh)));
  document.querySelectorAll("[data-i18n-title]").forEach((el) => (el.title = t(el.dataset.i18nTitle)));
}

function setLang(l) {
  if (!I18N[l]) return;
  LANG = l;
  try { localStorage.setItem("lang", l); } catch (_) { /* storage blocked */ }
  applyStatic();
}
