// JC local preview — a tiny Supabase-shaped front door for a local
// PostgREST, so Findmi's unmodified supabase-js clients work against the
// throwaway preview database:
//   /rest/v1/*  → PostgREST (read-only as `anon`)
//   /auth/v1/*  → "no session" (the preview has no accounts)
//   anything else → 404
// Local development only; never deployed.

import http from "node:http";

const PORT = Number(process.env.PREVIEW_API_PORT ?? 54321);
const PGRST = `http://127.0.0.1:${process.env.PREVIEW_PGRST_PORT ?? 54330}`;

http
  .createServer(async (req, res) => {
    const url = req.url ?? "/";
    if (url.startsWith("/auth/v1/")) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ code: 401, msg: "No session in the local preview" }));
      return;
    }
    if (!url.startsWith("/rest/v1/")) {
      res.writeHead(404).end();
      return;
    }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const headers = { ...req.headers };
    delete headers.host;
    delete headers["content-length"];
    try {
      const upstream = await fetch(PGRST + url.slice("/rest/v1".length), {
        method: req.method,
        headers,
        body: chunks.length ? Buffer.concat(chunks) : undefined,
      });
      const body = Buffer.from(await upstream.arrayBuffer());
      const out = {};
      upstream.headers.forEach((v, k) => {
        if (k !== "content-encoding" && k !== "transfer-encoding" && k !== "content-length") out[k] = v;
      });
      res.writeHead(upstream.status, out);
      res.end(body);
    } catch (err) {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: String(err) }));
    }
  })
  .listen(PORT, () => console.log(`preview API on http://localhost:${PORT}`));
