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

Also analyze the camera perspective:
- Estimate camera height from the floor using reference objects
  (door handle ~100cm, table surface ~75cm, chair seat ~45cm, bed surface ~55cm)
- Estimate horizon line position as an integer percentage from the TOP of the image
  (0 = very top, 50 = mid-frame, 100 = very bottom)
- Describe camera tilt: "looking_down" if camera angles noticeably toward the floor,
  "level" if roughly horizontal, "looking_up" if angled upward
- Estimate camera_tilt_deg: the angle in degrees the camera looks DOWN from horizontal
  (0 = perfectly level, 30 = gently downward typical standing shot, 50 = noticeably from above,
  70 = steep downward angle, 90 = straight down). Use reference objects and visible floor area to estimate.

Also identify up to 3 pieces of furniture clearly visible in the room and estimate their
real-world HEIGHT and WIDTH (the widest horizontal side, in cm). These are size anchors used
to scale newly-placed furniture, so a large fully-visible object like a sofa is the most
valuable — list it first. Use standard dimensions as a guide:
- TV stand / media console (low cabinet under a TV or screen): height 40–60cm, width 100–180cm — IMPORTANT: if you can see a TV or monitor above a cabinet, classify it as a TV stand, NOT a dresser
- Dresser / sideboard (tall cabinet without a TV above it): height 75–100cm, width 80–160cm
- Bed to top of mattress: height 55–65cm; to top of headboard: 90–130cm; width 140–180cm
- Bookshelf / wardrobe: height 150–200cm, width 80–150cm
- Nightstand / bedside table: height 55–70cm, width 40–55cm
- Sofa: back height 80–95cm; width — 2-seat ~150–180cm, 3-seat ~200–240cm, corner/sectional 240–340cm
- Armchair: height 80–100cm, width 80–100cm
- Coffee table: height 40–50cm, width 100–130cm; dining table: height 72–80cm, width 120–180cm
Estimate width_cm only where it is meaningful (sofa, bed, table, sideboard, rug, TV stand);
use null for tall/narrow items where width is not a useful anchor.
Return as "visible_refs": [{"name": "grey 3-seat sofa on left wall", "height_cm": 85, "width_cm": 220}, ...]
Up to 3 items, prioritising the largest clearly-visible object. Empty array if nothing is clearly identifiable.

Return ONLY valid JSON (no markdown fences, no extra text):
{
  "ceiling_height_cm": <integer or null>,
  "floor_width_cm": <integer or null>,
  "reference_objects": ["door ~200cm", "..."],
  "confidence": "low" | "medium" | "high",
  "detected_furniture": ["sofa", "chair"],
  "camera_height_cm": <integer or null>,
  "horizon_pct": <0-100 integer or null>,
  "camera_angle": "looking_down" | "level" | "looking_up" | null,
  "camera_tilt_deg": <0-90 integer or null>,
  "visible_refs": [{"name": "...", "height_cm": <integer>, "width_cm": <integer or null>}]
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
        max_tokens: 800,
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

    // Log the detection so placement issues (e.g. furniture not erased) are debuggable
    console.log("claude-measure result:", JSON.stringify({
      detected_furniture: parsed?.detected_furniture,
      confidence:         parsed?.confidence,
      camera_tilt_deg:    parsed?.camera_tilt_deg,
    }));

    return res.json(parsed);
  } catch (err) {
    console.error("claude-measure error:", err);
    return res.json(null);  // graceful degradation — never blocks placement
  }
}
