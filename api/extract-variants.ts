/* eslint-disable @typescript-eslint/no-explicit-any */

export const config = {
  api: { bodyParser: { sizeLimit: "1mb" } },
};

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).end();
  { const _o=String(req.headers.origin||req.headers.referer||""); let _h=""; try{_h=new URL(_o).host.toLowerCase();}catch{} if(!_h||_h!==String(req.headers.host||"").toLowerCase()){res.status(403).json({error:"forbidden"});return;} }

  const { url } = req.body as { url: string };
  if (!url) return res.status(400).json({ error: "Missing url" });

  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return res.status(500).json({ error: "ANTHROPIC_API_KEY not set" });

  try {
    // ── 1. Fetch product page HTML server-side (no CORS issues here) ──────────
    const origin = new URL(url).origin;
    const pageRes = await fetch(url, {
      signal: AbortSignal.timeout(8_000),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language":       "en-US,en;q=0.9",
        "Referer":               origin + "/",
        "Origin":                origin,
        "Cache-Control":         "no-cache",
        "Upgrade-Insecure-Requests": "1",
      },
    });

    if (!pageRes.ok) {
      console.error("extract-variants: page fetch failed", pageRes.status, url);
      return res.json({ variants: [] });
    }

    const html = (await pageRes.text()).slice(0, 100_000);

    // ── 2. Ask Claude Haiku to extract variant names + hex colors ─────────────
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key":         key,
        "anthropic-version": "2023-06-01",
        "content-type":      "application/json",
      },
      body: JSON.stringify({
        model:      "claude-haiku-4-5",
        max_tokens: 512,
        messages: [
          {
            role:    "user",
            content:
              `You are reading an e-commerce product page HTML.\n` +
              `Extract every available color or material variant for the main product on this page.\n` +
              `For each variant provide a short clean name and your best hex color estimate.\n` +
              `Return ONLY valid JSON with no markdown fences:\n` +
              `{"variants":[{"name":"Dark Walnut","hexColor":"#3B2314"},{"name":"Natural Oak","hexColor":"#C8A97D"}]}\n` +
              `Return {"variants":[]} if no color/material variants are found.\n\n` +
              `HTML:\n${html}`,
          },
        ],
      }),
    });

    if (!claudeRes.ok) {
      console.error("extract-variants: Claude error", claudeRes.status);
      return res.json({ variants: [] });
    }

    const data    = await claudeRes.json() as any;
    const text: string = data?.content?.[0]?.text ?? "{}";
    const cleaned = text.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
    const parsed  = JSON.parse(cleaned);

    return res.json({ variants: parsed.variants ?? [] });
  } catch (err) {
    console.error("extract-variants error:", err);
    return res.json({ variants: [] });  // graceful degradation — never 500 to client
  }
}
