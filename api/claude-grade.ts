/* eslint-disable @typescript-eslint/no-explicit-any */
import { rejectCrossOrigin } from "./_guard";

// Internal harness grader: given the BEFORE room, the AFTER result, and a product reference,
// score the placement on erase completeness, scale accuracy and placement quality so the
// batch harness can grade itself instead of relying on manual eyeballing.

export const config = {
  api: { bodyParser: { sizeLimit: "16mb" } },
};

function imgPart(dataUrl: string) {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return null;
  return { type: "image", source: { type: "base64", media_type: m[1], data: m[2] } };
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).end();
  if (rejectCrossOrigin(req, res)) return;

  const { roomDataUrl, outputDataUrl, productRefDataUrl, productName, category, dims } =
    req.body as { roomDataUrl: string; outputDataUrl: string; productRefDataUrl?: string; productName: string; category?: string | null; dims?: string };

  if (!roomDataUrl || !outputDataUrl) return res.status(400).json({ error: "Missing images" });

  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return res.status(500).json({ error: "ANTHROPIC_API_KEY not set" });

  const before = imgPart(roomDataUrl);
  const after  = imgPart(outputDataUrl);
  const ref    = productRefDataUrl ? imgPart(productRefDataUrl) : null;
  if (!before || !after) return res.status(400).json({ error: "Invalid image data URLs" });

  const label = (category || "furniture").toLowerCase();
  const prompt = `You are grading an AI furniture-placement result for a "see it in your room" app.

- IMAGE 1 = the ORIGINAL room (BEFORE), which contains the customer's existing ${label}.
- IMAGE 2 = the GENERATED result (AFTER). The existing ${label} should be fully removed and replaced by the product "${productName}"${dims ? ` (real size ${dims})` : ""}.
${ref ? `- IMAGE 3 = a reference photo of that product, for its true shape and proportions.\n` : ""}
Grade three axes, each 1-5 (5 = perfect):
1. erase — is EVERY part of the original ${label} from IMAGE 1 gone in IMAGE 2, including corner/chaise sections and any fragment in the foreground or cut off by the frame edge? Is there NO second/duplicate ${label}? (5 = completely gone, single product only; 1 = old ${label} largely still there or two ${label}s visible.)
2. scale — is the placed product sized correctly for the room? Use visible unchanged objects (coffee table, door, window, backpack) as yardsticks and the product's real size. (5 = accurate; 1 = badly over- or under-sized.) In the note, say "too small", "too large" or "accurate".
3. placement — does it sit flat on the floor, against the correct wall, roughly centered where the old ${label} was, with correct orientation and perspective (not floating, skewed, or shoved to one side)?

Also give overall (1-5) and a verdict: "pass" (overall>=4, no axis<=2), "warn" (usable but flawed), or "fail" (old furniture remains, duplicated, or badly scaled).

Return ONLY valid JSON, no markdown fences:
{"erase":{"score":N,"note":"..."},"scale":{"score":N,"note":"..."},"placement":{"score":N,"note":"..."},"overall":N,"verdict":"pass|warn|fail","summary":"one short sentence"}`;

  const content: any[] = [before, { type: "text", text: prompt }, after];
  if (ref) content.push(ref);

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key":         key,
        "anthropic-version": "2023-06-01",
        "content-type":      "application/json",
      },
      body: JSON.stringify({
        model:      "claude-sonnet-4-6",
        max_tokens: 700,
        messages: [{ role: "user", content }],
      }),
    });

    if (!response.ok) {
      console.error("claude-grade API error:", response.status, await response.text());
      return res.json(null);
    }
    const data = await response.json() as any;
    const text: string = data?.content?.[0]?.text ?? "";
    const cleaned = text.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
    const parsed  = JSON.parse(cleaned);
    return res.json(parsed);
  } catch (err) {
    console.error("claude-grade error:", err);
    return res.json(null);
  }
}
