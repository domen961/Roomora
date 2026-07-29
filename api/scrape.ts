// Vercel serverless function — runs server-side to bypass browser CORS
// GET /api/scrape?url=...           → returns { html: string }
// GET /api/scrape?url=...&type=image → returns { data: base64, mimeType: string }

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
];

function buildHeaders(url: string, type: string | undefined, uaIndex: number): Record<string, string> {
  const origin = new URL(url).origin;
  return {
    "User-Agent": USER_AGENTS[uaIndex] ?? USER_AGENTS[0],
    "Accept":
      type === "image"
        ? "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
        : "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language":           "pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7",
    "Accept-Encoding":           "gzip, deflate, br",
    "Referer":                   origin + "/",
    "Origin":                    origin,
    "Cache-Control":             "no-cache",
    "Pragma":                    "no-cache",
    "Sec-Fetch-Dest":            type === "image" ? "image" : "document",
    "Sec-Fetch-Mode":            "navigate",
    "Sec-Fetch-Site":            "same-origin",
    "Upgrade-Insecure-Requests": "1",
  };
}

// Statuses that may be transient bot-mitigation responses worth one retry
const BLOCKING_STATUSES = new Set([403, 429, 503]);

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Methods", "GET");
  { const _o=String(req.headers.origin||req.headers.referer||""); let _h=""; try{_h=new URL(_o).host.toLowerCase();}catch{} if(!_h||_h!==String(req.headers.host||"").toLowerCase()){res.status(403).json({error:"forbidden"});return;} }

  const url  = req.query?.url  as string | undefined;
  const type = req.query?.type as string | undefined;

  if (!url) {
    res.status(400).json({ error: "Missing url parameter" });
    return;
  }

  let host = url;
  try { host = new URL(url).hostname.replace(/^www\./, ""); } catch { /* keep raw url */ }

  let lastStatus = 0;
  let lastWasBlocked = false;

  // Up to 2 attempts: retry once on a transient block / network error, rotating the UA.
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 8_000); // stay inside Vercel's 10 s limit

    try {
      const response = await fetch(url, {
        signal:  controller.signal,
        headers: buildHeaders(url, type, attempt),
      });
      clearTimeout(timeout);

      if (response.ok) {
        if (type === "image") {
          const buffer   = await response.arrayBuffer();
          const base64   = Buffer.from(buffer).toString("base64");
          const mimeType = response.headers.get("content-type") ?? "image/jpeg";
          res.status(200).json({ data: base64, mimeType: mimeType.split(";")[0] });
        } else {
          const html = await response.text();
          res.status(200).json({ html: html.slice(0, 120_000) });
        }
        return;
      }

      lastStatus     = response.status;
      lastWasBlocked = BLOCKING_STATUSES.has(response.status) ||
                       !!response.headers.get("cf-mitigated") ||
                       (response.headers.get("server") ?? "").toLowerCase().includes("cloudflare");

      // Retry once on a transient block; otherwise fail now
      if (attempt === 0 && lastWasBlocked) {
        await new Promise((r) => setTimeout(r, 700));
        continue;
      }
      break;
    } catch (err: any) {
      clearTimeout(timeout);
      const isTimeout = err?.name === "AbortError";
      // Retry once on a network blip; on second failure, report it
      if (attempt === 0 && !isTimeout) {
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
      res.status(500).json({
        error: isTimeout
          ? `${host} took too long to respond — it may be slow or blocking automated requests. Enter the product details manually.`
          : `Couldn't reach ${host}. Check the URL, or enter the product details manually.`,
      });
      return;
    }
  }

  // Exhausted attempts with a blocking response
  if (lastWasBlocked) {
    res.status(502).json({
      error:
        `${host} is protected by anti-bot security (Cloudflare) and blocked the import. ` +
        `This is common for large retailers. Please enter the product details manually — ` +
        `you can still paste image URLs and dimensions by hand.`,
      blocked: true,
    });
  } else {
    res.status(502).json({
      error: `${host} returned an error (${lastStatus}). Enter the product details manually.`,
    });
  }
}
