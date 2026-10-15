import { getStore } from "@netlify/blobs";
import { timingSafeEqual } from "node:crypto";

// Funkcja działa w tle (nazwa kończy się na -background), więc może pracować do 15 minut.
// Wynik zapisuje w bazie, a strona sprawdza go co kilka sekund.

const okPw = (req) => {
  const p = process.env.ADMIN_PASSWORD || "";
  const g = req.headers.get("x-admin-password") || "";
  if (!p || !g) return false;
  const a = Buffer.from(p), b = Buffer.from(g);
  return a.length === b.length && timingSafeEqual(a, b);
};

const SYS = `Jesteś nauczycielem, który tworzy materiały do nauki z notatki ucznia.
Na podstawie podanej notatki przygotuj fiszki i pytania quizowe.

Zasady:
- Korzystaj wyłącznie z informacji zawartych w notatce. Nie dodawaj faktów z zewnątrz.
- Pytania muszą być jednoznaczne i zrozumiałe bez zaglądania do notatki. Nie pisz pytań w stylu "co jest napisane w notatce".
- Fiszki: 15-30 sztuk. Krótkie pytanie i zwięzła odpowiedź (najwyżej 2 zdania). Zróżnicuj je: pojęcia, daty i wydarzenia, osoby, przyczyny i skutki, porównania.
- Quiz: 10-20 pytań jednokrotnego wyboru, dokładnie 4 odpowiedzi, jedna poprawna. Błędne odpowiedzi mają być realistyczne i podobnej długości do poprawnej. Pole "ans" to indeks poprawnej odpowiedzi (0-3). Pole "ex" to krótkie wyjaśnienie oparte na notatce.
- Język: polski.

Odpowiedz WYŁĄCZNIE poprawnym JSON-em, bez komentarza i bez znaczników markdown, w formacie:
{"cards":[{"q":"...","a":"..."}],"quiz":[{"q":"...","opts":["...","...","...","..."],"ans":0,"ex":"..."}]}`;

const toText = (h) =>
  String(h || "")
    .replace(/<\/(p|div|li|h[1-6]|blockquote)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n").trim();

const str = (v, n) => String(v ?? "").trim().slice(0, n);

export const parseDeck = (out) => {
  const i = out.indexOf("{"), j = out.lastIndexOf("}");
  if (i < 0 || j < i) throw new Error("brak JSON");
  const d = JSON.parse(out.slice(i, j + 1));
  const cards = (Array.isArray(d.cards) ? d.cards : [])
    .map((c) => ({ q: str(c && c.q, 300), a: str(c && c.a, 500) }))
    .filter((c) => c.q && c.a)
    .slice(0, 40);
  const quiz = (Array.isArray(d.quiz) ? d.quiz : [])
    .map((q) => ({
      q: str(q && q.q, 400),
      opts: (Array.isArray(q && q.opts) ? q.opts : []).map((o) => str(o, 250)).filter(Boolean).slice(0, 4),
      ans: Number.isInteger(q && q.ans) ? q.ans : -1,
      ex: str(q && q.ex, 400),
    }))
    .filter((q) => q.q && q.opts.length >= 2 && q.ans >= 0 && q.ans < q.opts.length)
    .slice(0, 30);
  if (!cards.length && !quiz.length) throw new Error("pusta odpowiedź");
  return { cards, quiz };
};

// Dostawcy AI: najpierw darmowy Google Gemini (klucz z AI Studio), a jeśli go nie ma  1�7 Claude (płatny).
async function callGemini(user) {
  const models = [process.env.GEMINI_MODEL, "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-flash-latest"].filter(Boolean);
  let last = "gemini";
  for (const m of models) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": process.env.GEMINI_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYS }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { responseMimeType: "application/json", maxOutputTokens: 8192, temperature: 0.4 },
      }),
    });
    if (r.ok) {
      const j = await r.json();
      const out = ((j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [])
        .map((p) => p.text || "").join("");
      if (out) return out;
      last = "gemini pusta odpowiedź";
      continue;
    }
    last = "gemini " + r.status;
    if (![400, 403, 404, 429, 503].includes(r.status)) break; // inny błąd  1�7 nie ma sensu próbować kolejnych modeli
  }
  throw new Error(last);
}

async function callClaude(user) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.AI_MODEL || "claude-haiku-5-5",
      max_tokens: 6000,
      system: SYS,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!r.ok) throw new Error("api " + r.status);
  const j = await r.json();
  return (j.content || []).map((c) => c.text || "").join("");
}

export default async (req) => {
  if (req.method !== "POST") return new Response("", { status: 405 });
  if (!okPw(req)) return new Response("", { status: 401 });
  let id;
  try { id = (await req.json()).id; } catch { return new Response("", { status: 400 }); }
  if (!/^[\w-]{1,40}$/.test(String(id))) return new Response("", { status: 400 });

  const store = getStore({ name: "notatki", consistency: "strong" });
  try {
    const note = await store.get("n:" + id, { type: "json" });
    if (!note) throw new Error("nf");
    if (!process.env.GEMINI_API_KEY && !process.env.ANTHROPIC_API_KEY) throw new Error("nokey");
    const text = toText(note.h).slice(0, 14000);
    if (text.length < 60) throw new Error("short");
    await store.setJSON("g:" + id, { status: "pending", ts: Date.now() });

    const user = `Tytuł: ${note.ti || ""}\nPrzedmiot: ${note.s || ""}\n\nNotatka:\n${text}`;
    const out = process.env.GEMINI_API_KEY ? await callGemini(user) : await callClaude(user);
    const deck = parseDeck(out);
    await store.setJSON("g:" + id, { status: "done", ts: Date.now(), ...deck });
  } catch (e) {
    await store.setJSON("g:" + id, { status: "error", msg: String(e.message || e).slice(0, 80), ts: Date.now() });
  }
  return new Response("", { status: 202 });
};
