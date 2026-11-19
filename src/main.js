"use strict";

const T = window.__TAURI__;
const invoke = T.core.invoke;
const appWin = T.window.getCurrentWindow();
const $ = (s) => document.querySelector(s);

const TAG_COLORS = {
  Main: "#10b981", Smurf: "#8b5cf6", Prime: "#f59e0b", Farm: "#06b6d4",
  Trade: "#ec4899", VAC: "#ef4444", Token: "#3b82f6", Alt: "#84cc16",
};
const PALETTE = ["#10b981", "#3b82f6", "#8b5cf6", "#f59e0b", "#ef4444", "#ec4899", "#06b6d4", "#84cc16"];

const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* storage blocked */ } },
};

const state = {
  accounts: [],
  status: { steam_found: false, steam_path: "", steam_running: false, active_user: "" },
  query: "",
  filter: "all",
  sort: store.get("sort") || "smart",
  switching: false,
  avatars: {},
  update: null,
  view: store.get("view") || "grid",
};

// ---------- helpers ----------
const now = () => Math.floor(Date.now() / 1000);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nameOf = (a) => a.nickname || a.persona || a.account_name;
const initials = (a) => {
  const n = nameOf(a).replace(/[^\p{L}\p{N} ]/gu, " ").trim();
  const parts = n.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || "?") + (parts[1]?.[0] || parts[0]?.[1] || "")).toLocaleUpperCase(locale());
};
const isActive = (a) => a.account_name && a.account_name.toLowerCase() === (state.status.active_user || "").toLowerCase();
const onCooldown = (a) => a.cooldown_until > now();
const isBanned = (a) => a.vac_banned || (a.trade_ban && a.trade_ban !== "None");
const onlineLookups = () => store.get("onlineLookups") !== "0";
const closeToTray = () => store.get("closeToTray") !== "0";
const streamerOn = () => store.get("streamer") === "1" || (store.get("streamerAuto") === "1" && state.status.obs_running);
// names that go into toasts / overlay, which streamer-mode CSS can't blur
const shownName = (a) => (streamerOn() ? t("hiddenName") : nameOf(a));
const ACCENTS = ["#10b981", "#3b82f6", "#8b5cf6", "#ec4899", "#f59e0b", "#ef4444", "#06b6d4"];

/** Apply appearance settings (accent, scale, motion, streamer mode, view). */
function applyLook() {
  const r = document.documentElement;
  r.style.setProperty("--accent", store.get("accent") || ACCENTS[0]);
  r.style.zoom = (+store.get("scale") || 100) / 100;
  r.classList.toggle("reduce-motion", store.get("reduceMotion") === "1");
  r.classList.toggle("streamer", !!streamerOn());
  $("#streamerBadge").hidden = !streamerOn();
  $("#grid").classList.toggle("list", state.view === "list");
}
function toggleView() { state.view = state.view === "list" ? "grid" : "list"; store.set("view", state.view); applyLook(); render(); }
function toggleStreamer() {
  const on = store.get("streamer") !== "1";
  store.set("streamer", on ? "1" : "0"); applyLook(); render();
  toast(t(on ? "streamerOnMsg" : "streamerOffMsg"), "info");
}
const fmtDate = (ts) => new Date(ts * 1000).toLocaleDateString(locale());
function ago(ts) {
  if (!ts) return t("never");
  const s = now() - ts;
  if (s < 60) return t("justNow");
  if (s < 3600) return t("minAgo", { n: Math.floor(s / 60) });
  if (s < 86400) return t("hourAgo", { n: Math.floor(s / 3600) });
  if (s < 86400 * 30) return t("dayAgo", { n: Math.floor(s / 86400) });
  return fmtDate(ts);
}
function fmtLeft(sec) {
  if (sec <= 0) return t("cdDone");
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (d > 0) return t("cdDays", { d, h });
  const p = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}
const ICON = {
  star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
  bolt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="m5 12 5 5 9-10"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><path d="M12 8h.01M11 12h1v5h1"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.4 5.2A9.7 9.7 0 0 1 12 5c5 0 9 5 10 7a17 17 0 0 1-3.2 4M6.2 6.2C4 7.7 2.6 10 2 12c1 2 5 7 10 7a9.6 9.6 0 0 0 5.8-1.8"/></svg>',
  plane: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12.6a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M2 9a15 15 0 0 1 20 0M12 20h.01"/><path d="M3 3l18 18"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
};

