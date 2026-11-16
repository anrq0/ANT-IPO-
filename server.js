import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const E = process.env;
const C = {
  port: +E.PORT || 3000, key: E.GEMINI_API_KEY, model: E.GEMINI_MODEL || "gemini-3.8-flash",
  symbol: E.SYMBOL || "ANT", topic: E.NTFY_TOPIC, ntfy: E.NTFY_SERVER || "https://ntfy.sh",
  priceEvery: +E.PRICE_SECONDS || 60, aiEvery: +E.AI_SECONDS || 300,
  move: +E.ALERT_PRICE_PCT || 3, minImp: +E.ALERT_MIN_IMPORTANCE || 4, cooldown: +E.ALERT_COOLDOWN_SECONDS || 600,
  listing: E.LISTING_AT || "2026-11-19T14:30:00Z", admin: E.ADMIN_TOKEN, url: E.PUBLIC_URL,
};
const FILE = path.join(dir, "data.json");
const HTML = fs.readFileSync(path.join(dir, "public", "index.html"));
let S = { prices: [], analyses: [], alerts: [], seen: [], last: {} };
try { S = { ...S, ...JSON.parse(fs.readFileSync(FILE, "utf8")) }; } catch {}
const save = () => { try { fs.writeFileSync(FILE, JSON.stringify(S)); } catch {} };
const log = (...a) => console.log(new Date().toISOString(), ...a);

// ---------- Gemini (API Google) avec recherche Google ----------
async function gemini(text, { system, search = true } = {}) {
  if (!C.key) throw new Error("GEMINI_API_KEY manquante");
  const body = { contents: [{ role: "user", parts: [{ text }] }], generationConfig: { temperature: 0.4 } };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (search) body.tools = [{ google_search: {} }];
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${C.model}:generateContent`, {
    method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": C.key }, body: JSON.stringify(body),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message || "Erreur " + r.status);
  const c = d.candidates?.[0];
  const out = (c?.content?.parts || []).map((p) => p.text || "").join("");
  const sources = (c?.groundingMetadata?.groundingChunks || []).map((k) => k.web)
    .filter((w) => w?.uri).slice(0, 6).map((w) => ({ title: w.title || w.uri, url: w.uri }));
  return { text: out, sources };
}

// ---------- Notifications iPhone (ntfy) ----------
async function notify(title, message, key, priority = 4) {
  const now = Date.now();
  if (key !== "test" && now - (S.last[key] || 0) < C.cooldown * 1000) return;
  S.last[key] = now;
  S.alerts.unshift({ t: now, title, message });
  S.alerts = S.alerts.slice(0, 30);
  log("ALERTE", title);
  if (!C.topic) return;
  try {
    await fetch(C.ntfy, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ topic: C.topic, title, message, priority, tags: ["chart_with_upwards_trend"], click: C.url }) });
  } catch (e) { log("ntfy", e.message); }
}

// ---------- Cours (source non officielle, active à partir de la cotation) ----------
async function getPrice() {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${C.symbol}?interval=1m&range=1d`,
    { headers: { "user-agent": "Mozilla/5.0" } });
  if (!r.ok) return null;
  const m = (await r.json()).chart?.result?.[0]?.meta;
  const nasdaq = ["NMS", "NGM", "NCM"].includes(m?.exchangeName);
  return nasdaq && typeof m.regularMarketPrice === "number" ? m.regularMarketPrice : null;
}
async function tickPrice() {
  if (Date.now() < Date.parse(C.listing)) return;
  try {
    const p = await getPrice();
    if (p == null) return;
    const now = Date.now(), first = !S.prices.length;
    S.prices.push({ t: now, p });
    S.prices = S.prices.slice(-1500);
    if (first) await notify(`${C.symbol} est coté`, `Premier cours repéré : ${p} $`, "listed", 5);
    const ref = [...S.prices].reverse().find((x) => x.t <= now - 600000);
    if (ref) {
      const pct = ((p - ref.p) / ref.p) * 100;
      if (Math.abs(pct) >= C.move)
        await notify(`${C.symbol} ${pct > 0 ? "↑" : "↓"} ${pct.toFixed(1)} % en 10 min`, `Cours : ${p} $ (avant : ${ref.p} $)`, "move", 4);
    }
    save();
  } catch (e) { log("prix", e.message); }
}

