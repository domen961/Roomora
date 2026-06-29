/* eslint-disable @typescript-eslint/no-explicit-any */

// Verifies a furniture-replacement result. Pixel-diff can detect "nothing added" and
// "identical to original", but it is blind to FUSION — the old furniture left in place
// alongside the newly-added one. Claude can actually see it. Given the original room and
// the edited result, it reports whether the ORIGINAL target furniture is still present.

export const config = {
  api: { bodyParser: { sizeLimit: "12mb" } },
};

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).end();

  const { originalDataUrl, resultDataUrl, targetLabel } = req.body as {
    originalDataUrl: string;
    resultDataUrl:   string;
    targetLabel:     string;
  };
  if (!originalDataUrl || !resultDataUrl) {
    return res.status(400).json({ error: "Missing originalDataUrl or resultDataUrl" });
  }

  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return res.status(500).json({ error: "ANTHROPIC_API_KEY not set" });

  const origMatch = originalDataUrl.match(/^data:([^;]+);base64,(.+)$/);
  const resMatch  = resultDataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!origMatch || !resMatch) return res.status(400).json({ error: "Invalid image data URL" });

  const label = (targetLabel || "sofa").trim();

  const prompt =
    `You are checking the quality of a furniture-replacement edit.\n` +
    `IMAGE 1 is the ORIGINAL room — it contains an existing ${label}.\n` +
    `IMAGE 2 is the EDITED result — the existing ${label} was supposed to be fully replaced ` +
    `by a NEW ${label} of a different colour/design.\n\n` +
    `Look carefully at IMAGE 2 and answer:\n` +
    `- old_present: is the ORIGINAL ${label} from IMAGE 1 (same colour and design) still visible ` +
    `in IMAGE 2, in whole or in large part? A correct edit removes it completely.\n` +
    `- new_present: is a NEW, clearly different ${label} present in IMAGE 2?\n\n` +
    `Notes:\n` +
    `- "FUSION" (a failure) is when BOTH the original ${label} and a new ${label} appear together.\n` +
    `- Small separate footstools, ottomans, poufs or cubes that are NOT the main ${label} do NOT ` +
    `count as the original ${label} still being present.\n\n` +
    `Return ONLY valid JSON (no markdown, no extra text):\n` +
    `{"old_present": true|false, "new_present": true|false}`;

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
        max_tokens: 100,
        messages: [
          {
            role:    "user",
            content: [
              { type: "text", text: "IMAGE 1 (original room):" },
              { type: "image", source: { type: "base64", media_type: origMatch[1], data: origMatch[2] } },
              { type: "text", text: "IMAGE 2 (edited result):" },
              { type: "image", source: { type: "base64", media_type: resMatch[1], data: resMatch[2] } },
              { type: "text", text: prompt },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("claude-verify API error:", response.status, errText);
      return res.json(null);  // graceful degradation — caller treats null as "clean"
    }

    const data = await response.json() as any;
    const text: string = data?.content?.[0]?.text ?? "";
    const cleaned = text.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
    const parsed  = JSON.parse(cleaned);

    console.log("claude-verify result:", JSON.stringify(parsed));
    return res.json(parsed);
  } catch (err) {
    console.error("claude-verify error:", err);
    return res.json(null);  // never blocks placement
  }
}