// ---------- toasts ----------
function toast(msg, type = "ok") {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="ic">${type === "ok" ? ICON.check : type === "err" ? ICON.x : ICON.info}</span><span>${esc(msg)}</span>`;
  $("#toasts").appendChild(el);
  setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 260); }, type === "err" ? 5200 : 3000);
}

// ---------- data ----------
async function refreshStatus() {
  try { state.status = await invoke("get_status"); } catch (_) { /* keep last */ }
  renderStatus();
}
async function loadAccounts() {
  try { state.accounts = await invoke("list_accounts"); } catch (e) { toast(String(e), "err"); }
  render();
}
async function loadAvatars() {
  try { state.avatars = await invoke("get_avatars"); render(); } catch (_) { /* letters stay */ }
}
async function capture(silent = false) {
  try {
    const before = state.accounts.length;
    state.accounts = await invoke("capture_accounts");
    const added = state.accounts.length - before;
    if (!silent) toast(added > 0 ? t("capturedN", { n: added }) : t("capturedNone"), added > 0 ? "ok" : "info");
    render();
    if (added > 0) { loadAvatars(); refreshProfiles(); }
  } catch (e) { if (!silent) toast(String(e), "err"); }
}
async function update(steamid, patch) {
  try {
    await invoke("update_account", { edit: { steamid, ...patch } });
    Object.assign(state.accounts.find((a) => a.steamid === steamid) || {}, patch);
    render();
  } catch (e) { toast(String(e), "err"); }
}
// Which accounts will Steam sign in without a password? Local files only, no switching.
async function checkLogins() {
  const btn = $("#btnCheck");
  btn.disabled = true;
  try {
    state.accounts = await invoke("check_logins");
    checkModal(state.accounts);
  } catch (e) { toast(String(e), "err"); }
  btn.disabled = false;
}
function checkModal(list) {
  const need = list.filter((a) => a.login_state === "password").length;
  const why = { not_remembered: "pwNotRemembered", no_saved_login: "pwNoSaved", expired: "pwExpired", not_in_steam: "pwNotInSteam" };
  const rows = list.map((a) => {
    const s = a.login_state;
    const chip = s === "ok" ? `<span class="badge ok">${ICON.check} ${esc(t("signedIn"))}</span>`
      : s === "password" ? `<span class="badge warn">${ICON.info} ${esc(t("needsPassword"))}</span>`
      : `<span class="badge dim">${esc(t("chkUnknown"))}</span>`;
    const sub = s === "ok" ? t("chkValidUntil", { d: a.login_expires ? new Date(a.login_expires * 1000).toLocaleDateString(locale()) : "?" })
      : s === "password" ? t(why[a.login_reason] || "pwNoSaved") : t("pwUnreadable");
    return `<div class="chk-row"><div class="chk-who"><b>${esc(shownName(a))}</b><small>@${esc(a.account_name)}</small></div><div class="chk-st">${chip}<small>${esc(sub)}</small></div></div>`;
  }).join("");
  openModal(`
    <h2>${esc(t("checkLogins"))}</h2>
    <p class="sub">${esc(need ? t("checkNeedN", { n: need }) : t("checkAllOk"))}</p>
    <div class="chk-list">${rows}</div>
    <p class="hint" style="margin-top:12px">${esc(t("checkLimit"))}</p>
    <div class="modal-actions"><button class="btn ghost" data-close>${esc(t("closeBtn"))}</button></div>`);
}
let refreshing = false, avatarsFetched = false;
async function refreshProfiles(force = false) {
  if (!onlineLookups() || !state.accounts.length || refreshing) return;
  refreshing = true;
  try {
    state.accounts = await invoke("refresh_profiles", { force });
    // avatars only change on the first pass or a forced refresh
    if (force || !avatarsFetched) { avatarsFetched = true; await loadAvatars(); } else render();
    if (force) toast(t("profilesRefreshed"));
  } catch (e) { if (force) toast(String(e), "err"); }
  refreshing = false;
}

// ---------- updates ----------
async function checkUpdate(manual = false) {
  try {
    state.update = await invoke("check_update");
    if (state.update) showUpdateBar();
    else if (manual) toast(t("upToDate"), "info");
  } catch (e) { if (manual) toast(t("updateCheckFail", { e: String(e) }), "err"); }
}
function showUpdateBar() {
  const bar = $("#updateBar");
  bar.innerHTML = `<span class="upd-ic">${ICON.bolt}</span><span class="upd-text">${esc(t("updateAvailable", { v: state.update.version }))}</span>
    <button class="btn primary sm" id="updGo">${esc(t("updateNow"))}</button>
    <button class="upd-x" id="updX" title="${esc(t("close"))}">${ICON.x}</button>`;
  bar.hidden = false;
  $("#updX").onclick = () => (bar.hidden = true);
  $("#updGo").onclick = async (e) => {
    const b = e.currentTarget;
    b.disabled = true; b.textContent = t("updating");
    try { await invoke("install_update"); } catch (err) { toast(String(err), "err"); b.disabled = false; b.textContent = t("updateNow"); }
  };
}

// ---------- rendering ----------
function renderStatus() {
  const s = state.status, pill = $("#steamPill");
  pill.className = "steam-pill " + (!s.steam_found ? "missing" : s.steam_running ? "on" : "off");
  $("#steamText").innerHTML = !s.steam_found ? esc(t("steamMissing"))
    : s.steam_running ? `${esc(t("steamOn"))}${s.active_user ? ` · <b>${esc(s.active_user)}</b>` : ""}`
    : esc(t("steamOff"));
  $("#footPath").textContent = s.steam_path || t("steamPathMissing");
  applyLook();
  const act = state.accounts.find(isActive);
  $("#statActive").textContent = act ? nameOf(act) : (s.active_user || "—");
  // refresh active highlight without full re-render
  document.querySelectorAll(".card").forEach((c) => {
    const a = state.accounts.find((x) => x.steamid === c.dataset.id);
    if (a) c.classList.toggle("active", isActive(a));
  });
}

function visibleAccounts(all = false) {
  const q = all ? "" : state.query.trim().toLocaleLowerCase(locale());
  const list = state.accounts.filter((a) => {
    if (all) return true;
    if (state.filter === "fav" && !a.favorite) return false;
    if (state.filter === "cd" && !onCooldown(a)) return false;
    if (state.filter === "ban" && !isBanned(a)) return false;
    if (state.filter.startsWith("tag:") && !a.tags.includes(state.filter.slice(4))) return false;
    if (!q) return true;
    return [a.nickname, a.persona, a.account_name, a.steamid, a.note, a.cooldown_reason, ...a.tags].join(" ").toLocaleLowerCase(locale()).includes(q);
  });
  const cmp = (x, y) => nameOf(x).localeCompare(nameOf(y), locale());
  const by = {
    name: cmp,
    recent: (x, y) => y.last_switch - x.last_switch,
    login: (x, y) => y.timestamp - x.timestamp,
    custom: (x, y) => ((x.sort_order || 1e9) - (y.sort_order || 1e9)) || cmp(x, y),
    smart: (x, y) => (isActive(y) - isActive(x)) || (y.favorite - x.favorite) || (onCooldown(x) - onCooldown(y)) || (y.last_switch - x.last_switch) || cmp(x, y),
  }[state.sort] || cmp;
  return list.sort(by);
}

function renderChips() {
  const tags = {};
  state.accounts.forEach((a) => a.tags.forEach((tg) => (tags[tg] = (tags[tg] || 0) + 1)));
  const favs = state.accounts.filter((a) => a.favorite).length;
  const cds = state.accounts.filter(onCooldown).length, bans = state.accounts.filter(isBanned).length;
  const chips = [["all", t("chipAll"), state.accounts.length], ["fav", t("chipFav"), favs],
    ...(cds ? [["cd", t("chipCd"), cds]] : []), ...(bans ? [["ban", t("chipBan"), bans]] : []),
    ...Object.entries(tags).sort().map(([tg, n]) => [`tag:${tg}`, tg, n])];
  if (!chips.some(([k]) => k === state.filter)) state.filter = "all";
  $("#chips").innerHTML = chips.map(([k, label, n]) =>
    `<button class="chip ${state.filter === k ? "active" : ""}" data-filter="${esc(k)}">${esc(label)}<span class="n">${n}</span></button>`).join("");
}

function avatarHTML(a, extra = "") {
  const img = state.avatars[a.steamid];
  const inner = img ? `<img src="${esc(img)}" alt="" draggable="false"/>` : esc(initials(a));
  return `<div class="avatar ${img ? "has-img" : ""}" style="--c:${esc(a.color || "#10b981")}">${inner}${extra}</div>`;
}

