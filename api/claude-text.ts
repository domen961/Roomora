/* eslint-disable @typescript-eslint/no-explicit-any */

// Text extraction endpoint (product import): runs a prompt through Claude Haiku and returns
// the raw text (expected to be JSON). Replaces the old Gemini-text endpoint — no Google dependency.

export const config = {
  api: { bodyParser: { sizeLimit: "2mb" } },
};

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).end();
  { const _o=String(req.headers.origin||req.headers.referer||""); let _h=""; try{_h=new URL(_o).host.toLowerCase();}catch{} if(!_h||_h!==String(req.headers.host||"").toLowerCase()){res.status(403).json({error:"forbidden"});return;} }

  const { prompt } = req.body as { prompt: string };
  if (!prompt) return res.status(400).json({ error: "Missing prompt" });

  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return res.status(500).json({ error: "ANTHROPIC_API_KEY not set" });

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
        max_tokens: 1024,
        // System guard + assistant prefill "{" force a raw JSON object and prevent prose
        // refusals like "I cannot extract…" (which broke JSON.parse on the client).
        system:     "You output ONLY a raw JSON object. Never refuse, apologise, or add any prose or markdown. If the requested data is missing or the page is unusable, output {}.",
        messages:   [
          { role: "user", content: prompt },
          { role: "assistant", content: "{" },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("claude-text API error:", response.status, errText);
      return res.status(response.status).json({ error: errText });
    }

    const data = await response.json() as any;
    let text: string = data?.content?.[0]?.text ?? "";
    // Re-attach the prefilled "{" and strip any stray fences.
    text = ("{" + text).replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
    return res.json({ text });
  } catch (err) {
    console.error("claude-text error:", err);
    return res.status(500).json({ error: String(err) });
  }
}
