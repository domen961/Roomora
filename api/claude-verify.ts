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
    `A correct result contains EXACTLY ONE ${label}: the new one. Any second ${label} is a failure.\n` +
    `- old_present: Apart from the single NEW ${label} (the clearly-different-colour replacement), is ` +
    `there ANY OTHER ${label} visible in IMAGE 2? This covers BOTH (a) the original ${label} left in ` +
    `place or a large leftover section of it, AND (b) an EXTRA ${label} that does not belong — e.g. an ` +
    `additional old-/original-coloured ${label} that appears beside the new one but was never part of ` +
    `it. Judge by the ${label}'s BODY and FRAME, not the cushions. If a second ${label} of any kind is ` +
    `present, old_present is TRUE. (Common failures: the original left essentially in place with only ` +
    `cushions swapped; or a second ${label} appearing next to the new one.)\n` +
    `- new_present: Is the NEW, full ${label} of a clearly different colour genuinely present — with ` +
    `its OWN body and frame, not merely new cushions placed on an old one?\n\n` +
    `Decision:\n` +
    `- SUCCESS = exactly one ${label} (the new one): old_present:false, new_present:true.\n` +
    `- FAILURE = old_present:true — the original is still there OR a second/extra ${label} is present, ` +
    `regardless of new_present.\n` +
    `- Disregard ONLY a single small standalone footstool or pouf cube (roughly one-seat-sized or ` +
    `smaller). Any larger seat — a corner section, chaise, wing, or anything big enough to function as ` +
    `a sofa or armchair — counts as a second ${label}, so old_present is TRUE.\n\n` +
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