function badgesHTML(a) {
  const b = [];
  if (a.vac_banned) b.push(`<span class="badge bad" title="${esc(t("vacTitle"))}">${ICON.shield} VAC</span>`);
  if (a.trade_ban && a.trade_ban !== "None") b.push(`<span class="badge bad" title="${esc(t("tradeTitle", { s: a.trade_ban }))}">${esc(t("tradeBan"))}</span>`);
  if (a.limited) b.push(`<span class="badge warn" title="${esc(t("limitedTitle"))}">${esc(t("limited"))}</span>`);
  if (a.privacy && a.privacy !== "public") b.push(`<span class="badge dim" title="${esc(t("privacyTitle", { s: a.privacy }))}">${esc(t("private"))}</span>`);
  if (a.profile_checked && a.profile_found && !b.length) b.push(`<span class="badge ok" title="${esc(t("cleanTitle", { d: ago(a.profile_checked) }))}">${ICON.shield} ${esc(t("clean"))}</span>`);
  if (a.login_mode === "invisible") b.push(`<span class="badge mode" title="${esc(t("modeInvisibleSub"))}">${ICON.eye} ${esc(t("modeInvisible"))}</span>`);
  if (a.login_mode === "offline") b.push(`<span class="badge mode" title="${esc(t("modeOfflineSub"))}">${ICON.plane} ${esc(t("modeOffline"))}</span>`);
  return b.length ? `<div class="badges">${b.join("")}</div>` : "";
}

function presenceHTML(a) {
  if (!onlineLookups() || !a.online_state) return "";
  const st = a.online_state === "in-game" ? "in-game" : a.online_state === "online" ? "online" : "offline";
  const label = st === "in-game" ? (a.game_name ? t("inGameNamed", { g: a.game_name }) : t("inGame")) : t(st === "online" ? "presOnline" : "presOffline");
  return `<div class="presence ${st}" title="${esc(t("presenceTitle"))}"><i></i><span>${esc(label)}</span></div>`;
}

function cooldownHTML(a) {
  if (!onCooldown(a)) return "";
  const until = new Date(a.cooldown_until * 1000).toLocaleString(locale());
  return `<div class="cooldown" title="${esc(t("cdUntil", { d: until }))}">
    ${ICON.clock}<span class="cd-reason">${esc(a.cooldown_reason || t("cooldown"))}</span><b class="cd" data-until="${a.cooldown_until}">${esc(fmtLeft(a.cooldown_until - now()))}</b></div>`;
}

function cardHTML(a, i) {
  const active = isActive(a);
  const tags = a.tags.map((tg) => `<span class="tag" style="--tc:${TAG_COLORS[tg] || esc(a.color)}">${esc(tg)}</span>`).join("");
  return `
  <article class="card ${active ? "active" : ""} ${onCooldown(a) ? "on-cd" : ""}" data-id="${esc(a.steamid)}" tabindex="0" draggable="true" style="--c:${esc(a.color || "#10b981")};animation-delay:${Math.min(i, 12) * 30}ms">
    ${i < 9 ? `<span class="quick">${i + 1}</span>` : ""}
    <div class="card-top">
      ${avatarHTML(a, active ? '<span class="online"></span>' : "")}
      <div class="who">
        <div class="name" title="${esc(nameOf(a))}">${esc(nameOf(a))}</div>
        <div class="login">@${esc(a.account_name)}</div>
        ${presenceHTML(a)}
      </div>
      <button class="star ${a.favorite ? "on" : ""}" data-act="fav" title="${esc(t("favorite"))}">${ICON.star}</button>
      <button class="more" data-act="menu" title="${esc(t("more"))}">${ICON.more}</button>
    </div>
    ${badgesHTML(a)}
    <div class="meta">
      <div class="copy" data-act="copy" title="${esc(t("copyTitle"))}"><small>SteamID64</small><span>${esc(a.steamid)}</span></div>
      <div><small>${esc(t("lastSwitch"))}</small><span>${esc(ago(a.last_switch))}</span></div>
    </div>
    ${cooldownHTML(a)}
    ${a.note ? `<div class="note">${esc(a.note)}</div>` : ""}
    ${tags ? `<div class="tags">${tags}</div>` : ""}
    <div class="card-bottom">
      <button class="btn primary switch-btn" data-act="switch">${active ? ICON.check + " " + esc(t("activeAccount")) : ICON.bolt + " " + esc(t("doSwitch"))}</button>
    </div>
  </article>`;
}

function render() {
  renderChips();
  const list = visibleAccounts();
  const empty = state.accounts.length === 0;
  $("#empty").hidden = !empty;
  $("#grid").hidden = empty;
  $("#grid").innerHTML = list.length || empty ? list.map(cardHTML).join("")
    : `<p style="color:var(--muted);grid-column:1/-1;text-align:center;padding:40px">${esc(t("noMatch", { q: state.query }))}</p>`;
  $("#statTotal").textContent = state.accounts.length;
  $("#statFav").textContent = state.accounts.filter((a) => a.favorite).length;
  renderStatus();
  syncTray();
}

// tray menu mirrors the list; only rebuilt when it actually changes
let traySig = "";
function syncTray() {
  const items = visibleAccounts(true).map((a) => ({ steamid: a.steamid, label: nameOf(a) + (a.login_mode ? ` (${t(a.login_mode === "invisible" ? "modeInvisible" : "modeOffline")})` : ""), active: !!isActive(a) }));
  const sig = JSON.stringify([items, LANG]);
  if (sig === traySig) return;
  traySig = sig;
  invoke("refresh_tray", { items, show: t("trayShow"), quit: t("trayQuit") }).catch(() => {});
}

// ---------- switching ----------
async function switchTo(steamid, mode) {
  const a = state.accounts.find((x) => x.steamid === steamid);
  if (!a || state.switching) return;
  if (!state.status.steam_found) return toast(t("steamNotFoundErr"), "err");
  state.switching = true;
  const ov = $("#switchOverlay"), steps = [...document.querySelectorAll("#switchSteps li")];
  const m = mode ?? a.login_mode;
  $("#switchAvatar").innerHTML = avatarHTML(a);
  $("#switchTitle").textContent = t(m === "invisible" ? "switchingInvisible" : m === "offline" ? "switchingOffline" : "switchingTo", { name: shownName(a) });
  steps.forEach((s) => (s.className = ""));
  ov.hidden = false;

  let step = 0;
  const mark = (n) => steps.forEach((s, i) => (s.className = i < n ? "done" : i === n ? "doing" : ""));
  mark(0);
  // backend does it all in one call; advance the visual steps while it runs
  const timer = setInterval(() => { if (step < 1) mark(++step); }, 2200);
  try {
    await invoke("switch_account", { steamid, mode: mode ?? null });
    clearInterval(timer);
    mark(2);
    await new Promise((r) => setTimeout(r, 700));
    mark(3);
    a.last_switch = now();
    state.status.active_user = a.account_name;
    toast(t("switched", { name: shownName(a) }), "ok");
    if (onCooldown(a)) toast(t("cdStill", { left: fmtLeft(a.cooldown_until - now()) }), "info");
    if (store.get("hideAfterSwitch") === "1") appWin.hide();
    await new Promise((r) => setTimeout(r, 350));
  } catch (e) {
    clearInterval(timer);
    toast(String(e), "err");
  } finally {
    ov.hidden = true;
    state.switching = false;
    render();
    setTimeout(refreshStatus, 2500);
  }
}

