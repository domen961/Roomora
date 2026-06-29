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
    `You are checking whether a furniture-replacement edit SUCCEEDED.\n\n` +
    `IMAGE 1 is the ORIGINAL room. It contains an existing ${label}. First, note the dominant ` +
    `COLOUR and overall form of that original ${label} (for example "large green corner sofa").\n\n` +
    `IMAGE 2 is the EDITED result. A successful edit COMPLETELY removes the original ${label} and ` +
    `puts a NEW ${label} of a clearly different colour in its place.\n\n` +
    `Answer two questions about IMAGE 2:\n` +
    `- old_present: Is a ${label} matching the ORIGINAL's colour and form (from IMAGE 1) still ` +
    `visible in IMAGE 2, in whole or in large part? Judge by the ${label}'s BODY and FRAME, NOT the ` +
    `cushions. The MOST COMMON failure leaves the original ${label} essentially in place and only ` +
    `swaps or adds a few cushions of the new colour — if the original-coloured ${label} body/frame ` +
    `is still there, old_present is TRUE even if new-coloured cushions are sitting on it.\n` +
    `- new_present: Is a NEW, full ${label} of a clearly different colour genuinely present — with ` +
    `its OWN body and frame, not merely new cushions placed on the old one?\n\n` +
    `Decision:\n` +
    `- SUCCESS = old_present:false, new_present:true.\n` +
    `- FUSION FAILURE = old_present:true (the original ${label}, or most of it, is still there), ` +
    `regardless of new_present.\n` +
    `- Ignore small SEPARATE footstools, ottomans, poufs or cubes — those are not the main ${label}.\n\n` +
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
        // Sonnet (not Haiku) for the verification — judging "is the old sofa still present
        // alongside the new one" is a nuanced visual call Haiku repeatedly got wrong. This is
        // the safety net, so judgment quality matters more than the small extra latency/cost.
        model:      "claude-sonnet-4-6",
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
