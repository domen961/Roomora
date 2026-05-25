/* eslint-disable @typescript-eslint/no-explicit-any */

export const config = {
  api: { bodyParser: { sizeLimit: "10mb" } },
};

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).end();

  const { imageDataUrl } = req.body as { imageDataUrl: string };
  if (!imageDataUrl) return res.status(400).json({ error: "Missing imageDataUrl" });

  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return res.status(500).json({ error: "ANTHROPIC_API_KEY not set" });

  // Extract base64 data and mime type from the data URL
  const match = imageDataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return res.status(400).json({ error: "Invalid image data URL" });

  const [, mimeType, base64Data] = match;

  const prompt = `Analyze this room photo and estimate dimensions using reference objects:
- Doors: 200–210cm tall, 80–90cm wide
- Standard ceilings: 240–270cm; high ceilings: 280–320cm
- Window sills: ~85–100cm from floor

Also detect which of these standard furniture types are currently visible in the room
(list ONLY those that are actually present — empty array if none):
"table" (any type: dining, coffee, side, console), "sofa", "chair", "bed",
"wardrobe", "shelving", "desk", "TV stand"

Return ONLY valid JSON (no markdown fences, no extra text):
{
  "ceiling_height_cm": <integer or null>,
  "floor_width_cm": <integer or null>,
  "reference_objects": ["door ~200cm", "..."],
  "confidence": "low" | "medium" | "high",
  "detected_furniture": ["sofa", "chair"]
}
Confidence: high=door/window clearly visible, medium=multiple reference objects, low=minimal references.`;

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
        max_tokens: 384,
        messages: [
          {
            role:    "user",
            content: [
              {
                type:   "image",
                source: { type: "base64", media_type: mimeType, data: base64Data },
              },
              { type: "text", text: prompt },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Anthropic API error:", response.status, errText);
      return res.json(null);  // graceful degradation
    }

    const data = await response.json() as any;
    const text: string = data?.content?.[0]?.text ?? "";

    // Strip any accidental markdown fences
    const cleaned = text.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
    const parsed  = JSON.parse(cleaned);

    return res.json(parsed);
  } catch (err) {
    console.error("claude-measure error:", err);
    return res.json(null);  // graceful degradation — never blocks placement
  }
}
