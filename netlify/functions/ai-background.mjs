import { getStore } from "@netlify/blobs";
import { timingSafeEqual } from "node:crypto";

// Funkcja działa w tle (nazwa kończy się na -background), więc może pracować do 15 minut.
// Wynik zapisuje w bazie, a strona sprawdza go co kilka sekund.
// Rodzaje zadań: "deck" (fiszki i quiz), "fmt" (formatowanie notatki), "e8gen" (wymyślone zadania E8).

const okPw = (req) => {
  const p = process.env.ADMIN_PASSWORD || "";
  const g = req.headers.get("x-admin-password") || "";
  if (!p || !g) return false;
  const a = Buffer.from(p), b = Buffer.from(g);
  return a.length === b.length && timingSafeEqual(a, b);
};

const DECK_SYS = `Jesteś nauczycielem, który tworzy materiały do nauki z notatki ucznia.
Na podstawie podanej notatki przygotuj fiszki i pytania quizowe.

Zasady:
- Korzystaj wyłącznie z informacji zawartych w notatce. Nie dodawaj faktów z zewnątrz.
- Pytania muszą być jednoznaczne i zrozumiałe bez zaglądania do notatki. Nie pisz pytań w stylu "co jest napisane w notatce".
- Fiszki: 15-30 sztuk. Krótkie pytanie i zwięzła odpowiedź (najwyżej 2 zdania). Zróżnicuj je: pojęcia, daty i wydarzenia, osoby, przyczyny i skutki, porównania.
- Quiz: 10-20 pytań jednokrotnego wyboru, dokładnie 4 odpowiedzi, jedna poprawna. Błędne odpowiedzi mają być realistyczne i podobnej długości do poprawnej. Pole "ans" to indeks poprawnej odpowiedzi (0-3). Pole "ex" to krótkie wyjaśnienie oparte na notatce.
- Język: polski.

Odpowiedz WYŁĄCZNIE poprawnym JSON-em, bez komentarza i bez znaczników markdown, w formacie:
{"cards":[{"q":"...","a":"..."}],"quiz":[{"q":"...","opts":["...","...","...","..."],"ans":0,"ex":"..."}]}`;

const FMT_SYS = `Jesteś redaktorem notatek szkolnych. Dostajesz notatkę ucznia oraz ustawienia formatowania.
Twoim zadaniem jest wskazać fragmenty notatki, które mają zostać wyróżnione, żeby notatka była czytelna i łatwa do nauki.

Style (używaj tylko tych, które są dozwolone w ustawieniach):
- "wavy": faliste granatowe podkreślenie – najważniejsze pojęcia, definicje, nazwy własne, kluczowe daty,
- "medium": powiększenie do średniego rozmiaru – ważne frazy i kluczowe zdania,
- "large": powiększenie do dużego rozmiaru – tylko główne hasła (kilka w całej notatce),
- "bold": pogrubienie,
- "hl": zakreślenie – najważniejsze wnioski, które trzeba zapamiętać.

Zasady:
- Pole "text" musi być DOKŁADNYM, krótkim fragmentem skopiowanym znak w znak z notatki (od 2 do 70 znaków), z tej samej linii, bez zmian wielkości liter i interpunkcji.
- Nie powtarzaj tego samego fragmentu i nie nakładaj fragmentów na siebie.
- Nie oznaczaj całych zdań ani akapitów, tylko ich najważniejsze części.
- Liczba znaczników zależy od trybu: "lekki" 5-10, "standardowy" 10-25, "intensywny" 25-50.

Odpowiedz WYŁĄCZNIE poprawnym JSON-em, bez komentarza i bez znaczników markdown:
{"marks":[{"text":"...","style":"wavy"}]}`;