// ---------- modals ----------
function openModal(html, onMount) {
  $("#modal").innerHTML = html;
  $("#modalBackdrop").hidden = false;
  onMount?.($("#modal"));
  setTimeout(() => $("#modal").querySelector("input:not([type=checkbox]):not([type=datetime-local]),textarea")?.focus(), 30);
}
const closeModal = () => { $("#modalBackdrop").hidden = true; $("#modal").innerHTML = ""; };

function editModal(a) {
  let color = a.color;
  let mode = a.login_mode || "";
  const tags = new Set(a.tags);
  const allTags = [...new Set([...Object.keys(TAG_COLORS), ...state.accounts.flatMap((x) => x.tags)])];
  const modes = [["", "modeNormal"], ["invisible", "modeInvisible"], ["offline", "modeOffline"]];
  const presets = [[1800, "cd30m"], [7200, "cd2h"], [86400, "cd1d"], [604800, "cd7d"]];
  openModal(`
    <h2>${esc(t("editTitle"))}</h2>
    <p class="sub">@${esc(a.account_name)} · ${esc(a.steamid)}</p>
    <div class="field"><label>${esc(t("nickname"))}</label><input id="fNick" maxlength="40" placeholder="${esc(a.persona || a.account_name)}" value="${esc(a.nickname)}"/></div>
    <div class="field"><label>${esc(t("note"))}</label><textarea id="fNote" maxlength="300" placeholder="${esc(t("notePh"))}" style="font-family:var(--font);font-size:13px">${esc(a.note)}</textarea></div>
    <div class="field"><label>${esc(t("tags"))}</label>
      <div class="tag-picker" id="fTags">${allTags.map((tg) => `<span class="tag ${tags.has(tg) ? "on" : ""}" data-t="${esc(tg)}" style="--tc:${TAG_COLORS[tg] || "#8b96a5"}">${esc(tg)}</span>`).join("")}</div>
      <input id="fNewTag" maxlength="16" placeholder="${esc(t("newTagPh"))}" style="margin-top:6px"/>
    </div>
    <div class="field"><label>${esc(t("loginMode"))}</label>
      <div class="seg wide" id="fMode">${modes.map(([k, l]) => `<button class="${mode === k ? "on" : ""}" data-m="${k}">${esc(t(l))}</button>`).join("")}</div>
      <span class="hint" id="fModeHint"></span></div>
    <div class="field"><label>${esc(t("launchGame"))}</label>
      <div class="row"><select id="fGame" class="select"><option value="">${esc(t("launchNone"))}</option>${a.launch_appid ? `<option value="${esc(a.launch_appid)}" selected>${esc(a.launch_appid)}</option>` : ""}</select>
      <input id="fArgs" maxlength="200" spellcheck="false" placeholder="${esc(t("launchArgsPh"))}" value="${esc(a.launch_args)}"/></div>
      <span class="hint">${esc(t("launchHint"))}</span></div>
    <div class="field"><label>${esc(t("cooldown"))}</label>
      <div class="cd-presets" id="fCdPresets">${presets.map(([s, l]) => `<button class="chip" data-s="${s}">${esc(t(l))}</button>`).join("")}<button class="chip" data-s="0">${esc(t("cdClear"))}</button></div>
      <div class="row"><input id="fCdUntil" type="datetime-local"/><input id="fCdReason" maxlength="40" placeholder="${esc(t("cdReasonPh"))}" value="${esc(a.cooldown_reason)}"/></div></div>
    <div class="field"><label>${esc(t("color"))}</label><div class="swatches" id="fColors">${PALETTE.map((c) => `<button class="swatch ${c === color ? "sel" : ""}" data-c="${c}" style="--c:${c}"></button>`).join("")}</div></div>
    <div class="modal-actions"><button class="btn ghost" data-close>${esc(t("cancel"))}</button><button class="btn primary" id="fSave">${esc(t("save"))}</button></div>`,
  (m) => {
    m.querySelector("#fTags").onclick = (e) => {
      const el = e.target.closest(".tag"); if (!el) return;
      el.classList.toggle("on"); tags.has(el.dataset.t) ? tags.delete(el.dataset.t) : tags.add(el.dataset.t);
    };
    m.querySelector("#fNewTag").onkeydown = (e) => {
      if (e.key !== "Enter") return;
      const v = e.target.value.trim(); if (!v || tags.has(v)) return;
      tags.add(v);
      m.querySelector("#fTags").insertAdjacentHTML("beforeend", `<span class="tag on" data-t="${esc(v)}" style="--tc:${TAG_COLORS[v] || color}">${esc(v)}</span>`);
      e.target.value = "";
    };
    m.querySelector("#fColors").onclick = (e) => {
      const s = e.target.closest(".swatch"); if (!s) return;
      color = s.dataset.c; m.querySelectorAll(".swatch").forEach((x) => x.classList.toggle("sel", x === s));
    };
    const hint = m.querySelector("#fModeHint");
    const setHint = () => (hint.textContent = t(mode === "invisible" ? "modeInvisibleSub" : mode === "offline" ? "modeOfflineSub" : "modeNormalSub"));
    setHint();
    m.querySelector("#fMode").onclick = (e) => {
      const b = e.target.closest("button"); if (!b) return;
      mode = b.dataset.m;
      m.querySelectorAll("#fMode button").forEach((x) => x.classList.toggle("on", x === b));
      setHint();
    };
    const gameSel = m.querySelector("#fGame");
    invoke("list_games").then((games) => {
      const cur = a.launch_appid;
      gameSel.innerHTML = `<option value="">${esc(t("launchNone"))}</option>` +
        games.map((g) => `<option value="${esc(g.appid)}" ${g.appid === cur ? "selected" : ""}>${esc(g.name)}</option>`).join("") +
        (cur && !games.some((g) => g.appid === cur) ? `<option value="${esc(cur)}" selected>${esc(t("appId", { id: cur }))}</option>` : "");
    }).catch(() => {});
    const cdInput = m.querySelector("#fCdUntil"), cdReason = m.querySelector("#fCdReason");
    const toLocal = (ts) => { const d = new Date(ts * 1000); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
    if (onCooldown(a)) cdInput.value = toLocal(a.cooldown_until);
    m.querySelector("#fCdPresets").onclick = (e) => {
      const b = e.target.closest("[data-s]"); if (!b) return;
      const secs = +b.dataset.s;
      cdInput.value = secs ? toLocal(now() + secs) : "";
      if (!secs) cdReason.value = "";
    };
    m.querySelector("#fSave").onclick = async () => {
      const until = cdInput.value ? Math.floor(new Date(cdInput.value).getTime() / 1000) : 0;
      const live = until > now();
      await update(a.steamid, {
        nickname: m.querySelector("#fNick").value.trim(), note: m.querySelector("#fNote").value.trim(), tags: [...tags], color,
        login_mode: mode, launch_appid: gameSel.value, launch_args: m.querySelector("#fArgs").value.trim(), cooldown_until: live ? until : 0, cooldown_reason: live ? cdReason.value.trim() : "",
      });
      a._cdToasted = false;
      closeModal(); toast(t("saved"));
    };
  });
}

function tokenModal() {
  openModal(`
    <h2>${esc(t("tokenTitle"))}</h2>
    <p class="sub">${esc(t("tokenSub"))}</p>
    <div class="field"><label>${esc(t("tokenLabel"))}</label><textarea id="tTok" rows="4" spellcheck="false" placeholder="eyJhbGciOi…"></textarea>
      <div class="token-preview" id="tPrev"></div></div>
    <div class="row">
      <div class="field"><label>${esc(t("loginName"))}</label><input id="tName" placeholder="${esc(t("loginNamePh"))}"/></div>
      <div class="field"><label>${esc(t("personaOpt"))}</label><input id="tPersona" placeholder="${esc(t("personaPh"))}"/></div>
    </div>
    <div class="callout">${t("tokenWarn")}</div>
    <p class="fine">${ICON.shield} ${esc(t("tokenEncrypted"))}</p>
    <div class="modal-actions"><button class="btn ghost" data-close>${esc(t("cancel"))}</button><button class="btn primary" id="tAdd">${esc(t("add"))}</button></div>`,
  (m) => {
    const tok = m.querySelector("#tTok"), prev = m.querySelector("#tPrev");
    tok.oninput = () => {
      const v = tok.value.trim();
      if (!v) { prev.textContent = ""; return; }
      const p = decodeJwt(v);
      if (!p?.sub) { prev.className = "token-preview bad"; prev.textContent = t("tokenBad"); return; }
      const expired = p.exp && p.exp * 1000 < Date.now();
      prev.className = "token-preview" + (expired ? " bad" : "");
      prev.textContent = `✓ SteamID64: ${p.sub}` + (p.exp ? t("tokenExpiry", { d: fmtDate(p.exp) }) + (expired ? t("tokenExpired") : "") : "");
    };
    m.querySelector("#tAdd").onclick = async (e) => {
      e.target.disabled = true;
      try {
        await invoke("add_account_token", { token: tok.value, accountName: m.querySelector("#tName").value, persona: m.querySelector("#tPersona").value });
        closeModal(); toast(t("added")); await loadAccounts(); refreshProfiles();
      } catch (err) { toast(String(err), "err"); e.target.disabled = false; }
    };
  });
}
function decodeJwt(tok) {
  try {
    const seg = tok.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(seg + "===".slice((seg.length + 3) % 4)));
  } catch { return null; }
}

function removeModal(a) {
  openModal(`
    <h2>${esc(t("removeTitle"))}</h2>
    <p class="sub">${t("removeSub", { name: esc(nameOf(a)) })}</p>
    <label class="check"><input type="checkbox" id="rForget"/> ${esc(t("forgetSteam"))}</label>
    <div class="modal-actions"><button class="btn ghost" data-close>${esc(t("cancel"))}</button><button class="btn danger" id="rGo">${esc(t("remove"))}</button></div>`,
  (m) => m.querySelector("#rGo").onclick = async () => {
    try {
      await invoke("remove_account", { steamid: a.steamid, forgetSteam: m.querySelector("#rForget").checked });
      state.accounts = state.accounts.filter((x) => x.steamid !== a.steamid);
      closeModal(); render(); toast(t("removed"));
    } catch (e) { toast(String(e), "err"); }
  });
}

function settingsModal() {
  const s = state.status;
  const row = (title, sub, ctrl, subId = "") => `<div class="set-row"><div><b>${esc(t(title))}</b><small ${subId ? `id="${subId}"` : ""}>${esc(t(sub))}</small></div><div class="set-ctrl">${ctrl}</div></div>`;
  const toggle = (id, on) => `<input type="checkbox" id="${id}" class="toggle" ${on ? "checked" : ""}/>`;
  openModal(`
    <h2>${esc(t("settings"))}</h2>
    <p class="sub">${s.steam_found ? esc(t("steamAt", { p: s.steam_path })) : esc(t("steamMissing"))}</p>
    <div class="search set-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="sSearch" placeholder="${esc(t("settingsSearchPh"))}" spellcheck="false"/></div>
    <div id="sRows">
      <h3 class="set-h">${esc(t("secLook"))}</h3>
      ${row("language", "languageSub", `<div class="seg" id="sLang">${Object.entries(LANGS).map(([k, label]) => `<button class="${k === LANG ? "on" : ""}" data-l="${k}">${label}</button>`).join("")}</div>`)}
      ${row("accent", "accentSub", `<div class="swatches" id="sAccent">${ACCENTS.map((c) => `<button class="swatch ${c === (store.get("accent") || ACCENTS[0]) ? "sel" : ""}" data-c="${c}" style="--c:${c}"></button>`).join("")}</div>`)}
      ${row("uiScale", "uiScaleSub", `<div class="seg" id="sScale">${[90, 100, 110, 125].map((v) => `<button class="${v === (+store.get("scale") || 100) ? "on" : ""}" data-v="${v}">${v}%</button>`).join("")}</div>`)}
      ${row("reduceMotion", "reduceMotionSub", toggle("sMotion", store.get("reduceMotion") === "1"))}
      ${row("streamerMode", "streamerModeSub", toggle("sStreamer", store.get("streamer") === "1"))}
      ${row("streamerAuto", "streamerAutoSub", toggle("sStreamerAuto", store.get("streamerAuto") === "1"))}
      <h3 class="set-h">${esc(t("secData"))}</h3>
      ${row("onlineLookups", "onlineLookupsSub", `<button class="btn ghost" id="sRefresh">${ICON.refresh} ${esc(t("refreshNow"))}</button>${toggle("sOnline", onlineLookups())}`)}
      ${row("backup", "backupSub", `<button class="btn ghost" id="sExport">${esc(t("export"))}</button><button class="btn ghost" id="sImport">${esc(t("import"))}</button>`)}
      ${row("updates", "updatesSub", `<button class="btn ghost" id="sUpd">${esc(t("checkNow"))}</button>${toggle("sAutoUpd", store.get("autoUpdate") !== "0")}`, "sVer")}
      <h3 class="set-h">${esc(t("secBehavior"))}</h3>
      ${row("autoCapture", "autoCaptureSub", toggle("sAuto", store.get("autoCapture") !== "0"))}
      ${row("closeToTray", "closeToTraySub", toggle("sTray", closeToTray()))}
      ${row("hideAfterSwitch", "hideAfterSwitchSub", toggle("sHide", store.get("hideAfterSwitch") === "1"))}
      ${row("autostart", "autostartSub", toggle("sBoot", false))}
      ${row("protocol", "protocolSub", toggle("sProto", false))}
      <h3 class="set-h">Steam</h3>
      ${row("startSteam", "startSteamSub", `<button class="btn ghost" id="sOpen">${esc(t("start"))}</button>`)}
      ${row("stopSteam", "stopSteamSub", `<button class="btn ghost" id="sStop">${esc(t("stop"))}</button>`)}
      ${row("clearAll", "clearAllSub", `<button class="btn danger" id="sClear">${esc(t("clear"))}</button>`)}
    </div>
    <div class="modal-actions"><button class="btn ghost" data-close>${esc(t("closeBtn"))}</button></div>`,
  (m) => {
    const busy = async (btn, fn) => { btn.disabled = true; try { await fn(); } finally { btn.disabled = false; } };
    m.querySelector("#sSearch").oninput = (e) => {
      const q = e.target.value.trim().toLocaleLowerCase(locale());
      m.querySelectorAll("#sRows .set-row").forEach((r) => (r.hidden = !!q && !r.textContent.toLocaleLowerCase(locale()).includes(q)));
      m.querySelectorAll("#sRows .set-h").forEach((h) => (h.hidden = !!q));
    };
    m.querySelector("#sAccent").onclick = (e) => {
      const b = e.target.closest(".swatch"); if (!b) return;
      store.set("accent", b.dataset.c); applyLook();
      m.querySelectorAll("#sAccent .swatch").forEach((x) => x.classList.toggle("sel", x === b));
    };
    m.querySelector("#sScale").onclick = (e) => {
      const b = e.target.closest("button"); if (!b) return;
      store.set("scale", b.dataset.v); applyLook();
      m.querySelectorAll("#sScale button").forEach((x) => x.classList.toggle("on", x === b));
    };
    m.querySelector("#sMotion").onchange = (e) => { store.set("reduceMotion", e.target.checked ? "1" : "0"); applyLook(); };
    m.querySelector("#sStreamer").onchange = (e) => { store.set("streamer", e.target.checked ? "1" : "0"); applyLook(); render(); };
    m.querySelector("#sStreamerAuto").onchange = (e) => { store.set("streamerAuto", e.target.checked ? "1" : "0"); applyLook(); };
    m.querySelector("#sLang").onclick = (e) => {
      const l = e.target.closest("button")?.dataset.l;
      if (!l || l === LANG) return;
      setLang(l); render(); settingsModal(); // re-open so the modal itself is translated
    };
    T.app.getVersion().then((v) => (m.querySelector("#sVer").textContent = t("versionIs", { v }))).catch(() => {});
    m.querySelector("#sOnline").onchange = (e) => { store.set("onlineLookups", e.target.checked ? "1" : "0"); if (e.target.checked) refreshProfiles(); };
    m.querySelector("#sRefresh").onclick = (e) => onlineLookups() ? busy(e.currentTarget, () => refreshProfiles(true)) : toast(t("lookupsOff"), "info");
    m.querySelector("#sExport").onclick = async () => {
      try { if (await invoke("export_backup")) toast(t("exported")); } catch (e) { toast(String(e), "err"); }
    };
    m.querySelector("#sImport").onclick = async () => {
      try {
        const r = await invoke("import_backup"); if (!r) return;
        state.accounts = r.accounts; render(); loadAvatars();
        toast(t("imported", { a: r.added, u: r.updated }));
      } catch (e) { toast(String(e), "err"); }
    };
    m.querySelector("#sUpd").onclick = (e) => busy(e.currentTarget, () => checkUpdate(true));
    m.querySelector("#sAutoUpd").onchange = (e) => store.set("autoUpdate", e.target.checked ? "1" : "0");
    m.querySelector("#sAuto").onchange = (e) => store.set("autoCapture", e.target.checked ? "1" : "0");
    m.querySelector("#sTray").onchange = (e) => store.set("closeToTray", e.target.checked ? "1" : "0");
    m.querySelector("#sHide").onchange = (e) => store.set("hideAfterSwitch", e.target.checked ? "1" : "0");
    const proto = m.querySelector("#sProto");
    invoke("get_protocol").then((on) => (proto.checked = on)).catch(() => {});
    proto.onchange = async () => {
      try { await invoke("set_protocol", { enabled: proto.checked }); toast(t(proto.checked ? "protocolOn" : "protocolOff")); }
      catch (e) { proto.checked = !proto.checked; toast(String(e), "err"); }
    };
    const boot = m.querySelector("#sBoot");
    invoke("get_autostart").then((on) => (boot.checked = on)).catch(() => {});
    boot.onchange = async () => {
      try { await invoke("set_autostart", { enabled: boot.checked }); toast(t(boot.checked ? "autostartOn" : "autostartOff")); }
      catch (e) { boot.checked = !boot.checked; toast(String(e), "err"); }
    };
    m.querySelector("#sOpen").onclick = async () => { try { await invoke("open_steam"); toast(t("steamStarting")); setTimeout(refreshStatus, 2500); } catch (e) { toast(String(e), "err"); } };
    m.querySelector("#sStop").onclick = (e) => busy(e.currentTarget, async () => { try { await invoke("stop_steam_cmd"); toast(t("steamStopped")); refreshStatus(); } catch (err) { toast(String(err), "err"); } });
    m.querySelector("#sClear").onclick = () => openModal(`
      <h2>${esc(t("clearConfirm"))}</h2><p class="sub">${esc(t("clearConfirmSub", { n: state.accounts.length }))}</p>
      <label class="check"><input type="checkbox" id="cForget"/> ${esc(t("clearForget"))}</label>
      <div class="modal-actions"><button class="btn ghost" data-close>${esc(t("cancel"))}</button><button class="btn danger" id="cGo">${esc(t("clearGo"))}</button></div>`,
      (m2) => m2.querySelector("#cGo").onclick = async () => {
        try { await invoke("clear_all", { forgetSteam: m2.querySelector("#cForget").checked }); state.accounts = []; closeModal(); render(); toast(t("cleared")); }
        catch (e) { toast(String(e), "err"); }
      });
  });
}

// ---------- context menu ----------
function openMenu(a, x, y) {
  const menu = $("#menu");
  const mode = a.login_mode || "";
  menu.innerHTML = `
    <button data-m="switch">${ICON.bolt} ${esc(t("doSwitch"))}</button>
    ${mode !== "invisible" ? `<button data-m="invisible">${ICON.eye} ${esc(t("mInvisible"))}</button>` : ""}
    ${mode !== "offline" ? `<button data-m="offline">${ICON.plane} ${esc(t("mOffline"))}</button>` : ""}
    ${mode ? `<button data-m="normal">${ICON.bolt} ${esc(t("mNormal"))}</button>` : ""}
    <hr/>
    <button data-m="edit">${ICON.edit} ${esc(t("mEdit"))}</button>
    <button data-m="copy">${ICON.copy} ${esc(t("mCopyId"))}</button>
    <button data-m="copyName">${ICON.copy} ${esc(t("mCopyName"))}</button>
    <button data-m="copyLink">${ICON.copy} ${esc(t("mCopyLink"))}</button>
    <button data-m="copyCode">${ICON.copy} ${esc(t("mCopyCode"))}</button>
    <button data-m="profile">${ICON.link} ${esc(t("mProfile"))}</button>
    <hr/>
    <button data-m="shortcut">${ICON.bolt} ${esc(t("mShortcut"))}</button>
    <button data-m="deeplink">${ICON.copy} ${esc(t("mDeepLink"))}</button>
    <hr/><button data-m="remove" class="danger">${ICON.trash} ${esc(t("remove"))}</button>`;
  menu.hidden = false;
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.min(x, innerWidth - r.width - 8) + "px";
  menu.style.top = Math.min(y, innerHeight - r.height - 8) + "px";
  menu.onclick = (e) => {
    const m = e.target.closest("button")?.dataset.m; if (!m) return;
    menu.hidden = true;
    ({
      switch: () => switchTo(a.steamid),
      invisible: () => switchTo(a.steamid, "invisible"),
      offline: () => switchTo(a.steamid, "offline"),
      normal: () => switchTo(a.steamid, ""),
      edit: () => editModal(a),
      copy: () => copy(a.steamid, t("copiedId")),
      copyName: () => copy(a.account_name, t("copiedName")),
      copyLink: () => copy(`https://steamcommunity.com/profiles/${a.steamid}`, t("copiedLink")),
      copyCode: () => copy(String(BigInt(a.steamid) - 76561197960265728n), t("copiedCode")),
      profile: () => invoke("plugin:opener|open_url", { url: `https://steamcommunity.com/profiles/${a.steamid}` }).catch((e) => toast(String(e), "err")),
      shortcut: () => invoke("create_shortcut", { steamid: a.steamid }).then(() => toast(t("shortcutMade")), (e) => toast(String(e), "err")),
      deeplink: () => copy(`nfa://switch/${a.steamid}`, t("deepLinkCopied")),
      remove: () => removeModal(a),
    })[m]();
  };
}
const copy = (text, msg) => navigator.clipboard.writeText(text).then(() => toast(msg, "info"), () => toast(t("copyFail"), "err"));

