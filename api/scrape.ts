// Vercel serverless function — runs server-side to bypass browser CORS
// GET /api/scrape?url=...           → returns { html: string }
// GET /api/scrape?url=...&type=image → returns { data: base64, mimeType: string }

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");

  const url  = req.query?.url  as string | undefined;
  const type = req.query?.type as string | undefined;

  if (!url) {
    res.status(400).json({ error: "Missing url parameter" });
    return;
  }

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept":
          type === "image"
            ? "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
            : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7",
        "Referer": new URL(url).origin + "/",
      },
    });

    if (!response.ok) {
      res.status(400).json({ error: `Remote server returned ${response.status}` });
      return;
    }

    if (type === "image") {
      const buffer   = await response.arrayBuffer();
      const base64   = Buffer.from(buffer).toString("base64");
      const mimeType = response.headers.get("content-type") ?? "image/jpeg";
      res.status(200).json({ data: base64, mimeType: mimeType.split(";")[0] });
    } else {
      const html = await response.text();
      res.status(200).json({ html: html.slice(0, 120_000) });
    }
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}