const GEN_SYS = `Jesteś autorem ćwiczeń przygotowujących do egzaminu ósmoklasisty w Polsce.
Wymyśl NOWE, oryginalne zadania w stylu egzaminu (nie kopiuj istniejących arkuszy CKE), dla podanego przedmiotu i tematu.

Typy zadań ("typ"):
- "wybor": zadanie zamknięte z 4 odpowiedziami, jedna poprawna,
- "prawda_falsz": 2-4 zdania, przy każdym ocena Prawda/Fałsz,
- "liczba": odpowiedź liczbowa (tylko matematyka, fizyka, chemia, geografia),
- "otwarte": zadanie otwarte z rozwiązaniem wzorcowym.

Wymagania:
- Każde zadanie MUSI mieć pole "wyjasnienie" – zwięzłe wyjaśnienie, dlaczego odpowiedź jest taka, a nie inna.
- W "wybor" dodaj tablicę "wyjasnienia_odpowiedzi": jedno krótkie wyjaśnienie na każdą odpowiedź, w tej samej kolejności (dlaczego jest dobra albo dlaczego jest zła i jaki błąd za nią stoi).
- W "prawda_falsz" każde zdanie ma własne pole "wyjasnienie".
- Poziom i styl jak na egzaminie ósmoklasisty, treść poprawna merytorycznie. Wzory matematyczne zapisuj w TeX między znakami dolara, np. $x^2$, $\\frac{1}{2}$, $\\sqrt{16}$, $90^\\circ$, $\\pi r^2$ (w JSON każdy ukośnik podwajaj). Zwykły tekst i jednostki (cm, zł) pisz poza dolarami.
- Pole "rodzaj" ustaw na "cwiczenie". Pole "zrodlo" ustaw na "Ćwiczenie".
- Język: polski.

Odpowiedz WYŁĄCZNIE poprawnym JSON-em, bez komentarza i bez znaczników markdown:
{"zadania":[
 {"typ":"wybor","rodzaj":"cwiczenie","tresc":"...","odpowiedzi":["...","...","...","..."],"poprawna":"dokładny tekst poprawnej odpowiedzi","wyjasnienia_odpowiedzi":["...","...","...","..."],"wyjasnienie":"...","zrodlo":"Ćwiczenie","punkty":1},
 {"typ":"prawda_falsz","rodzaj":"cwiczenie","tresc":"...","zdania":[{"tekst":"...","prawda":true,"wyjasnienie":"..."}],"wyjasnienie":"...","zrodlo":"Ćwiczenie"},
 {"typ":"liczba","rodzaj":"cwiczenie","tresc":"...","poprawna":"12","wyjasnienie":"...","zrodlo":"Ćwiczenie"},
 {"typ":"otwarte","rodzaj":"cwiczenie","tresc":"...","rozwiazanie":"...","wyjasnienie":"...","zrodlo":"Ćwiczenie"}
]}`;

const SORT_SYS = `Jesteś nauczycielem, który porządkuje zadania z arkuszy egzaminacyjnych (egzamin ósmoklasisty w Polsce).
Dostajesz treść arkusza (lub kilku) oraz istniejącą strukturę przedmiotu: działy i tematy. Przepisz zadania z arkusza do formatu JSON i każde przypisz do działu i tematu.

Zasady:
- Nie zmieniaj treści zadań. Jeśli zadanie opiera się na rysunku, którego nie ma w tekście, pomiń je.
- W polu "dzial" i "temat" użyj DOKŁADNIE nazw z istniejącej struktury, jeśli zadanie do nich pasuje. Jeśli nie pasuje, wymyśl nową, krótką nazwę działu zgodną z podstawą programową (np. "Liczby i działania", "Geometria", "Algebra", "Statystyka i prawdopodobieństwo") oraz nową nazwę tematu.
- Typy zadań ("typ"): "wybor" (4 odpowiedzi), "prawda_falsz" (zdania z oceną), "liczba" (odpowiedź liczbowa), "otwarte" (z rozwiązaniem wzorcowym).
- Każde zadanie MUSI mieć "wyjasnienie" napisane własnymi słowami. W "wybor" dodaj "wyjasnienia_odpowiedzi" (po jednym na każdą odpowiedź, w tej samej kolejności), a w "prawda_falsz" każde zdanie ma własne "wyjasnienie".
- Pole "poprawna" w "wybor" musi być identyczne z jedną z odpowiedzi.
- Pole "rodzaj" ustaw na "arkusz", a "zrodlo" na rok i numer zadania, jeśli da się je ustalić z tekstu.
- Wzory matematyczne zapisuj w TeX między znakami dolara, np. $x^2$, $\\frac{1}{2}$, $\\sqrt{16}$, $90^\\circ$ (w JSON każdy ukośnik podwajaj). Zwykły tekst i jednostki pisz poza dolarami. Język: polski.
- Zwróć najwyżej 15 zadań.

Odpowiedz WYŁĄCZNIE poprawnym JSON-em, bez komentarza i bez znaczników markdown:
{"zadania":[{"typ":"wybor","rodzaj":"arkusz","dzial":"...","temat":"...","tresc":"...","odpowiedzi":["...","...","...","..."],"poprawna":"...","wyjasnienia_odpowiedzi":["...","...","...","..."],"wyjasnienie":"...","zrodlo":"E8 2024, zad. 1","punkty":1}]}`;

