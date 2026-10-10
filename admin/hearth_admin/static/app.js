/* Hearth Admin console — plain JS, hash routes, talks only to /api on the same origin. */
"use strict";

const S = {
  token: sessionGet("hearth_admin_token"),
  admin: sessionGet("hearth_admin_name") || "",
  issues: null,
  waiting: [],          // people trying to sign in (Passkey Issue)
  seenWaiting: null,    // request ids already announced, so each prompt shows once
};
const root = document.getElementById("root");

function sessionGet(k) { try { return sessionStorage.getItem(k); } catch { return null; } }
function sessionSet(k, v) { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch {} }

// ------------------------------------------------------------------ helpers
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const money = (n) => (n == null ? "—" : inr.format(n));
const fmtNum = (n) => (n == null ? "—" : new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n));
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (k, long) => { const [y, m] = k.split("-"); return MONTHS[+m - 1] + (long ? " " + y : ""); };
function when(iso, withTime = true) {
  if (!iso) return "—";
  const d = new Date(iso);
  const opts = { day: "numeric", month: "short", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" };
  if (withTime) Object.assign(opts, { hour: "numeric", minute: "2-digit" });
  return d.toLocaleString("en-IN", opts);
}
function ago(iso) {
  if (!iso) return "never";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000, s = Math.abs(diff);
  if (s < 90) return "just now";
  const n = s < 3600 ? Math.round(s / 60) + " min" : s < 86400 ? Math.round(s / 3600) + " h" : Math.round(s / 86400) + " d";
  return diff < 0 ? "in " + n : n + " ago";
}
const qs = (obj) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(obj)) if (v != null && v !== "" && v !== false) p.set(k, v); const s = p.toString(); return s ? "?" + s : ""; };

