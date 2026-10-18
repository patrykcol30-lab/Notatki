import { getStore } from "@netlify/blobs";
import { timingSafeEqual } from "node:crypto";

const J = (o, s = 200) =>
  new Response(JSON.stringify(o), {
    status: s,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

// Hasło admina jest w zmiennej środowiskowej ADMIN_PASSWORD (Netlify → Environment variables)
const okPw = (req) => {
  const p = process.env.ADMIN_PASSWORD || "";
  const g = req.headers.get("x-admin-password") || "";
  if (!p || !g) return false;
  const a = Buffer.from(p), b = Buffer.from(g);
  return a.length === b.length && timingSafeEqual(a, b);
};

const TYPES = ["test", "quiz", "oral", "event", "note"];
const str = (v, n) => String(v ?? "").slice(0, n);
const ID = /^[\w-]{1,40}$/;

// ---- E8: przedmioty -> tematy -> zadania ----
const T8 = ["choice", "tf", "num", "open"];
const rid = () => Math.random().toString(36).slice(2, 10);
const task8 = (t) => {
  t = t || {};
  const pairs = (Array.isArray(t.opts) ? t.opts : []).map((x, i) => ({ o: str(x, 400), w: str(Array.isArray(t.exo) ? t.exo[i] : "", 800) }));
  const correct = Number.isInteger(t.ans) && pairs[t.ans] ? pairs[t.ans].o : "";
  const kept = pairs.filter((p) => p.o).slice(0, 6);
  const opts = kept.map((p) => p.o);
  return {
    id: ID.test(String(t.id)) ? t.id : rid(),
    type: T8.includes(t.type) ? t.type : "choice",
    kind: t.kind === "cw" ? "cw" : "cke",
    q: str(t.q, 3000),
    img: typeof t.img === "string" && /^data:image\/(jpeg|png|webp);base64,/.test(t.img) && t.img.length < 700000 ? t.img : "",
    opts,
    exo: kept.map((p) => p.w),
    ans: correct ? opts.indexOf(correct) : -1,
    st: (Array.isArray(t.st) ? t.st : []).map((x) => ({ t: str(x && x.t, 500), v: !!(x && x.v), w: str(x && x.w, 800) })).filter((x) => x.t).slice(0, 8),
    num: str(t.num, 120),
    sol: str(t.sol, 3000),
    ex: str(t.ex, 3000),
    src: str(t.src, 80),
    pts: Math.max(0, Math.min(20, +t.pts || 0)),
  };
};
// Drzewo E8: przedmiot -> dział -> temat. Starsze drzewa (przedmiot -> temat) są zamieniane na jeden dział "Ogólne".
const normTree = (t) => ({
  subjects: (t && Array.isArray(t.subjects) ? t.subjects : []).map((s) => ({
    id: s.id,
    name: s.name,
    sections: Array.isArray(s.sections)
      ? s.sections.map((d) => ({ id: d.id, name: d.name, topics: Array.isArray(d.topics) ? d.topics : [] }))
      : Array.isArray(s.topics) ? [{ id: ("s-" + s.id).slice(0, 40), name: "Ogólne", topics: s.topics }] : [],
  })),
});
const flatTopics = (t) => normTree(t).subjects.flatMap((s) => s.sections.flatMap((d) => d.topics));
const valid8 = (o) =>
  o.q && (o.type === "choice" ? o.opts.length >= 2 && o.ans >= 0 : o.type === "tf" ? o.st.length >= 1 : o.type === "num" ? !!o.num : !!(o.sol || o.ex));

export default async (req) => {
  const store = getStore({ name: "notatki", consistency: "strong" });
  const parts = new URL(req.url).pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const m = req.method;

  try {
    if (parts[0] === "login" && m === "POST") return okPw(req) ? J({ ok: 1 }) : J({ error: "pw" }, 401);

    if (parts[0] === "settings") {
      if (m === "GET") return J((await store.get("settings", { type: "json" })) || {});
      if (m === "PUT") {
        if (!okPw(req)) return J({ error: "pw" }, 401);
        const b = await req.json();
        await store.setJSON("settings", {
          nm: str(b.nm, 40), ac: str(b.ac, 9), bg: str(b.bg, 12), th: str(b.th, 6),
          ft: str(b.ft, 8), mt: str(b.mt, 80), an: b.an ? 1 : 0, r: Math.max(0, Math.min(40, +b.r || 24)),
        });
        return J({ ok: 1 });
      }
    }

    if (parts[0] === "job" && parts[1] && m === "GET") {
      if (!/^[\w-]{1,60}$/.test(parts[1])) return J({ error: "bad id" }, 400);
      return J((await store.get("j:" + parts[1], { type: "json" })) || { status: "none" });
    }

    if (parts[0] === "e8") {
      const sub = parts[1];
      if (!sub && m === "GET") return J(normTree(await store.get("e8:tree", { type: "json" })));
      if (sub === "tree" && m === "PUT") {
        if (!okPw(req)) return J({ error: "pw" }, 401);
        const b = normTree(await req.json());
        const old = flatTopics(await store.get("e8:tree", { type: "json" }));
        const cnt = {};
        old.forEach((t) => { cnt[t.id] = t.count || 0; });
        const used = new Set();
        const uid = (v) => { let i = ID.test(String(v)) ? v : rid(); while (used.has(i)) i = rid(); used.add(i); return i; };
        const subjects = b.subjects.slice(0, 30).map((s) => ({
          id: uid(s.id),
          name: str(s.name, 80),
          sections: s.sections.slice(0, 50).map((d) => ({
            id: uid(d.id),
            name: str(d.name, 80),
            topics: d.topics.slice(0, 100)
              .map((t) => ({ id: uid(t && t.id), name: str(t && t.name, 100) })).filter((t) => t.name)
              .map((t) => ({ ...t, count: cnt[t.id] || 0 })),
          })).filter((d) => d.name),
        })).filter((s) => s.name);
        const keep = new Set(subjects.flatMap((s) => s.sections.flatMap((d) => d.topics.map((t) => t.id))));
        for (const t of old) if (!keep.has(t.id)) await store.delete("e8:t:" + t.id);
        await store.setJSON("e8:tree", { subjects });
        return J({ ok: 1, subjects });
      }
      if (sub === "t" && parts[2] && ID.test(parts[2])) {
        const tid = parts[2];
        if (m === "GET") return J((await store.get("e8:t:" + tid, { type: "json" })) || { tasks: [] });
        if (m === "PUT") {
          if (!okPw(req)) return J({ error: "pw" }, 401);
          const tree = normTree(await store.get("e8:tree", { type: "json" }));
          let found = false;
          for (const s of tree.subjects) for (const d of s.sections) for (const t of d.topics) if (t.id === tid) found = true;
          if (!found) return J({ error: "nf" }, 404);
          const b = await req.json();
          const tasks = (Array.isArray(b.tasks) ? b.tasks : []).map(task8).filter(valid8).slice(0, 200);
          await store.setJSON("e8:t:" + tid, { tasks, ts: Date.now() });
          for (const s of tree.subjects) for (const d of s.sections) for (const t of d.topics) if (t.id === tid) t.count = tasks.length;
          await store.setJSON("e8:tree", tree);
          return J({ ok: 1, count: tasks.length });
        }
      }
    }

    if (parts[0] === "deck" && parts[1]) {
      if (!ID.test(parts[1])) return J({ error: "bad id" }, 400);
      if (m === "GET") return J((await store.get("d:" + parts[1], { type: "json" })) || { cards: [], quiz: [] });
      if (m === "PUT") {
        if (!okPw(req)) return J({ error: "pw" }, 401);
        const b = await req.json();
        const cards = (Array.isArray(b.cards) ? b.cards : [])
          .map((c) => ({ q: str(c && c.q, 400), a: str(c && c.a, 800) }))
          .filter((c) => c.q && c.a)
          .slice(0, 300);
        const quiz = (Array.isArray(b.quiz) ? b.quiz : [])
          .map((q) => {
            const raw = Array.isArray(q && q.opts) ? q.opts.map((o) => str(o, 300)) : [];
            const correct = Number.isInteger(q && q.ans) ? raw[q.ans] : "";
            const opts = raw.filter(Boolean).slice(0, 6);
            return { q: str(q && q.q, 500), opts, ans: correct ? opts.indexOf(correct) : -1, ex: str(q && q.ex, 500) };
          })
          .filter((q) => q.q && q.opts.length >= 2 && q.ans >= 0)
          .slice(0, 200);
        await store.setJSON("d:" + parts[1], { cards, quiz, ts: Date.now() });
        return J({ ok: 1, cards: cards.length, quiz: quiz.length });
      }
    }

    if (parts[0] === "ai" && parts[1] && m === "GET") {
      if (!ID.test(parts[1])) return J({ error: "bad id" }, 400);
      return J((await store.get("g:" + parts[1], { type: "json" })) || { status: "none" });
    }

    if (parts[0] === "notes") {
      const id = parts[1];
      if (!id && m === "GET") {
        const { blobs } = await store.list({ prefix: "m:" });
        const all = await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })));
        return J(all.filter(Boolean));
      }
      if (id && !ID.test(id)) return J({ error: "bad id" }, 400);
      if (id && m === "GET") {
        const n = await store.get("n:" + id, { type: "json" });
        return n ? J(n) : J({ error: "nf" }, 404);
      }
      if (id && (m === "PUT" || m === "DELETE")) {
        if (!okPw(req)) return J({ error: "pw" }, 401);
        if (m === "DELETE") {
          await store.delete("n:" + id);
          await store.delete("m:" + id);
          await store.delete("g:" + id);
          await store.delete("d:" + id);
          return J({ ok: 1 });
        }
        const b = await req.json();
        const h = str(b.h, 5_000_000);
        const note = {
          id, ty: TYPES.includes(b.ty) ? b.ty : "note", s: str(b.s, 80), l: b.l ? +b.l || "" : "",
          d: str(b.d, 10), ti: str(b.ti, 160), h, pin: b.pin ? 1 : 0,
        };
        const meta = {
          id, ty: note.ty, s: note.s, l: note.l, d: note.d, ti: note.ti, pin: note.pin,
          tx: h.replace(/<[^>]*>/g, " ").slice(0, 3000),
          im: (h.match(/<img/g) || []).length,
        };
        const old = await store.get("n:" + id, { type: "json" });
        if (old && old.h !== h) await store.delete("g:" + id); // treść się zmieniła – talia AI jest nieaktualna
        await store.setJSON("n:" + id, note);
        await store.setJSON("m:" + id, meta);
        return J({ ok: 1 });
      }
    }
    return J({ error: "nf" }, 404);
  } catch (e) {
    return J({ error: "server" }, 500);
  }
};

export const config = { path: "/api/*" };