const toText = (h) =>
  String(h || "")
    .replace(/<\/(p|div|li|h[1-6]|blockquote)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n").trim();

const str = (v, n) => String(v ?? "").trim().slice(0, n);

const firstJson = (out) => {
  const i = out.indexOf("{"), j = out.lastIndexOf("}");
  if (i < 0 || j < i) throw new Error("brak JSON");
  return JSON.parse(out.slice(i, j + 1));
};

export const parseDeck = (out) => {
  const d = firstJson(out);
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

const STYLES = ["wavy", "medium", "large", "bold", "hl"];
export const parseMarks = (out, allowed) => {
  const d = firstJson(out);
  const ok = new Set((allowed && allowed.length ? allowed : STYLES).filter((x) => STYLES.includes(x)));
  const seen = new Set();
  const marks = (Array.isArray(d.marks) ? d.marks : [])
    .map((m) => ({ text: str(m && m.text, 80), style: str(m && m.style, 10) }))
    .filter((m) => m.text.length >= 2 && ok.has(m.style) && !seen.has(m.text.toLowerCase()) && seen.add(m.text.toLowerCase()))
    .slice(0, 60);
  if (!marks.length) throw new Error("brak znaczników");
  return marks;
};

export const parseTasks = (out, max = 20) => {
  const d = firstJson(out);
  const z = Array.isArray(d.zadania) ? d.zadania : [];
  if (!z.length) throw new Error("brak zadań");
  return { zadania: z.slice(0, max) };
};

// Dostawcy AI: najpierw darmowy Google Gemini (klucz z AI Studio), a jeśli go nie ma – Claude (płatny).
async function callGemini(sys, user) {
  const models = [process.env.GEMINI_MODEL, "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-flash-latest"].filter(Boolean);
  let last = "gemini";
  for (const m of models) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": process.env.GEMINI_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: sys }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { responseMimeType: "application/json", maxOutputTokens: 16384, temperature: 0.5 },
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
    if (![400, 403, 404, 429, 503].includes(r.status)) break;
  }
  throw new Error(last);
}

async function callClaude(sys, user) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.AI_MODEL || "claude-haiku-5-5",
      max_tokens: 16000,
      system: sys,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!r.ok) throw new Error("api " + r.status);
  const j = await r.json();
  return (j.content || []).map((c) => c.text || "").join("");
}

const ask = (sys, user) => (process.env.GEMINI_API_KEY ? callGemini(sys, user) : callClaude(sys, user));