// ---------- events ----------
$("#grid").addEventListener("click", (e) => {
  const card = e.target.closest(".card"); if (!card) return;
  const a = state.accounts.find((x) => x.steamid === card.dataset.id); if (!a) return;
  const act = e.target.closest("[data-act]")?.dataset.act;
  if (act === "switch") switchTo(a.steamid);
  else if (act === "fav") update(a.steamid, { favorite: !a.favorite });
  else if (act === "copy") copy(a.steamid, t("copiedId"));
  else if (act === "menu") { const r = e.target.closest("button").getBoundingClientRect(); openMenu(a, r.left, r.bottom + 6); }
});
$("#grid").addEventListener("dblclick", (e) => {
  const card = e.target.closest(".card");
  if (card && !e.target.closest("button,[data-act]")) switchTo(card.dataset.id);
});
$("#grid").addEventListener("contextmenu", (e) => {
  const card = e.target.closest(".card"); if (!card) return;
  e.preventDefault();
  openMenu(state.accounts.find((x) => x.steamid === card.dataset.id), e.clientX, e.clientY);
});
document.addEventListener("contextmenu", (e) => { if (!e.target.closest("input,textarea")) e.preventDefault(); });
document.addEventListener("mousedown", (e) => { if (!e.target.closest("#menu")) $("#menu").hidden = true; });