// ---------- Analyse IA ----------
const ctx = () => {
  const p = S.prices.at(-1)?.p, a = S.analyses.at(-1);
  return `Date : ${new Date().toLocaleString("fr-FR")}. Anthropic : S-1 public le 26/10/2026, fourchette 70-78 $ déposée le 10/11, prix attendu le 18/11, cotation Nasdaq « ${C.symbol} » attendue le 19/11/2026. ` +
    (p ? `Dernier cours mesuré : ${p} $. ` : "Pas encore de cours (avant cotation). ") + (a ? `Dernier événement noté : ${a.event}. ` : "");
};
async function tickAI() {
  try {
    const { text, sources } = await gemini(
      `${ctx()}Utilise la recherche Google : dernières informations (Reuters, CNBC, Bloomberg, SEC) sur l’IPO d’Anthropic et le contexte tech/IA. ` +
      `Réponds UNIQUEMENT par un objet JSON en français : tendance (hausse|baisse|stable), confiance (0-100), importance (1-5 ; 5 = événement majeur : prix final fixé, début des cotations, forte variation, annonce décisive), ` +
      `event (libellé court de l’événement le plus important), resume (2 phrases), prediction (2 phrases, prudente), risques (3 textes courts). N’invente aucun chiffre.`);
    const j = JSON.parse(text.match(/\{[\s\S]*\}/)[0]);
    const a = { t: Date.now(), trend: ["hausse", "baisse", "stable"].includes(j.tendance) ? j.tendance : "stable",
      conf: Math.max(0, Math.min(100, +j.confiance || 0)), imp: Math.max(1, Math.min(5, +j.importance || 1)),
      event: String(j.event || "").slice(0, 120), summary: j.resume, prediction: j.prediction,
      risks: Array.isArray(j.risques) ? j.risques.slice(0, 3) : [], sources };
    S.analyses.push(a); S.analyses = S.analyses.slice(-300);
    const id = a.event.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 60);
    if (a.imp >= C.minImp && id && !S.seen.includes(id)) {
      S.seen.push(id); S.seen = S.seen.slice(-100);
      await notify(`Anthropic : ${a.event}`, `${a.summary}\nTendance : ${a.trend} (${a.conf} %)`, "ai", a.imp >= 5 ? 5 : 4);
    }
    save();
  } catch (e) { log("analyse", e.message); }
}

// ---------- Serveur ----------
const hits = new Map();
const limited = (k, max) => { const n = Date.now(), a = (hits.get(k) || []).filter((t) => n - t < 3600000); a.push(n); hits.set(k, a); return a.length > max; };
const send = (res, code, body, type = "application/json") => { res.writeHead(code, { "content-type": type + "; charset=utf-8" }); res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
const readBody = (req) => new Promise((ok, ko) => { let b = ""; req.on("data", (c) => { b += c; if (b.length > 5000) { ko(new Error("Message trop long")); req.destroy(); } }); req.on("end", () => { try { ok(JSON.parse(b || "{}")); } catch { ok({}); } }); });

http.createServer(async (req, res) => {
  const path_ = new URL(req.url, "http://x").pathname;
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
  try {
    if (path_ === "/health") return send(res, 200, "ok", "text/plain");
    if (path_ === "/api/state") return send(res, 200, {
      symbol: C.symbol, range: [70, 78], listing: C.listing, prices: S.prices.slice(-400), analyses: S.analyses.slice(-60),
      alerts: S.alerts.slice(0, 10), ai: !!C.key, notif: !!C.topic, needToken: !!C.admin });
    if (req.method === "POST" && path_ === "/api/ask") {
      if (limited("ask" + ip, 12)) return send(res, 429, { error: "Limite atteinte (12 questions par heure)." });
      const q = String((await readBody(req)).q || "").trim().slice(0, 500);
      if (!q) return send(res, 400, { error: "Question vide" });
      const r = await gemini(`${ctx()}\nQuestion : ${q}`, { system:
        "Tu es un formateur en bourse spécialisé dans les introductions en bourse (IPO). Tu expliques en français, simplement, avec de courts paragraphes et des exemples chiffrés. " +
        "Tu t’appuies sur la recherche Google pour les faits récents. Tu ne donnes jamais de conseil d’achat ou de vente personnalisé : tu rappelles brièvement que ce n’est pas un conseil financier et que la perte en capital est possible." });
      return send(res, 200, { answer: r.text, sources: r.sources });
    }
    if (req.method === "POST" && path_ === "/api/test-notify") {
      if (C.admin && req.headers["x-admin-token"] !== C.admin) return send(res, 401, { error: "Code admin requis" });
      if (limited("test" + ip, 5)) return send(res, 429, { error: "Trop de tests" });
      await notify("Test de notification", "Si tu lis ceci, les alertes fonctionnent.", "test", 3);
      return send(res, 200, { ok: !!C.topic });
    }
    send(res, 200, HTML, "text/html");
  } catch (e) { send(res, 500, { error: e.message }); }
}).listen(C.port, () => log(`Serveur : http://localhost:${C.port} | IA ${C.key ? "oui" : "NON"} | notifs ${C.topic ? "oui" : "NON"}`));

setInterval(tickPrice, C.priceEvery * 1000);
setInterval(() => C.key && tickAI(), C.aiEvery * 1000);
tickPrice(); if (C.key) tickAI();
