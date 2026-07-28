/* eslint-disable @typescript-eslint/no-explicit-any */

// Text extraction endpoint (product import): runs a prompt through Claude Haiku and returns
// the raw text (expected to be JSON). Replaces the old Gemini-text endpoint — no Google dependency.

export const config = {
  api: { bodyParser: { sizeLimit: "2mb" } },
};

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).end();

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
        messages:   [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("claude-text API error:", response.status, errText);
      return res.status(response.status).json({ error: errText });
    }

    const data = await response.json() as any;
    let text: string = data?.content?.[0]?.text ?? "{}";
    // Strip any accidental markdown fences so JSON.parse on the client succeeds.
    text = text.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
    return res.json({ text });
  } catch (err) {
    console.error("claude-text error:", err);
    return res.status(500).json({ error: String(err) });
  }
}