$("#chips").onclick = (e) => { const c = e.target.closest(".chip"); if (c) { state.filter = c.dataset.filter; render(); } };
$("#search").oninput = (e) => { state.query = e.target.value; render(); };
$("#sort").value = state.sort;
$("#sort").onchange = (e) => { state.sort = e.target.value; store.set("sort", state.sort); render(); };
$("#btnCapture").onclick = () => capture();
$("#emptyCapture").onclick = () => capture();
$("#btnAddToken").onclick = tokenModal;
$("#emptyToken").onclick = tokenModal;
$("#btnSettings").onclick = settingsModal;
$("#btnView").onclick = toggleView;
$("#btnCheck").onclick = checkLogins;

// ---------- drag & drop reorder ----------
let dragId = null;
const clearDrop = () => document.querySelectorAll(".drop-before,.drop-after").forEach((x) => x.classList.remove("drop-before", "drop-after"));
$("#grid").addEventListener("dragstart", (e) => {
  const c = e.target.closest(".card"); if (!c) return;
  dragId = c.dataset.id; c.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", dragId);
});
$("#grid").addEventListener("dragend", () => { dragId = null; clearDrop(); document.querySelectorAll(".dragging").forEach((x) => x.classList.remove("dragging")); });
$("#grid").addEventListener("dragover", (e) => {
  const c = e.target.closest(".card");
  if (!dragId || !c || c.dataset.id === dragId) return;
  e.preventDefault();
  const r = c.getBoundingClientRect();
  const after = state.view === "list" ? e.clientY > r.top + r.height / 2 : e.clientX > r.left + r.width / 2;
  clearDrop(); c.classList.add(after ? "drop-after" : "drop-before");
});
$("#grid").addEventListener("drop", (e) => {
  const c = e.target.closest(".card");
  if (!dragId || !c || c.dataset.id === dragId) return;
  e.preventDefault();
  const ids = visibleAccounts().map((a) => a.steamid).filter((id) => id !== dragId);
  ids.splice(ids.indexOf(c.dataset.id) + (c.classList.contains("drop-after") ? 1 : 0), 0, dragId);
  const order = [...ids, ...visibleAccounts(true).map((a) => a.steamid).filter((id) => !ids.includes(id))];
  order.forEach((id, n) => { const a = state.accounts.find((x) => x.steamid === id); if (a) a.sort_order = n + 1; });
  if (state.sort !== "custom") { state.sort = "custom"; store.set("sort", "custom"); $("#sort").value = "custom"; }
  render();
  invoke("reorder", { ids: order }).catch((err) => toast(String(err), "err"));
});

