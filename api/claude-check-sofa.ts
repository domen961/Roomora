/* eslint-disable @typescript-eslint/no-explicit-any */
import { rejectCrossOrigin } from "./_guard";

// Sensitive, targeted "is the old sofa fully gone?" check used by the erase verify-retry
// loop. The general claude-measure inventory misses small foreground/edge fragments; this
// asks one focused yes/no so a stray upholstered piece still triggers another erase pass.

export const config = {
  api: { bodyParser: { sizeLimit: "10mb" } },
};

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).end();
  if (rejectCrossOrigin(req, res)) return;

  const { imageDataUrl } = req.body as { imageDataUrl: string };
  if (!imageDataUrl) return res.status(400).json({ error: "Missing imageDataUrl" });

  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return res.status(500).json({ error: "ANTHROPIC_API_KEY not set" });

  const match = imageDataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return res.status(400).json({ error: "Invalid image data URL" });
  const [, mimeType, base64Data] = match;

  const prompt = `Look at this room photo carefully. I need to know if there is ANY sofa, couch, sectional, chaise, or piece of upholstered seating still visible ANYWHERE in the image — including:
- a fragment or corner section in the foreground close to the camera,
- a piece cut off by the edge of the frame,
- a partly-removed or "ghosted" remnant of a sofa.

Ignore armchairs that are clearly small single chairs, ottomans/footstools, cushions lying on the floor, and non-seating furniture (tables, beds, cabinets). Focus only on sofa/couch/sectional/chaise material.

Return ONLY valid JSON (no markdown fences, no extra text):
{"sofa_present": true|false, "where": "<short description of where, or empty string>"}`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key":         key,
        "anthropic-version": "2023-06-01",
        "content-type":      "application/json",
      },
      body: JSON.stringify({
        model:      "claude-haiku-4-5",
        max_tokens: 200,
        messages: [
          {
            role:    "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mimeType, data: base64Data } },
              { type: "text",  text: prompt },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      console.error("claude-check-sofa API error:", response.status, await response.text());
      return res.json(null);  // graceful degradation — caller treats null as "assume present"
    }

    const data = await response.json() as any;
    const text: string = data?.content?.[0]?.text ?? "";
    const cleaned = text.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
    const parsed  = JSON.parse(cleaned);
    console.log("claude-check-sofa result:", JSON.stringify(parsed));
    return res.json(parsed);
  } catch (err) {
    console.error("claude-check-sofa error:", err);
    return res.json(null);  // graceful degradation
  }
}
