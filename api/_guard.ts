/* eslint-disable @typescript-eslint/no-explicit-any */

// Shared request guard for the paid/external API endpoints. Rejects requests whose Origin/
// Referer doesn't belong to this deployment (or an allow-listed host). This stops the
// opportunistic "someone found the URL and is looping it" abuse — the try/embed flow always
// calls from our own iframe origin, so legit traffic passes.
//
// NOTE: the Origin header is only enforced by browsers, so a determined attacker using a raw
// HTTP client can spoof it. This is ONE layer — the real backstops are the provider spend caps
// and per-IP rate limiting. It filters naive/opportunistic abuse cheaply, nothing more.

export function sameOriginOk(req: any): boolean {
  const host = String(req.headers["host"] || "").toLowerCase();
  const src  = String(req.headers["origin"] || req.headers["referer"] || "");
  if (!src) return false; // no Origin and no Referer → naive script → reject

  let originHost = "";
  try { originHost = new URL(src).host.toLowerCase(); } catch { return false; }

  // Self-referential: the app and its /api live on the same host, so legit same-origin calls
  // (prod, every preview deployment, and any custom domain) always have originHost === host.
  if (host && originHost === host) return true;

  // Extra allow-list for edge cases / custom domains, via env (comma-separated hosts).
  const allow = (process.env.ALLOWED_ORIGINS || "")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return allow.includes(originHost);
}

/** Applies the guard; returns true if the request was rejected (handler should stop). */
export function rejectCrossOrigin(req: any, res: any): boolean {
  if (sameOriginOk(req)) return false;
  res.status(403).json({ error: "forbidden" });
  return true;
}
