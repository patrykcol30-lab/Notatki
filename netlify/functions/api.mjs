import { getStore } from "@netlify/blobs";
import { timingSafeEqual } from "node:crypto";

const J = (o, s = 200) =>
  new Response(JSON.stringify(o), {
    status: s,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

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

export default async (req) => {
  const store = getStore("notatki");
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
          ft: str(b.ft, 8), an: b.an ? 1 : 0, r: Math.max(0, Math.min(40, +b.r || 24)),
        });
        return J({ ok: 1 });
      }
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