// ---------- command palette (Ctrl+K) ----------
let palSel = 0, palItems = [];
function paletteItems(q) {
  q = q.trim().toLocaleLowerCase(locale());
  const acc = visibleAccounts(true).map((a) => ({ a, label: nameOf(a), sub: "@" + a.account_name, run: (shift) => switchTo(a.steamid, shift ? "invisible" : undefined) }));
  const cmds = [["capture", () => capture()], ["checkLogins", checkLogins], ["addToken", tokenModal], ["settings", settingsModal], ["paletteView", toggleView], ["paletteStreamer", toggleStreamer]]
    .map(([k, run]) => ({ label: t(k), sub: "", run }));
  const hay = (i) => [i.label, i.sub, ...(i.a ? [i.a.steamid, i.a.persona, i.a.note, ...i.a.tags] : [])].join(" ").toLocaleLowerCase(locale());
  return [...acc, ...cmds].filter((i) => !q || hay(i).includes(q));
}
function renderPalette() {
  palItems = paletteItems($("#palInput").value);
  palSel = Math.max(0, Math.min(palSel, palItems.length - 1));
  $("#palList").innerHTML = palItems.length ? palItems.map((it, i) => `
    <button class="pal-item ${i === palSel ? "sel" : ""}" data-i="${i}">
      ${it.a ? avatarHTML(it.a) : `<span class="pal-ic">${ICON.bolt}</span>`}
      <span class="pi-text"><span class="pi-name">${esc(it.label)}</span>${it.sub ? `<small>${esc(it.sub)}</small>` : ""}</span>
      ${it.a && isActive(it.a) ? `<span class="badge ok">${esc(t("activeAccount"))}</span>` : ""}
    </button>`).join("") : `<p class="pal-empty">${esc(t("noMatch", { q: $("#palInput").value }))}</p>`;
  $("#palList .sel")?.scrollIntoView({ block: "nearest" });
}
function openPalette() {
  if (!$("#modalBackdrop").hidden || !$("#switchOverlay").hidden) return;
  palSel = 0; $("#palInput").value = ""; $("#palette").hidden = false; renderPalette(); $("#palInput").focus();
}
const closePalette = () => ($("#palette").hidden = true);
function runPalette(i, shift) { const it = palItems[i]; if (!it) return; closePalette(); it.run(shift); }
$("#palInput").oninput = () => { palSel = 0; renderPalette(); };
$("#palInput").onkeydown = (e) => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); palSel += e.key === "ArrowDown" ? 1 : -1; renderPalette(); }
  else if (e.key === "Enter") { e.preventDefault(); runPalette(palSel, e.shiftKey); }
};
$("#palList").onclick = (e) => { const b = e.target.closest(".pal-item"); if (b) runPalette(+b.dataset.i, e.shiftKey); };
$("#palette").addEventListener("mousedown", (e) => { if (e.target.id === "palette") closePalette(); });
$("#modalBackdrop").addEventListener("mousedown", (e) => { if (e.target.id === "modalBackdrop") closeModal(); });
$("#modal").addEventListener("click", (e) => { if (e.target.closest("[data-close]")) closeModal(); });

