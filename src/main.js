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
};

// ---------- helpers ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nameOf = (a) => a.nickname || a.persona || a.account_name;
const initials = (a) => {
  const n = nameOf(a).replace(/[^\p{L}\p{N} ]/gu, " ").trim();
  const parts = n.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || "?") + (parts[1]?.[0] || parts[0]?.[1] || "")).toLocaleUpperCase(locale());
};
const isActive = (a) => a.account_name && a.account_name.toLowerCase() === (state.status.active_user || "").toLowerCase();
const fmtDate = (ts) => new Date(ts * 1000).toLocaleDateString(locale());
function ago(ts) {
  if (!ts) return t("never");
  const s = Math.floor(Date.now() / 1000) - ts;
  if (s < 60) return t("justNow");
  if (s < 3600) return t("minAgo", { n: Math.floor(s / 60) });
  if (s < 86400) return t("hourAgo", { n: Math.floor(s / 3600) });
  if (s < 86400 * 30) return t("dayAgo", { n: Math.floor(s / 86400) });
  return fmtDate(ts);
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
async function capture(silent = false) {
  try {
    const before = state.accounts.length;
    state.accounts = await invoke("capture_accounts");
    const added = state.accounts.length - before;
    if (!silent) toast(added > 0 ? t("capturedN", { n: added }) : t("capturedNone"), added > 0 ? "ok" : "info");
    render();
  } catch (e) { if (!silent) toast(String(e), "err"); }
}
async function update(steamid, patch) {
  try {
    await invoke("update_account", { edit: { steamid, ...patch } });
    Object.assign(state.accounts.find((a) => a.steamid === steamid) || {}, patch);
    render();
  } catch (e) { toast(String(e), "err"); }
}

// ---------- rendering ----------
function renderStatus() {
  const s = state.status, pill = $("#steamPill");
  pill.className = "steam-pill " + (!s.steam_found ? "missing" : s.steam_running ? "on" : "off");
  $("#steamText").innerHTML = !s.steam_found ? esc(t("steamMissing"))
    : s.steam_running ? `${esc(t("steamOn"))}${s.active_user ? ` · <b>${esc(s.active_user)}</b>` : ""}`
    : esc(t("steamOff"));
  $("#footPath").textContent = s.steam_path || t("steamPathMissing");
  const act = state.accounts.find(isActive);
  $("#statActive").textContent = act ? nameOf(act) : (s.active_user || "—");
  // refresh active highlight without full re-render
  document.querySelectorAll(".card").forEach((c) => {
    const a = state.accounts.find((x) => x.steamid === c.dataset.id);
    if (a) c.classList.toggle("active", isActive(a));
  });
}

function visibleAccounts() {
  const q = state.query.trim().toLocaleLowerCase(locale());
  const list = state.accounts.filter((a) => {
    if (state.filter === "fav" && !a.favorite) return false;
    if (state.filter.startsWith("tag:") && !a.tags.includes(state.filter.slice(4))) return false;
    if (!q) return true;
    return [a.nickname, a.persona, a.account_name, a.steamid, a.note, ...a.tags].join(" ").toLocaleLowerCase(locale()).includes(q);
  });
  const cmp = (x, y) => nameOf(x).localeCompare(nameOf(y), locale());
  const by = {
    name: cmp,
    recent: (x, y) => y.last_switch - x.last_switch,
    login: (x, y) => y.timestamp - x.timestamp,
    smart: (x, y) => (isActive(y) - isActive(x)) || (y.favorite - x.favorite) || (y.last_switch - x.last_switch) || cmp(x, y),
  }[state.sort] || cmp;
  return list.sort(by);
}

function renderChips() {
  const tags = {};
  state.accounts.forEach((a) => a.tags.forEach((tg) => (tags[tg] = (tags[tg] || 0) + 1)));
  const favs = state.accounts.filter((a) => a.favorite).length;
  const chips = [["all", t("chipAll"), state.accounts.length], ["fav", t("chipFav"), favs],
    ...Object.entries(tags).sort().map(([tg, n]) => [`tag:${tg}`, tg, n])];
  if (!chips.some(([k]) => k === state.filter)) state.filter = "all";
  $("#chips").innerHTML = chips.map(([k, label, n]) =>
    `<button class="chip ${state.filter === k ? "active" : ""}" data-filter="${esc(k)}">${esc(label)}<span class="n">${n}</span></button>`).join("");
}

function cardHTML(a, i) {
  const active = isActive(a);
  const tags = a.tags.map((tg) => `<span class="tag" style="--tc:${TAG_COLORS[tg] || esc(a.color)}">${esc(tg)}</span>`).join("");
  return `
  <article class="card ${active ? "active" : ""}" data-id="${esc(a.steamid)}" tabindex="0" style="--c:${esc(a.color || "#10b981")};animation-delay:${Math.min(i, 12) * 30}ms">
    ${i < 9 ? `<span class="quick">${i + 1}</span>` : ""}
    <div class="card-top">
      <div class="avatar">${esc(initials(a))}${active ? '<span class="online"></span>' : ""}</div>
      <div class="who">
        <div class="name" title="${esc(nameOf(a))}">${esc(nameOf(a))}</div>
        <div class="login">@${esc(a.account_name)}</div>
      </div>
      <button class="star ${a.favorite ? "on" : ""}" data-act="fav" title="${esc(t("favorite"))}">${ICON.star}</button>
      <button class="more" data-act="menu" title="${esc(t("more"))}">${ICON.more}</button>
    </div>
    <div class="meta">
      <div class="copy" data-act="copy" title="${esc(t("copyTitle"))}"><small>SteamID64</small><span>${esc(a.steamid)}</span></div>
      <div><small>${esc(t("lastSwitch"))}</small><span>${esc(ago(a.last_switch))}</span></div>
    </div>
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
}

// ---------- switching ----------
async function switchTo(steamid) {
  const a = state.accounts.find((x) => x.steamid === steamid);
  if (!a || state.switching) return;
  if (!state.status.steam_found) return toast(t("steamNotFoundErr"), "err");
  state.switching = true;
  const ov = $("#switchOverlay"), steps = [...document.querySelectorAll("#switchSteps li")];
  $("#switchAvatar").innerHTML = `<div class="avatar" style="--c:${esc(a.color)}">${esc(initials(a))}</div>`;
  $("#switchTitle").textContent = t("switchingTo", { name: nameOf(a) });
  steps.forEach((s) => (s.className = ""));
  ov.hidden = false;

  let step = 0;
  const mark = (n) => steps.forEach((s, i) => (s.className = i < n ? "done" : i === n ? "doing" : ""));
  mark(0);
  // backend does it all in one call; advance the visual steps while it runs
  const timer = setInterval(() => { if (step < 1) mark(++step); }, 2200);
  try {
    await invoke("switch_account", { steamid });
    clearInterval(timer);
    mark(2);
    await new Promise((r) => setTimeout(r, 700));
    mark(3);
    a.last_switch = Math.floor(Date.now() / 1000);
    state.status.active_user = a.account_name;
    toast(t("switched", { name: nameOf(a) }), "ok");
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
  setTimeout(() => $("#modal").querySelector("input:not([type=checkbox]),textarea")?.focus(), 30);
}
const closeModal = () => { $("#modalBackdrop").hidden = true; $("#modal").innerHTML = ""; };

function editModal(a) {
  let color = a.color;
  const tags = new Set(a.tags);
  const allTags = [...new Set([...Object.keys(TAG_COLORS), ...state.accounts.flatMap((x) => x.tags)])];
  openModal(`
    <h2>${esc(t("editTitle"))}</h2>
    <p class="sub">@${esc(a.account_name)} · ${esc(a.steamid)}</p>
    <div class="field"><label>${esc(t("nickname"))}</label><input id="fNick" maxlength="40" placeholder="${esc(a.persona || a.account_name)}" value="${esc(a.nickname)}"/></div>
    <div class="field"><label>${esc(t("note"))}</label><textarea id="fNote" maxlength="300" placeholder="${esc(t("notePh"))}" style="font-family:var(--font);font-size:13px">${esc(a.note)}</textarea></div>
    <div class="field"><label>${esc(t("tags"))}</label>
      <div class="tag-picker" id="fTags">${allTags.map((tg) => `<span class="tag ${tags.has(tg) ? "on" : ""}" data-t="${esc(tg)}" style="--tc:${TAG_COLORS[tg] || "#8b96a5"}">${esc(tg)}</span>`).join("")}</div>
      <input id="fNewTag" maxlength="16" placeholder="${esc(t("newTagPh"))}" style="margin-top:6px"/>
    </div>
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
    m.querySelector("#fSave").onclick = async () => {
      await update(a.steamid, { nickname: m.querySelector("#fNick").value.trim(), note: m.querySelector("#fNote").value.trim(), tags: [...tags], color });
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
        closeModal(); toast(t("added")); loadAccounts();
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
  openModal(`
    <h2>${esc(t("settings"))}</h2>
    <p class="sub">${s.steam_found ? esc(t("steamAt", { p: s.steam_path })) : esc(t("steamMissing"))}</p>
    <div style="margin-top:10px">
      <div class="set-row"><div><b>${esc(t("language"))}</b><small>${esc(t("languageSub"))}</small></div>
        <div class="seg" id="sLang">${Object.entries(LANGS).map(([k, label]) => `<button class="${k === LANG ? "on" : ""}" data-l="${k}">${label}</button>`).join("")}</div></div>
      <div class="set-row"><div><b>${esc(t("startSteam"))}</b><small>${esc(t("startSteamSub"))}</small></div><button class="btn ghost" id="sOpen">${esc(t("start"))}</button></div>
      <div class="set-row"><div><b>${esc(t("stopSteam"))}</b><small>${esc(t("stopSteamSub"))}</small></div><button class="btn ghost" id="sStop">${esc(t("stop"))}</button></div>
      <div class="set-row"><div><b>${esc(t("autoCapture"))}</b><small>${esc(t("autoCaptureSub"))}</small></div><input type="checkbox" id="sAuto" style="accent-color:var(--accent);width:18px;height:18px" ${store.get("autoCapture") !== "0" ? "checked" : ""}/></div>
      <div class="set-row"><div><b>${esc(t("clearAll"))}</b><small>${esc(t("clearAllSub"))}</small></div><button class="btn danger" id="sClear">${esc(t("clear"))}</button></div>
    </div>
    <div class="modal-actions"><button class="btn ghost" data-close>${esc(t("closeBtn"))}</button></div>`,
  (m) => {
    m.querySelector("#sLang").onclick = (e) => {
      const l = e.target.closest("button")?.dataset.l;
      if (!l || l === LANG) return;
      setLang(l); render(); settingsModal(); // re-open so the modal itself is translated
    };
    m.querySelector("#sOpen").onclick = async () => { try { await invoke("open_steam"); toast(t("steamStarting")); setTimeout(refreshStatus, 2500); } catch (e) { toast(String(e), "err"); } };
    m.querySelector("#sStop").onclick = async (e) => { e.target.disabled = true; try { await invoke("stop_steam_cmd"); toast(t("steamStopped")); refreshStatus(); } catch (err) { toast(String(err), "err"); } e.target.disabled = false; };
    m.querySelector("#sAuto").onchange = (e) => store.set("autoCapture", e.target.checked ? "1" : "0");
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
  menu.innerHTML = `
    <button data-m="switch">${ICON.bolt} ${esc(t("doSwitch"))}</button>
    <button data-m="edit">${ICON.edit} ${esc(t("mEdit"))}</button>
    <button data-m="copy">${ICON.copy} ${esc(t("mCopyId"))}</button>
    <button data-m="copyName">${ICON.copy} ${esc(t("mCopyName"))}</button>
    <button data-m="profile">${ICON.link} ${esc(t("mProfile"))}</button>
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
      edit: () => editModal(a),
      copy: () => copy(a.steamid, t("copiedId")),
      copyName: () => copy(a.account_name, t("copiedName")),
      profile: () => invoke("plugin:opener|open_url", { url: `https://steamcommunity.com/profiles/${a.steamid}` }).catch((e) => toast(String(e), "err")),
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
$("#modalBackdrop").addEventListener("mousedown", (e) => { if (e.target.id === "modalBackdrop") closeModal(); });
$("#modal").addEventListener("click", (e) => { if (e.target.closest("[data-close]")) closeModal(); });

$("#winMin").onclick = () => appWin.minimize();
$("#winMax").onclick = () => appWin.toggleMaximize();
$("#winClose").onclick = () => appWin.close();
appWin.onResized(async () => $("#app").classList.toggle("maximized", await appWin.isMaximized()));

document.addEventListener("keydown", (e) => {
  const typing = e.target.closest("input,textarea,select");
  if (e.key === "Escape") { $("#menu").hidden = true; if (!$("#modalBackdrop").hidden) closeModal(); else if (typing) e.target.blur(); return; }
  if (e.ctrlKey && e.key.toLowerCase() === "f") { e.preventDefault(); $("#search").focus(); $("#search").select(); return; }
  if (e.ctrlKey && e.key.toLowerCase() === "r") { e.preventDefault(); capture(); refreshStatus(); return; }
  if (typing || !$("#modalBackdrop").hidden) return;
  if (/^[1-9]$/.test(e.key) && !e.ctrlKey && !e.altKey) {
    const a = visibleAccounts()[+e.key - 1]; if (a) switchTo(a.steamid);
  } else if (e.key === "Enter" && e.target.closest(".card")) switchTo(e.target.closest(".card").dataset.id);
});

// ---------- boot ----------
(async () => {
  applyStatic();
  await refreshStatus();
  await loadAccounts();
  if (store.get("autoCapture") !== "0" && state.status.steam_found) await capture(true);
  setInterval(() => { if (!state.switching) refreshStatus(); }, 3000);
})();