export default async (req) => {
  if (req.method !== "POST") return new Response("", { status: 405 });
  if (!okPw(req)) return new Response("", { status: 401 });
  let body;
  try { body = await req.json(); } catch { return new Response("", { status: 400 }); }
  const kind = ["fmt", "e8gen", "e8sort"].includes(body.kind) ? body.kind : "deck";
  const id = String(body.id || "");
  if (!/^[\w-]{1,40}$/.test(id)) return new Response("", { status: 400 });

  const store = getStore({ name: "notatki", consistency: "strong" });
  const key = kind === "deck" ? "g:" + id : "j:" + (kind === "fmt" ? "fmt-" : kind === "e8sort" ? "sort-" : "gen-") + id;
  try {
    if (!process.env.GEMINI_API_KEY && !process.env.ANTHROPIC_API_KEY) throw new Error("nokey");

    if (kind === "e8gen") {
      const count = Math.max(1, Math.min(10, +body.count || 5));
      const types = (Array.isArray(body.types) ? body.types : []).filter((t) => ["wybor", "prawda_falsz", "liczba", "otwarte"].includes(t));
      await store.setJSON(key, { status: "pending", ts: Date.now() });
      const user = `Przedmiot: ${str(body.subject, 80)}\nTemat: ${str(body.topic, 100)}\nLiczba zadań: ${count}\nTypy zadań: ${types.length ? types.join(", ") : "dowolne, urozmaicone"}`;
      const data = parseTasks(await ask(GEN_SYS, user));
      await store.setJSON(key, { status: "done", ts: Date.now(), data });
      return new Response("", { status: 202 });
    }

    if (kind === "e8sort") {
      const text = String(body.text || "").trim().slice(0, 24000);
      if (text.length < 40) throw new Error("short");
      await store.setJSON(key, { status: "pending", ts: Date.now() });
      const struct = (Array.isArray(body.structure) ? body.structure : []).slice(0, 50)
        .map((d) => `Dział „${str(d && d.dzial, 80)}”: ${(Array.isArray(d && d.tematy) ? d.tematy : []).slice(0, 100).map((t) => "„" + str(t, 100) + "”").join(", ") || "(brak tematów)"}`).join("\n");
      const fixed = str(body.section, 80);
      const user = `Przedmiot: ${str(body.subject, 80)}\n${fixed ? `Wszystkie zadania przypisz do działu „${fixed}” (wybierz lub wymyśl temat).\n` : ""}Istniejąca struktura:\n${struct || "(jeszcze pusta – wymyśl działy i tematy)"}\n\nTREŚĆ ARKUSZA:\n${text}`;
      const data = parseTasks(await ask(SORT_SYS, user), 40);
      await store.setJSON(key, { status: "done", ts: Date.now(), data });
      return new Response("", { status: 202 });
    }

    const note = await store.get("n:" + id, { type: "json" });
    if (!note) throw new Error("nf");
    const text = toText(note.h).slice(0, 14000);
    if (text.length < 60) throw new Error("short");
    await store.setJSON(key, { status: "pending", ts: Date.now() });

    if (kind === "fmt") {
      const mode = ["lekki", "standardowy", "intensywny"].includes(body.mode) ? body.mode : "standardowy";
      const eff = (Array.isArray(body.effects) ? body.effects : []).filter((x) => STYLES.includes(x));
      const user = `Tryb: ${mode}\nDozwolone style: ${eff.length ? eff.join(", ") : STYLES.join(", ")}\n\nTytuł: ${note.ti || ""}\n\nNotatka:\n${text}`;
      const marks = parseMarks(await ask(FMT_SYS, user), eff);
      await store.setJSON(key, { status: "done", ts: Date.now(), marks });
    } else {
      const user = `Tytuł: ${note.ti || ""}\nPrzedmiot: ${note.s || ""}\n\nNotatka:\n${text}`;
      const deck = parseDeck(await ask(DECK_SYS, user));
      await store.setJSON(key, { status: "done", ts: Date.now(), ...deck });
    }
  } catch (e) {
    await store.setJSON(key, { status: "error", msg: String(e.message || e).slice(0, 80), ts: Date.now() });
  }
  return new Response("", { status: 202 });
};