$("#winMin").onclick = () => appWin.minimize();
$("#winMax").onclick = () => appWin.toggleMaximize();
$("#winClose").onclick = () => (closeToTray() ? appWin.hide() : appWin.close());
T.event.listen("tray-switch", (e) => switchTo(e.payload));
// a shortcut / nfa:// link opened while the app was already running
T.event.listen("cli-switch", (e) => switchTo(e.payload.steamid, e.payload.mode ?? undefined));

document.addEventListener("keydown", (e) => {
  const typing = e.target.closest?.("input,textarea,select");
  if (e.ctrlKey && e.key.toLowerCase() === "k") { e.preventDefault(); $("#palette").hidden ? openPalette() : closePalette(); return; }
  if (e.key === "Escape" && !$("#palette").hidden) { closePalette(); return; }
  if (!$("#palette").hidden) return;
  if (e.key === "Escape") { $("#menu").hidden = true; if (!$("#modalBackdrop").hidden) closeModal(); else if (typing) e.target.blur(); return; }
  if (e.ctrlKey && e.key.toLowerCase() === "f") { e.preventDefault(); $("#search").focus(); $("#search").select(); return; }
  if (e.ctrlKey && e.key.toLowerCase() === "r") { e.preventDefault(); capture(); refreshStatus(); return; }
  if (typing || !$("#modalBackdrop").hidden) return;
  if (/^[1-9]$/.test(e.key) && !e.ctrlKey && !e.altKey) {
    const a = visibleAccounts()[+e.key - 1]; if (a) switchTo(a.steamid);
  } else if (e.key === "Enter" && e.target.closest(".card")) switchTo(e.target.closest(".card").dataset.id);
});

// ---------- cooldown ticker ----------
setInterval(() => {
  let ended = false;
  document.querySelectorAll(".cd[data-until]").forEach((el) => {
    const left = +el.dataset.until - now();
    el.textContent = fmtLeft(left);
    if (left <= 0) ended = true;
  });
  if (!ended) return;
  state.accounts.filter((a) => a.cooldown_until && a.cooldown_until <= now() && !a._cdToasted).forEach((a) => {
    a._cdToasted = true;
    toast(t("cdEnded", { name: shownName(a) }), "info");
  });
  render();
}, 1000);

// ---------- boot ----------
(async () => {
  applyStatic();
  applyLook();
  await refreshStatus();
  await loadAccounts();
  loadAvatars();
  if (store.get("autoCapture") !== "0" && state.status.steam_found) await capture(true);
  setInterval(() => { if (!state.switching) refreshStatus(); }, 3000);
  refreshProfiles(); // presence for all, avatars/bans when stale
  setInterval(() => { if (!state.switching) refreshProfiles(); }, 180000);
  if (store.get("autoUpdate") !== "0") setTimeout(checkUpdate, 4000);
})();