async function api(path, body) {
  const res = await fetch("/api" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: "Bearer " + S.token, "X-Admin-Name": S.admin, ...(body !== undefined && { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401 || res.status === 503) {
    const msg = (await res.json().catch(() => ({}))).detail || "Signed out";
    signOut(msg);
    throw new Error(msg);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Request failed (" + res.status + ")");
  return data;
}

function toast(msg, err) {
  const t = document.createElement("div");
  t.className = "toast" + (err ? " err" : "");
  t.textContent = msg;
  t.setAttribute("role", "status");
  document.body.appendChild(t);
  setTimeout(() => t.remove(), err ? 5000 : 2600);
}

/** In-page dialog (never window.prompt). Resolves to the field values, or null on cancel. */
function ask({ title, text, fields = [], confirm = "Confirm", danger }) {
  return new Promise((resolve) => {
    const scrim = document.createElement("div");
    scrim.className = "scrim";
    scrim.innerHTML = `<form class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <h2>${esc(title)}</h2>${text ? `<p>${esc(text)}</p>` : ""}
      ${fields.map((f) => `<label for="f_${f.name}">${esc(f.label)}${f.required ? " (required)" : ""}</label>` +
        (f.type === "select"
          ? `<select id="f_${f.name}" name="${f.name}">${f.options.map((o) => `<option value="${esc(o.value)}" ${o.value === f.value ? "selected" : ""}>${esc(o.label)}</option>`).join("")}</select>`
          : f.type === "text"
          ? `<input type="text" id="f_${f.name}" name="${f.name}" value="${esc(f.value || "")}" placeholder="${esc(f.placeholder || "")}" ${f.list ? `list="l_${f.name}"` : ""} autocomplete="off">${f.list ? `<datalist id="l_${f.name}">${f.list.map((x) => `<option value="${esc(x)}">`).join("")}</datalist>` : ""}`
          : `<textarea id="f_${f.name}" name="${f.name}" placeholder="${esc(f.placeholder || "")}"></textarea>`)).join("")}
      <div class="err-text"></div>
      <div class="actions"><button type="button" class="btn" data-x>Cancel</button>
      <button class="btn primary ${danger ? "danger" : ""}">${esc(confirm)}</button></div></form>`;
    const form = scrim.querySelector("form");
    const done = (v) => { scrim.remove(); document.removeEventListener("keydown", onKey); resolve(v); };
    const onKey = (e) => { if (e.key === "Escape") done(null); };
    document.addEventListener("keydown", onKey);
    scrim.querySelector("[data-x]").onclick = () => done(null);
    scrim.onclick = (e) => { if (e.target === scrim) done(null); };
    form.onsubmit = (e) => {
      e.preventDefault();
      const vals = Object.fromEntries(new FormData(form));
      const miss = fields.find((f) => f.required && !String(vals[f.name] || "").trim());
      if (miss) { form.querySelector(".err-text").textContent = miss.label + " is required."; return; }
      done(vals);
    };
    document.body.appendChild(scrim);
    (form.querySelector("select, input, textarea") || form.querySelector(".primary")).focus();
  });
}

async function act(path, body, okMsg) {
  try {
    const out = await api(path, body);
    toast(okMsg || "Done");
    S.issues = null;
    await render();
    return out;
  } catch (e) { toast(e.message, true); return null; }
}

// ------------------------------------------------------------------ status vocab
const TASK_STATUSES = ["open", "acknowledged", "in_progress", "done", "cancelled"];
const pretty = (s) => String(s || "").replace(/_/g, " ");
function statusPill(s) {
  const cls = { active: "good", done: "good", published: "good", paid: "good", approved: "good", completed: "good",
    suspended: "bad", overdue: "bad", cancelled: "", under_review: "warn", clarifying: "warn", draft: "", ready: "warn",
    due: "warn", open: "", acknowledged: "", in_progress: "warn", upcoming: "", pending: "", purchased: "good", removed: "" }[s] ?? "";
  return `<span class="pill ${cls}">${esc(pretty(s))}</span>`;
}
const SEV = { high: ["▲", "High"], medium: ["●", "Medium"], low: ["○", "Low"] };
const sev = (s) => `<span class="sev ${s}" aria-label="${SEV[s][1]} severity"><span aria-hidden="true">${SEV[s][0]}</span>${SEV[s][1]}</span>`;

// ------------------------------------------------------------------ charts
/** Single-series vertical bars, one y-axis, hover tooltip + click. */
function barChart(rows, { value, fmt, sub, onClick, cls = "" }) {
  const W = 640, H = 220, L = 52, R = 8, T = 10, B = 26;
  const max = Math.max(1, ...rows.map(value));
  const nice = niceMax(max), ticks = 4;
  const bw = (W - L - R) / rows.length, gap = 2, barW = Math.max(4, Math.min(34, bw - gap * 2 - 8));
  const y = (v) => T + (H - T - B) * (1 - v / nice);
  let g = "";
  for (let i = 0; i <= ticks; i++) {
    const v = (nice / ticks) * i;
    g += `<line class="gridline" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>` +
      `<text class="axis" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${esc(fmt(v, true))}</text>`;
  }
  rows.forEach((r, i) => {
    const v = value(r), cx = L + bw * i + bw / 2, top = y(v), h = Math.max(0, H - B - top);
    const rad = Math.min(4, h / 2);
    const path = h <= 0 ? "" : `M${cx - barW / 2},${H - B} V${top + rad} Q${cx - barW / 2},${top} ${cx - barW / 2 + rad},${top} H${cx + barW / 2 - rad} Q${cx + barW / 2},${top} ${cx + barW / 2},${top + rad} V${H - B} Z`;
    g += `<g data-i="${i}"><rect class="hit" x="${L + bw * i}" y="${T}" width="${bw}" height="${H - T}"/>` +
      `<path class="bar ${cls}" d="${path}"/>` +
      `<text class="axis" x="${cx}" y="${H - 8}" text-anchor="middle">${esc(r.label)}</text></g>`;
  });
  const id = "c" + Math.random().toString(36).slice(2, 8);
  setTimeout(() => {
    const el = document.getElementById(id);
    if (!el) return;
    const tip = el.querySelector(".tip");
    el.querySelectorAll("g[data-i]").forEach((gr) => {
      const r = rows[+gr.dataset.i];
      gr.addEventListener("mousemove", (e) => {
        const box = el.getBoundingClientRect();
        tip.style.display = "block";
        tip.style.left = e.clientX - box.left + "px";
        tip.style.top = e.clientY - box.top + "px";
        tip.innerHTML = `<b>${esc(r.long || r.label)}</b> · ${esc(fmt(value(r)))}${sub ? "<br>" + esc(sub(r)) : ""}`;
        gr.classList.add("on");
      });
      gr.addEventListener("mouseleave", () => { tip.style.display = "none"; gr.classList.remove("on"); });
      if (onClick) gr.addEventListener("click", () => onClick(r));
    });
  });
  return `<div class="chart" id="${id}"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="bar chart">${g}</svg><div class="tip"></div></div>`;
}
function niceMax(v) {
  const p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}
const compactMoney = (v, axis) => axis && v >= 1000 ? "₹" + fmtNum(v / 1000) + "k" : money(v);

function hbars(rows, { value, label, right }) {
  const max = Math.max(1, ...rows.map(value));
  return rows.map((r) => `<div class="hbar"><span class="name" title="${esc(label(r))}">${esc(label(r))}</span>
    <div class="track"><div class="fill" style="width:${(value(r) / max) * 100}%"></div></div>
    <span class="num faint">${right(r)}</span></div>`).join("") || `<div class="empty">No purchases in this period.</div>`;
}

// ------------------------------------------------------------------ layout
const NAV = [["overview", "Overview"], ["passkeys", "Passkey Issue"], ["purchases", "Purchases"], ["families", "Families"], ["tasks", "Tasks"],
  ["posts", "Feed posts"], ["issues", "Issues"], ["audit", "Audit log"]];

function shell(active, html) {
  const n = S.issues;
  root.innerHTML = `<div class="shell"><nav class="side" aria-label="Sections">
    <div class="brand">Hearth</div><div class="brand-sub">Admin console</div>
    ${NAV.map(([k, l]) => `<a href="#/${k}" class="${active === k ? "on" : ""}">${l}${k === "issues" && n ? `<span class="count" aria-label="${n} high-severity issues">${n}</span>` : ""}${k === "passkeys" ? `<span class="count" id="waitCount" aria-label="people waiting for a passkey" ${S.waiting.length ? "" : "hidden"}>${S.waiting.length}</span>` : ""}</a>`).join("")}
    <div class="spacer"></div>
    <div class="who">Signed in as ${esc(S.admin || "admin")}</div>
    <a href="#" id="theme">Theme: <span id="themeName"></span></a>
    <a href="#" id="logout">Sign out</a></nav><main id="main"><div id="waitBanner"></div>${html}</main></div>`;
  document.getElementById("logout").onclick = (e) => { e.preventDefault(); signOut(); };
  wireTheme();
  showWaiting();
}

// ------------------------------------------------------------------ "is trying to sign in"
const phoneFmt = (p) => (p && p.startsWith("+91") && p.length === 13 ? `+91 ${p.slice(3, 8)} ${p.slice(8)}` : p || "");

function showWaiting() {
  const w = S.waiting, count = document.getElementById("waitCount"), banner = document.getElementById("waitBanner");
  if (count) { count.textContent = w.length; count.hidden = !w.length; }
  document.title = (w.length ? `(${w.length}) ` : "") + "Hearth Admin";
  if (!banner) return;
  const onPage = location.hash.startsWith("#/passkeys");
  banner.innerHTML = w.length && !onPage ? `<a class="wait-banner" href="#/passkeys"><span class="key" aria-hidden="true">🔑</span>
    <span><b>${esc(w[0].name)}</b> (${esc(phoneFmt(w[0].phone))}) is trying to sign in${w.length > 1 ? ` — and ${w.length - 1} more` : ""}.</span>
    <span class="go">Issue passkey ›</span></a>` : "";
}

async function pollWaiting() {
  if (!S.token) return;
  let w;
  try { w = await api("/passkeys/waiting"); } catch { return; }
  const fresh = S.seenWaiting ? w.filter((r) => !S.seenWaiting.has(r.id)) : [];
  S.seenWaiting = new Set(w.map((r) => r.id));
  S.waiting = w;
  showWaiting();
  if (fresh.length) {
    const r = fresh[0];
    toast(`🔑 ${r.name} (${phoneFmt(r.phone)}) is trying to sign in`);
    if (location.hash.startsWith("#/passkeys")) render();
  }
}
setInterval(pollWaiting, 20000);
function wireTheme() {
  const el = document.getElementById("theme"), name = document.getElementById("themeName");
  const cur = () => document.documentElement.dataset.theme || "auto";
  name.textContent = cur();
  el.onclick = (e) => {
    e.preventDefault();
    const next = { auto: "light", light: "dark", dark: "auto" }[cur()];
    if (next === "auto") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = next;
    try { localStorage.setItem("hearth_admin_theme", next); } catch {}
    name.textContent = next;
  };
}
try { const t = localStorage.getItem("hearth_admin_theme"); if (t && t !== "auto") document.documentElement.dataset.theme = t; } catch {}

const head = (kicker, title, sub, right = "") =>
  `<div class="head"><div><div class="kicker">${esc(kicker)}</div><h1>${esc(title)}</h1>${sub ? `<div class="sub">${sub}</div>` : ""}</div>${right}</div>`;

let familiesCache = null;
async function familyOptions(selected, allLabel = "All families") {
  familiesCache = familiesCache || await api("/families");
  return `<option value="">${allLabel}</option>` + familiesCache.map((f) => `<option value="${esc(f.id)}" ${f.id === selected ? "selected" : ""}>${esc(f.name)}</option>`).join("");
}
function onFilters(route, ids) {
  ids.forEach((id) => {
    const el = document.getElementById(id);
    el?.addEventListener(el.tagName === "INPUT" && el.type !== "checkbox" ? "change" : "change", () => {
      const v = {};
      ids.forEach((i) => { const x = document.getElementById(i); v[x.dataset.key] = x.type === "checkbox" ? x.checked : x.value; });
      location.hash = "#/" + route + qs(v);
    });
  });
}

// ------------------------------------------------------------------ pages
async function pageOverview() {
  const o = await api("/overview");
  const t = o.this_month, l = o.last_month;
  const rows = o.monthly.map((r) => ({ ...r, label: monthLabel(r.month), long: monthLabel(r.month, true) }));
  shell("overview", head("Today", "Overview", `Across ${o.households} ${o.households === 1 ? "family" : "families"}`) + `
    <div class="tiles">
      <div class="tile"><div class="label">Families</div><div class="value tnum">${o.households}</div>
        <div class="note">${o.households_by_status.suspended} suspended · ${o.households_by_status.under_review} under review</div></div>
      <div class="tile"><div class="label">Active members</div><div class="value tnum">${o.members_active}</div>
        <div class="note">${o.signed_in_30d} signed in, seen in 30 days</div></div>
      <div class="tile"><div class="label">Spend this month</div><div class="value tnum">${money(t.spend)}</div>
        <div class="note">${t.purchases} purchases · ${t.priced} priced · ${monthLabel(l.month)} total ${money(l.spend)}</div></div>
      <div class="tile"><div class="label">Open tasks</div><div class="value tnum">${o.open_tasks}</div>
        <div class="note">${o.overdue_tasks} overdue</div></div>
      <a class="tile ${o.issues.high ? "alert" : ""}" href="#/issues" style="color:inherit;text-decoration:none">
        <div class="label">Issues</div><div class="value tnum">${o.issues.high + o.issues.medium + o.issues.low}</div>
        <div class="note">${o.issues.high} high · ${o.issues.medium} medium · ${o.issues.low} low</div></a>
    </div>
    <div class="grid g3">
      <div class="card"><h2>Grocery spend by month</h2>
        <div class="faint" style="margin:-6px 0 8px">Priced lines only — unpriced purchases are counted, never estimated. Click a month for its purchases.</div>
        ${barChart(rows, { value: (r) => r.spend, fmt: compactMoney, sub: (r) => `${r.purchases} purchases, ${r.priced} priced, ${r.households} families`, onClick: (r) => location.hash = "#/purchases" + qs({ month: r.month }) })}</div>
      <div class="card"><h2>Most bought · 90 days</h2>
        ${hbars(o.top_items, { value: (r) => r.times, label: (r) => r.product, right: (r) => r.times + "×" })}
        <div style="margin-top:10px"><a href="#/purchases">All items →</a></div></div>
    </div>`);
}

async function pagePurchases(p) {
  const household = p.get("household") || "", days = p.get("days") || "90", month = p.get("month") || "", view = p.get("view") || "chart";
  const [monthly, top, detail, fam] = await Promise.all([
    api("/purchases/monthly" + qs({ months: 12, household_id: household })),
    api("/purchases/top" + qs({ days, household_id: household, limit: 30 })),
    month ? api(`/purchases/month/${month}` + qs({ household_id: household })) : null,
    familyOptions(household),
  ]);
  const rows = monthly.map((r) => ({ ...r, label: monthLabel(r.month), long: monthLabel(r.month, true) }));
  const go = (extra) => "#/purchases" + qs({ household, days, month, view, ...extra });
  shell("purchases", head("Grocery", "Purchases", "Confirmed purchases only (chat, receipt, manual)",
    `<div class="filters" style="margin:0"><select id="fh" data-key="household" aria-label="Family">${fam}</select>
     <select id="fd" data-key="days" aria-label="Period for top items">${[30, 90, 180, 365].map((d) => `<option value="${d}" ${+days === d ? "selected" : ""}>Top items: last ${d} days</option>`).join("")}</select>
     <input type="hidden" id="fm" data-key="month" value="${esc(month)}"><input type="hidden" id="fv" data-key="view" value="${esc(view)}"></div>`) + `
    <div class="grid g2">
      <div class="card"><div class="group-head"><h2>Spend by month</h2>
        <div class="seg" role="group" aria-label="View"><button class="${view === "chart" ? "on" : ""}" onclick="location.hash='${go({ view: "chart" })}'">Chart</button><button class="${view === "table" ? "on" : ""}" onclick="location.hash='${go({ view: "table" })}'">Table</button></div></div>
        ${view === "chart" ? barChart(rows, { value: (r) => r.spend, fmt: compactMoney, sub: (r) => `${r.purchases} purchases, ${r.priced} priced`, onClick: (r) => location.hash = go({ month: r.month }) }) : monthTable(rows, go)}</div>
      <div class="card"><h2>Purchases by month</h2>
        ${view === "chart" ? barChart(rows, { value: (r) => r.purchases, fmt: (v) => fmtNum(Math.round(v)), cls: "alt", sub: (r) => `${r.households} families`, onClick: (r) => location.hash = go({ month: r.month }) }) : `<div class="faint">Counts are in the table on the left.</div>`}</div>
    </div>
    ${detail ? `<div class="card"><div class="group-head"><h2>${monthLabel(month, true)} · ${detail.length} purchases</h2><a href="${go({ month: "" })}">Close</a></div>
      <div class="tablewrap"><table><thead><tr><th>When</th><th>Family</th><th>Item</th><th class="num">Qty</th><th>Brand</th><th class="num">Price</th><th>Store</th><th>By</th><th>Source</th></tr></thead><tbody>
      ${detail.map((d) => `<tr><td>${when(d.purchased_at)}</td><td>${esc(d.household)}</td><td>${esc(d.product)}</td><td class="num">${fmtNum(d.qty)} ${esc(d.unit || "")}</td><td>${esc(d.brand || "—")}</td><td class="num">${money(d.price)}</td><td>${esc(d.store || "—")}</td><td>${esc(d.member || "—")}</td><td class="faint">${esc(pretty(d.source))}</td></tr>`).join("") || `<tr><td colspan="9" class="empty">No purchases.</td></tr>`}
      </tbody></table></div></div>` : ""}
    <div class="card"><h2>Frequently bought · last ${days} days</h2><div class="tablewrap"><table>
      <thead><tr><th>Item</th><th>Category</th><th class="num">Times</th><th class="num">Families</th><th class="num">Total qty</th><th class="num">Spend</th><th>Last bought</th></tr></thead><tbody>
      ${top.map((r) => `<tr><td>${esc(r.product)}</td><td class="muted">${esc(r.category || "—")}</td><td class="num">${r.times}</td><td class="num">${r.households}</td>
        <td class="num">${r.qty != null ? fmtNum(r.qty) + " " + esc(r.unit) : esc(r.unit || "—")}</td>
        <td class="num">${money(r.spend)}${r.priced < r.times ? `<div class="faint">${r.priced} of ${r.times} priced</div>` : ""}</td><td>${when(r.last_bought, false)}</td></tr>`).join("") || `<tr><td colspan="7" class="empty">No purchases in this period.</td></tr>`}
      </tbody></table></div></div>`);
  onFilters("purchases", ["fh", "fd", "fm", "fv"]);
}
function monthTable(rows, go) {
  return `<div class="tablewrap"><table><thead><tr><th>Month</th><th class="num">Purchases</th><th class="num">Priced</th><th class="num">Spend</th><th class="num">Families</th></tr></thead><tbody>
    ${rows.slice().reverse().map((r) => `<tr><td><a href="${go({ month: r.month })}">${r.long}</a></td><td class="num">${r.purchases}</td><td class="num">${r.priced}</td><td class="num">${money(r.spend)}</td><td class="num">${r.households}</td></tr>`).join("")}</tbody></table></div>`;
}

async function pageFamilies() {
  const fams = familiesCache = await api("/families");
  shell("families", head("People", "Families", "Sorted by open high-severity issues") + `<div class="card"><div class="tablewrap"><table>
    <thead><tr><th>Family</th><th>Status</th><th>Owner</th><th class="num">Members</th><th class="num">Open tasks</th><th class="num">Purchases 30 d</th><th>Last activity</th><th>Issues</th></tr></thead><tbody>
    ${fams.map((f) => `<tr><td><a href="#/family/${esc(f.id)}">${esc(f.name)}</a><div class="faint">${esc(f.id)}</div></td>
      <td>${statusPill(f.status)}${f.note ? `<div class="faint">${esc(f.note)}</div>` : ""}</td>
      <td>${f.owner ? esc(f.owner) : `<span class="pill bad">no owner</span>`}</td>
      <td class="num">${f.members}${f.members_removed ? `<div class="faint">+${f.members_removed} removed</div>` : ""}</td>
      <td class="num">${f.open_tasks}</td><td class="num">${f.purchases_30d}</td><td>${ago(f.last_activity)}</td>
      <td>${f.issues ? `<a href="#/issues${qs({ household: f.id })}">${f.issues_high ? `<span class="sev high">▲ ${f.issues_high} high</span> · ` : ""}${f.issues} total</a>` : `<span class="muted">none</span>`}</td></tr>`).join("") || `<tr><td colspan="8" class="empty">No families yet.</td></tr>`}
    </tbody></table></div></div>`);
}

async function pageFamily(id, p) {
  const f = await api("/families/" + encodeURIComponent(id));
  const tab = p.get("tab") || "members";
  const audit = tab === "audit" ? await api("/audit" + qs({ household_id: id })) : null;
  const tabs = [["members", `Members (${f.members.length})`], ["tasks", `Tasks (${f.tasks.length})`], ["posts", `Posts (${f.posts.length})`],
    ["lists", "Grocery lists"], ["bills", "Bills"], ["signins", "Sign-ins"], ["issues", `Issues (${f.issues.length})`], ["audit", "Admin log"]];
  const body = {
    members: () => `<div class="members">${f.members.map(memberCard).join("")}</div>`,
    tasks: () => taskTable(f.tasks, f.members),
    posts: () => postTable(f.posts),
    lists: () => f.lists.map((l) => `<div style="margin-bottom:14px"><div class="group-head"><b>List ${esc(l.id)}</b><span>${statusPill(l.status)} <span class="faint">${when(l.created_at)}</span></span></div>
      <table><thead><tr><th>Item</th><th>Category</th><th class="num">Qty</th><th>Status</th><th class="num">Expected</th></tr></thead><tbody>
      ${l.items.map((i) => `<tr><td>${esc(i.product)}${i.brand ? ` <span class="faint">${esc(i.brand)}</span>` : ""}${i.needs_clarification ? ` <span class="pill warn">needs answer</span>` : ""}</td><td>${esc(i.category)}</td><td class="num">${fmtNum(i.qty)} ${esc(i.unit || "")}</td><td>${statusPill(i.status)}</td><td class="num">${money(i.expected_total)}</td></tr>`).join("") || `<tr><td colspan="5" class="empty">Empty list.</td></tr>`}</tbody></table></div>`).join("") || `<div class="empty">No grocery lists on the server yet.</div>`,
    bills: () => `<table><thead><tr><th>Bill</th><th>Pays</th><th>Recent periods</th></tr></thead><tbody>${f.bills.map((b) => `<tr><td>${esc(pretty(b.kind))}${b.provider ? `<div class="faint">${esc(b.provider)}</div>` : ""}${b.active ? "" : ` <span class="pill">inactive</span>`}</td><td>${esc(b.assigned_to || "—")}</td>
      <td>${b.payments.map((x) => `<div>${esc(x.period)} · due ${when(x.due_date, false)} · ${money(x.amount_due)} ${statusPill(x.status)}</div>`).join("") || `<span class="muted">no periods yet</span>`}</td></tr>`).join("") || `<tr><td colspan="3" class="empty">No bills.</td></tr>`}</tbody></table>`,
    signins: () => `<table><thead><tr><th>When</th><th>Event</th><th>Member</th><th>Detail</th></tr></thead><tbody>${f.auth_events.map((e) => `<tr><td>${when(e.at)}</td><td>${esc(pretty(e.kind))}</td><td>${esc(e.member || "—")}</td><td class="faint">${e.detail ? esc(JSON.stringify(e.detail)) : ""}</td></tr>`).join("") || `<tr><td colspan="4" class="empty">No sign-in events.</td></tr>`}</tbody></table>`,
    issues: () => issueList(f.issues),
    audit: () => auditTable(audit),
  }[tab]();
  shell("families", head("Family", f.name, `${esc(f.id)} · created ${when(f.created_at, false)} · last activity ${ago(f.last_activity)}`,
    `<div style="display:flex;gap:8px;align-items:center">${statusPill(f.status)}<button class="btn" id="setStatus">Change status</button></div>`) +
    (f.note ? `<div class="card" style="border-color:var(--warn)"><b>Status note</b> — ${esc(f.note)} <span class="faint">(${esc(f.updated_by)}, ${when(f.updated_at)})</span></div>` : "") +
    `<div class="card"><dl class="kv"><dt>Currency / timezone</dt><dd>${esc(f.currency)} · ${esc(f.timezone)}</dd><dt>Monthly grocery budget</dt><dd>${money(f.monthly_grocery_budget)}</dd></dl></div>
    <div class="card"><div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" aria-selected="${k === tab}" class="${k === tab ? "on" : ""}" onclick="location.hash='#/family/${esc(id)}?tab=${k}'">${l}</button>`).join("")}</div>${body}</div>`);
  document.getElementById("setStatus").onclick = async () => {
    const v = await ask({ title: "Family status", text: "Suspended families are turned away by the app's API. Their data is not touched.",
      fields: [{ name: "status", label: "Status", type: "select", value: f.status, options: [["active", "Active"], ["under_review", "Under review"], ["suspended", "Suspended"]].map(([value, label]) => ({ value, label })) },
        { name: "note", label: "Reason", placeholder: "Required unless setting active" }], confirm: "Save" });
    if (v) act(`/families/${id}/status`, v, "Status saved");
  };
  wireMemberButtons(f.members);
  wireTaskButtons(f.tasks, f.members);
  wirePostButtons();
  wireFixButtons();
}

function memberCard(m) {
  return `<div class="member ${m.is_active ? "" : "off"}"><div class="group-head"><b>${esc(m.name)}</b>${m.role === "owner" ? `<span class="pill good">owner</span>` : `<span class="pill">member</span>`}</div>
    <div class="faint">${esc(m.relation || "—")} · ${esc(m.phone || "no phone")} · ${esc(m.id)}</div>
    <div style="margin-top:6px">${m.is_active ? "" : `<span class="pill bad">removed</span> `}${m.session ? `Signed in on ${esc(m.session.device || "a phone")}, seen ${ago(m.session.last_seen)}` : `<span class="muted">Not signed in</span>`}</div>
    <div class="row">
      ${m.session ? `<button class="btn small" data-signout="${esc(m.id)}">Force sign-out</button>` : ""}
      <button class="btn small" data-role="${esc(m.id)}">${m.role === "owner" ? "Make member" : "Make owner"}</button>
      <button class="btn small ${m.is_active ? "danger" : ""}" data-active="${esc(m.id)}">${m.is_active ? "Remove" : "Restore"}</button>
    </div></div>`;
}
function wireMemberButtons(members) {
  const byId = Object.fromEntries(members.map((m) => [m.id, m]));
  document.querySelectorAll("[data-signout]").forEach((b) => b.onclick = async () => {
    const m = byId[b.dataset.signout];
    const v = await ask({ title: `Sign ${m.name} out?`, text: "Their phone asks them to sign in again and reloads everything from the server. Nothing is deleted.", fields: [{ name: "note", label: "Note" }], confirm: "Sign out" });
    if (v) act(`/members/${m.id}/sign-out`, v, `${m.name} signed out`);
  });
  document.querySelectorAll("[data-role]").forEach((b) => b.onclick = async () => {
    const m = byId[b.dataset.role], role = m.role === "owner" ? "member" : "owner";
    const v = await ask({ title: `Make ${m.name} ${role}?`, fields: [{ name: "note", label: "Note" }], confirm: "Change role" });
    if (v) act(`/members/${m.id}/role`, { role, note: v.note }, "Role changed");
  });
  document.querySelectorAll("[data-active]").forEach((b) => b.onclick = async () => {
    const m = byId[b.dataset.active];
    const v = m.is_active
      ? await ask({ title: `Remove ${m.name} from the family?`, text: "They are signed out and stop receiving posts. Their past posts, tasks and purchases stay.", fields: [{ name: "note", label: "Reason", required: true }], confirm: "Remove", danger: true })
      : await ask({ title: `Restore ${m.name}?`, fields: [{ name: "note", label: "Note" }], confirm: "Restore" });
    if (v) act(`/members/${m.id}/active`, { is_active: !m.is_active, note: v.note }, m.is_active ? "Removed" : "Restored");
  });
}

function taskTable(tasks, members, showFamily) {
  return `<div class="tablewrap"><table><thead><tr><th>Task</th>${showFamily ? "<th>Family</th>" : ""}<th>Status</th><th>Assigned</th><th>Due</th><th>Updated</th><th></th></tr></thead><tbody>
  ${tasks.map((t) => {
    const overdue = t.due_at && new Date(t.due_at) < new Date() && !["done", "cancelled"].includes(t.status);
    return `<tr><td>${esc(t.title)}<div class="faint">${esc(pretty(t.category))} · by ${esc(t.created_by || "—")}${t.done_at ? " · done " + when(t.done_at) : ""}</div></td>
    ${showFamily ? `<td><a href="#/family/${esc(t.household_id)}?tab=tasks">${esc(t.household)}</a></td>` : ""}
    <td>${statusPill(t.status)}${t.priority === "urgent" ? ` <span class="pill bad">urgent</span>` : ""}</td>
    <td>${t.assigned_to ? esc(t.assigned_to) : `<span class="pill warn">nobody</span>`}</td>
    <td>${when(t.due_at)}${overdue ? ` <span class="pill bad">overdue</span>` : ""}</td><td class="faint">${ago(t.updated_at)}</td>
    <td style="white-space:nowrap"><button class="btn small" data-tstatus="${esc(t.id)}">Status</button> <button class="btn small" data-tassign="${esc(t.id)}">Reassign</button> <button class="btn small" data-tlog="${esc(t.id)}">History</button></td></tr>`;
  }).join("") || `<tr><td colspan="7" class="empty">No tasks match.</td></tr>`}</tbody></table></div>`;
}
function wireTaskButtons(tasks, members) {
  const byId = Object.fromEntries(tasks.map((t) => [t.id, t]));
  document.querySelectorAll("[data-tstatus]").forEach((b) => b.onclick = async () => {
    const t = byId[b.dataset.tstatus];
    const v = await ask({ title: `Status of “${t.title}”`, text: "Logged as a task event the family can see, marked as an admin change. Done tasks move to history after 3 days.",
      fields: [{ name: "status", label: "Status", type: "select", value: t.status, options: TASK_STATUSES.map((s) => ({ value: s, label: pretty(s) })) }, { name: "note", label: "Note" }], confirm: "Save" });
    if (v) act(`/tasks/${t.id}/status`, v, "Task updated");
  });
  document.querySelectorAll("[data-tassign]").forEach((b) => b.onclick = async () => {
    const t = byId[b.dataset.tassign];
    const ms = members || (await api("/families/" + t.household_id)).members;
    const options = ms.filter((m) => m.is_active).map((m) => ({ value: m.id, label: m.name }));
    if (!options.length) return toast("This family has no active members", true);
    const v = await ask({ title: `Reassign “${t.title}”`, fields: [{ name: "member_id", label: "Assign to", type: "select", value: t.assigned_to_member_id, options }, { name: "note", label: "Note" }], confirm: "Reassign" });
    if (v) act(`/tasks/${t.id}/assign`, v, "Reassigned");
  });
  document.querySelectorAll("[data-tlog]").forEach((b) => b.onclick = async () => {
    const ev = await api(`/tasks/${b.dataset.tlog}/events`);
    await ask({ title: "Task history", text: ev.map((e) => `${when(e.at)} — ${e.from ? pretty(e.from) + " → " : ""}${pretty(e.to)}${e.member ? " by " + e.member : ""}${e.note ? " · " + e.note : ""}`).join("\n") || "No events recorded.", confirm: "Close" });
  });
}

function postTable(posts, showFamily) {
  return `<div class="tablewrap"><table><thead><tr><th>Post</th>${showFamily ? "<th>Family</th>" : ""}<th>Status</th><th>Recipients</th><th>Created</th><th></th></tr></thead><tbody>
  ${posts.map((p) => `<tr><td>${esc(p.title || p.raw_text)}<div class="faint">${esc(p.kind)} · by ${esc(p.author || "—")}${p.missing.length ? " · missing " + esc(p.missing.join(", ")) : ""}</div></td>
    ${showFamily ? `<td><a href="#/family/${esc(p.household_id)}?tab=posts">${esc(p.household)}</a></td>` : ""}
    <td>${statusPill(p.status)}</td>
    <td>${p.recipients.map((r) => `<div>${esc(r.member)} · ${r.acknowledged_at ? `<span class="pill good">acknowledged</span>` : r.seen_at ? "seen" : r.delivered_at ? "delivered" : `<span class="pill warn">not delivered</span>`}</div>`).join("") || `<span class="muted">${p.status === "published" ? "none" : "—"}</span>`}</td>
    <td class="faint">${when(p.created_at)}</td>
    <td style="white-space:nowrap">${p.status === "published" ? `<button class="btn small" data-presend="${esc(p.id)}">Resend</button> ` : ""}${["draft", "clarifying", "ready"].includes(p.status) ? `<button class="btn small" data-precheck="${esc(p.id)}">Re-check</button> ` : ""}${p.status !== "cancelled" ? `<button class="btn small danger" data-pcancel="${esc(p.id)}">Cancel</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="6" class="empty">No posts match.</td></tr>`}</tbody></table></div>`;
}
function wirePostButtons() {
  document.querySelectorAll("[data-presend]").forEach((b) => b.onclick = async () => {
    const v = await ask({ title: "Resend this post?", text: "Adds anyone missing and shows the pop-up again to members who haven't acknowledged it.", fields: [{ name: "note", label: "Note" }], confirm: "Resend" });
    if (v) act(`/posts/${b.dataset.presend}/resend`, v, "Post resent");
  });
  document.querySelectorAll("[data-precheck]").forEach((b) => b.onclick = async () => {
    const v = await ask({ title: "Re-check this post?", text: "Re-runs the completeness check on its fields. It is never sent on the author's behalf.", fields: [{ name: "note", label: "Note" }], confirm: "Re-check" });
    if (v) act(`/posts/${b.dataset.precheck}/recheck`, v, "Re-checked");
  });
  document.querySelectorAll("[data-pcancel]").forEach((b) => b.onclick = async () => {
    const v = await ask({ title: "Cancel this post?", text: "Takes it off everyone's feed and stops its reminders. The row is kept for audit.", fields: [{ name: "note", label: "Reason", required: true }], confirm: "Cancel post", danger: true });
    if (v) act(`/posts/${b.dataset.pcancel}/cancel`, v, "Post cancelled");
  });
}

async function pageTasks(p) {
  const f = { status: p.get("status") ?? "active", household: p.get("household") || "", q: p.get("q") || "", overdue: p.get("overdue") === "true" };
  const [tasks, fam] = await Promise.all([api("/tasks" + qs({ status: f.status, household_id: f.household, q: f.q, overdue: f.overdue })), familyOptions(f.household)]);
  shell("tasks", head("Household", "Tasks", `${tasks.length} shown`) + `<div class="filters">
    <select id="ts" data-key="status" aria-label="Status"><option value="active" ${f.status === "active" ? "selected" : ""}>Not finished (any stage)</option><option value="" ${f.status === "" ? "selected" : ""}>All statuses</option>${TASK_STATUSES.map((s) => `<option value="${s}" ${f.status === s ? "selected" : ""}>${pretty(s)}</option>`).join("")}</select>
    <select id="th" data-key="household" aria-label="Family">${fam}</select>
    <input type="search" id="tq" data-key="q" placeholder="Search title" value="${esc(f.q)}" aria-label="Search title">
    <label class="muted"><input type="checkbox" id="to" data-key="overdue" ${f.overdue ? "checked" : ""}> Overdue only</label></div>
    <div class="card">${taskTable(tasks, null, true)}</div>`);
  onFilters("tasks", ["ts", "th", "tq", "to"]);
  wireTaskButtons(tasks, null);
}

async function pagePosts(p) {
  const f = { status: p.get("status") || "", household: p.get("household") || "", kind: p.get("kind") || "" };
  const [posts, fam] = await Promise.all([api("/posts" + qs({ status: f.status, household_id: f.household, kind: f.kind })), familyOptions(f.household)]);
  const kinds = ["grocery", "task", "ticket_booking", "bill", "alert", "appointment", "errand", "shopping", "misc"];
  shell("posts", head("Feed", "Feed posts", "What each member was sent, and whether it reached them") + `<div class="filters">
    <select id="ps" data-key="status" aria-label="Status"><option value="">All statuses</option>${["draft", "clarifying", "ready", "published", "done", "cancelled"].map((s) => `<option ${f.status === s ? "selected" : ""}>${s}</option>`).join("")}</select>
    <select id="pk" data-key="kind" aria-label="Kind"><option value="">All kinds</option>${kinds.map((k) => `<option value="${k}" ${f.kind === k ? "selected" : ""}>${pretty(k)}</option>`).join("")}</select>
    <select id="ph" data-key="household" aria-label="Family">${fam}</select></div>
    <div class="card">${postTable(posts, true)}</div>`);
  onFilters("posts", ["ps", "pk", "ph"]);
  wirePostButtons();
}

function issueLink(i) {
  if (i.ref_kind === "task") return `#/tasks${qs({ household: i.household_id, status: "" })}`;
  if (i.ref_kind === "post" || i.ref_kind === "post_recipient") return `#/posts${qs({ household: i.household_id })}`;
  return i.household_id ? `#/family/${i.household_id}` : null;
}
function issueList(issues, checks) {
  if (!issues.length) return `<div class="empty">Nothing wrong found. Every check passed.</div>`;
  const groups = {};
  issues.forEach((i) => (groups[i.check] = groups[i.check] || []).push(i));
  const summary = Object.fromEntries((checks || []).map((c) => [c.name, c.summary]));
  return Object.entries(groups).map(([check, list]) => `<div style="margin-bottom:12px"><div class="group-head"><h3 style="font-size:16px">${esc(summary[check] || pretty(check))} <span class="faint">(${list.length})</span></h3>
    ${list[0].fix_label && list.length > 1 ? `<button class="btn small" data-fixall="${esc(check)}" data-refs="${esc(list.map((i) => i.ref).join(","))}">${esc(list[0].fix_label)} · all ${list.length}</button>` : ""}</div>
    ${list.map((i) => { const link = issueLink(i); return `<div class="issue">${sev(i.severity)}<div><div class="title">${esc(i.title)}</div><div class="detail">${esc(i.detail)}</div><div class="faint">${esc(i.household_id || "")} · ${esc(i.ref_kind)} ${esc(i.ref)}</div></div>
      <div>${i.fix_label ? `<button class="btn small primary" data-fix="${esc(check)}" data-ref="${esc(i.ref)}">${esc(i.fix_label)}</button>` : link ? `<a class="btn small" href="${link}">Open</a>` : ""}</div></div>`; }).join("")}</div>`).join("");
}
function wireFixButtons() {
  const run = async (check, refs, label) => {
    const v = await ask({ title: `${label}?`, text: `Applies the fix to ${refs.length} row${refs.length > 1 ? "s" : ""}. Each is re-checked first and logged in the audit log.`, confirm: label });
    if (!v) return;
    try {
      const out = await api("/issues/fix", { check, refs });
      toast(`Fixed ${out.fixed.length}${out.skipped.length ? `, skipped ${out.skipped.length} (${out.skipped[0].why})` : ""}`, !out.fixed.length);
      S.issues = null;
      render();
    } catch (e) { toast(e.message, true); }
  };
  document.querySelectorAll("[data-fix]").forEach((b) => b.onclick = () => run(b.dataset.fix, [b.dataset.ref], b.textContent));
  document.querySelectorAll("[data-fixall]").forEach((b) => b.onclick = () => run(b.dataset.fixall, b.dataset.refs.split(","), b.textContent.split(" · ")[0]));
}

async function pageIssues(p) {
  const household = p.get("household") || "", severity = p.get("severity") || "";
  const [data, fam] = await Promise.all([api("/issues" + qs({ household_id: household })), familyOptions(household)]);
  const issues = data.issues.filter((i) => !severity || i.severity === severity);
  shell("issues", head("Support", "Issues", "Data that keeps something hidden or stuck in the family app. Fixes only restore states the app already understands.") + `
    <div class="filters"><select id="ih" data-key="household" aria-label="Family">${fam}</select>
    <select id="iv" data-key="severity" aria-label="Severity"><option value="">All severities</option>${["high", "medium", "low"].map((s) => `<option value="${s}" ${s === severity ? "selected" : ""}>${SEV[s][1]}</option>`).join("")}</select>
    <button class="btn" onclick="render()">Re-scan</button></div>
    <div class="card">${issueList(issues, data.checks)}</div>
    <div class="card"><h2>What is checked</h2><table><thead><tr><th>Check</th><th>Severity</th><th>Automatic fix</th></tr></thead><tbody>
    ${data.checks.map((c) => `<tr><td>${esc(c.summary)}<div class="faint">${esc(c.name)}</div></td><td>${sev(c.severity)}</td><td>${c.fix_label ? esc(c.fix_label) : `<span class="muted">needs a choice — open the row</span>`}</td></tr>`).join("")}</tbody></table></div>`);
  onFilters("issues", ["ih", "iv"]);
  wireFixButtons();
}

// ------------------------------------------------------------------ Passkey Issue
const RELATIONS = ["Mom", "Dad", "Son", "Daughter", "Grandma", "Grandpa"];

function keyStatus(k) {
  if (!k) return `<span class="pill warn">no passkey</span>`;
  if (k.locked_until && new Date(k.locked_until) > new Date()) return `<span class="pill bad">locked · too many tries</span>`;
  return `<span class="pill good">has passkey</span> <span class="faint">${ago(k.issued_at)} by ${esc(k.issued_by)}</span>`;
}

function showPasskey(r) {
  return new Promise((resolve) => {
    const scrim = document.createElement("div");
    scrim.className = "scrim";
    scrim.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="Passkey for ${esc(r.name)}">
      <div class="kicker">Passkey for ${esc(r.name)}</div>
      <div class="passkey-big" aria-label="${esc(r.passkey.split("").join(" "))}">${esc(r.passkey)}</div>
      <p>Read it out to ${esc(r.name)} (${esc(phoneFmt(r.phone))}), or tell them on a call. They type it on their phone with their name and number.
This is the only time it is shown. If it gets lost, reset it here.${r.replaced ? "\nTheir old passkey stopped working and their phone was signed out." : ""}</p>
      <div class="actions"><button class="btn" data-copy>Copy</button><button class="btn primary" data-x>Done</button></div></div>`;
    const done = () => { scrim.remove(); document.removeEventListener("keydown", onKey); resolve(); };
    const onKey = (e) => { if (e.key === "Escape") done(); };
    document.addEventListener("keydown", onKey);
    scrim.querySelector("[data-x]").onclick = done;
    scrim.querySelector("[data-copy]").onclick = async (e) => {
      try { await navigator.clipboard.writeText(r.passkey); e.target.textContent = "Copied"; } catch { e.target.textContent = "Select and copy it"; }
    };
    document.body.appendChild(scrim);
    scrim.querySelector("[data-x]").focus();
  });
}

async function pagePasskeys() {
  const d = await api("/passkeys");
  S.waiting = d.requests; S.seenWaiting = new Set(d.requests.map((r) => r.id));
  const homeOptions = (sel) => d.homes.map((h) => `<option value="${esc(h.id)}" ${h.id === sel ? "selected" : ""}>${esc(h.name)}</option>`).join("") + `<option value="">New home (they become its owner)</option>`;
  const reqCard = (r) => `<div class="req" data-req="${esc(r.id)}">
    <div class="req-who"><span class="key" aria-hidden="true">🔑</span><div><b>${esc(r.name)}</b> is trying to sign in
      <div class="faint">${esc(phoneFmt(r.phone))} · ${ago(r.last_at)}${r.times > 1 ? ` · asked ${r.times} times` : ""}</div></div></div>
    ${r.member
      ? `<div class="muted">Already in <a href="#/family/${esc(r.member.household_id)}">${esc(r.member.household)}</a> as ${esc(r.member.name)}${r.member.relation ? ` (${esc(r.member.relation)})` : ""}. ${r.member.passkey ? "A new passkey replaces their old one." : ""}</div>`
      : `<div class="req-form">
          <label>Home<select data-k="household_id">${homeOptions(d.homes[0]?.id)}</select></label>
          <label>Who they are<input type="text" data-k="relation" list="relations" placeholder="e.g. Mom" autocomplete="off"></label>
          <label>Role<select data-k="role"><option value="member">Member</option><option value="owner">Owner</option></select></label>
        </div>`}
    <div class="row"><button class="btn primary" data-approve="${esc(r.id)}">Generate passkey</button>
      <button class="btn" data-dismiss="${esc(r.id)}">Not someone I know</button></div></div>`;

  shell("passkeys", head("Sign-in", "Passkey Issue", "When someone types their name and number on a new phone, they wait here for you to give them a passkey.") +
    `<datalist id="relations">${RELATIONS.map((x) => `<option value="${x}">`).join("")}</datalist>
    <div class="card"><h2>Waiting${d.requests.length ? ` <span class="pill warn">${d.requests.length}</span>` : ""}</h2>
      ${d.requests.map(reqCard).join("") || `<div class="empty">Nobody is waiting. This page checks every 20 seconds and tells you when someone tries to sign in.</div>`}</div>
    <div class="card"><h2>Everyone in a home</h2>
      <p class="muted" style="margin-top:0">Give a passkey to anyone who doesn't have one yet, or reset a lost one. Resetting signs that person out until they type the new one.</p>
      <div class="tablewrap"><table><thead><tr><th>Person</th><th>Home</th><th>Number</th><th>Passkey</th><th>Signed in</th><th></th></tr></thead><tbody>
      ${d.members.map((m) => `<tr><td><b>${esc(m.name)}</b>${m.relation ? `<div class="faint">${esc(m.relation)}${m.role === "owner" ? " · owner" : ""}</div>` : ""}</td>
        <td><a href="#/family/${esc(m.household_id)}">${esc(m.household)}</a></td><td>${esc(phoneFmt(m.phone) || "—")}</td>
        <td>${keyStatus(m.passkey)}</td><td>${m.signed_in ? `${esc(m.signed_in.device || "a phone")}<div class="faint">seen ${ago(m.signed_in.last_seen)}</div>` : `<span class="muted">no</span>`}</td>
        <td style="white-space:nowrap">${m.phone ? `<button class="btn small ${m.passkey ? "" : "primary"}" data-issue="${esc(m.id)}">${m.passkey ? "Reset passkey" : "Generate passkey"}</button>` : `<span class="faint">no number</span>`}</td></tr>`).join("") || `<tr><td colspan="6" class="empty">Nobody yet.</td></tr>`}
      </tbody></table></div></div>`);

  document.querySelectorAll("[data-approve]").forEach((b) => b.onclick = async () => {
    const card = b.closest("[data-req]"), body = {};
    card.querySelectorAll("[data-k]").forEach((el) => { body[el.dataset.k] = el.value.trim(); });
    b.disabled = true;
    try {
      const r = await api(`/passkeys/requests/${b.dataset.approve}/approve`, body);
      await showPasskey(r);
      familiesCache = null;
    } catch (e) { toast(e.message, true); }
    render();
  });
  document.querySelectorAll("[data-dismiss]").forEach((b) => b.onclick = async () => {
    const r = d.requests.find((x) => x.id === b.dataset.dismiss);
    const v = await ask({ title: `Dismiss ${r.name}?`, text: `${phoneFmt(r.phone)} won't get a passkey. If they ask again they'll show up here again.`, confirm: "Dismiss" });
    if (v) act(`/passkeys/requests/${r.id}/dismiss`, {}, "Dismissed");
  });
  document.querySelectorAll("[data-issue]").forEach((b) => b.onclick = async () => {
    const m = d.members.find((x) => x.id === b.dataset.issue);
    if (m.passkey) {
      const v = await ask({ title: `Reset ${m.name}'s passkey?`, text: "Their old passkey stops working and their phone is signed out until they type the new one.", confirm: "Reset passkey", danger: true });
      if (!v) return;
    }
    try { await showPasskey(await api(`/members/${m.id}/passkey`, {})); } catch (e) { toast(e.message, true); }
    render();
  });
}

function auditTable(rows) {
  return `<div class="tablewrap"><table><thead><tr><th>When</th><th>Admin</th><th>Action</th><th>Target</th><th>Note</th><th>Change</th></tr></thead><tbody>
  ${rows.map((a) => `<tr><td>${when(a.at)}</td><td>${esc(a.admin)}</td><td>${esc(pretty(a.action))}</td><td>${esc(a.target_kind)} <span class="faint">${esc(a.target_id)}</span>${a.household_id ? `<div><a href="#/family/${esc(a.household_id)}">${esc(a.household_id)}</a></div>` : ""}</td><td>${esc(a.note || "—")}</td><td><pre class="json">${esc(JSON.stringify(a.detail, null, 1))}</pre></td></tr>`).join("") || `<tr><td colspan="6" class="empty">No admin actions yet.</td></tr>`}</tbody></table></div>`;
}
async function pageAudit() {
  const rows = await api("/audit");
  shell("audit", head("Accountability", "Audit log", "Every change made from this console, newest first") + `<div class="card">${auditTable(rows)}</div>`);
}

// ------------------------------------------------------------------ login + router
function signOut(msg) {
  S.token = null; sessionSet("hearth_admin_token", null);
  renderLogin(msg);
}
function renderLogin(msg) {
  root.innerHTML = `<div class="login"><form id="login"><div class="kicker">Hearth</div><h1>Admin console</h1>
    <p class="muted" style="margin:0 0 6px">Use the ADMIN_TOKEN configured on this server. It is kept for this tab only.</p>
    <label for="lt" class="faint">Admin token</label><input id="lt" type="password" autocomplete="current-password" required>
    <label for="ln" class="faint">Your name (for the audit log)</label><input id="ln" type="text" value="${esc(S.admin)}" required>
    <div class="err-text">${esc(msg && msg !== "Signed out" ? msg : "")}</div><button class="btn primary">Sign in</button></form></div>`;
  document.getElementById("login").onsubmit = async (e) => {
    e.preventDefault();
    S.token = document.getElementById("lt").value.trim();
    S.admin = document.getElementById("ln").value.trim();
    try {
      await api("/me");
      sessionSet("hearth_admin_token", S.token); sessionSet("hearth_admin_name", S.admin);
      render();
      pollWaiting();
    } catch {}
  };
}

async function render() {
  if (!S.token) return renderLogin();
  const [path, query] = (location.hash.slice(2) || "overview").split("?");
  const p = new URLSearchParams(query || "");
  const [page, id] = path.split("/");
  try {
    if (S.issues == null) {
      api("/issues").then((d) => { S.issues = d.issues.filter((i) => i.severity === "high").length; const c = document.querySelector('nav a[href="#/issues"]'); if (c && S.issues && !c.querySelector(".count")) c.insertAdjacentHTML("beforeend", `<span class="count">${S.issues}</span>`); }).catch(() => {});
    }
    const pages = { overview: pageOverview, passkeys: pagePasskeys, purchases: pagePurchases, families: pageFamilies, tasks: pageTasks, posts: pagePosts, issues: pageIssues, audit: pageAudit };
    if (page === "family" && id) await pageFamily(decodeURIComponent(id), p);
    else await (pages[page] || pageOverview)(p);
  } catch (e) {
    if (S.token) shell(page, `<div class="card"><h2>Couldn't load this page</h2><p class="muted">${esc(e.message)}</p><button class="btn" onclick="render()">Try again</button></div>`);
  }
}
window.addEventListener("hashchange", render);
render();
pollWaiting();
