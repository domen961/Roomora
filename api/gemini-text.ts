/* eslint-disable @typescript-eslint/no-explicit-any */

export const config = {
  api: { bodyParser: { sizeLimit: "2mb" } },
};

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).end();

  const { prompt } = req.body as { prompt: string };
  if (!prompt) return res.status(400).json({ error: "Missing prompt" });

  // VITE_ env vars are available in Vercel serverless functions via process.env
  const key = (process.env.VITE_GEMINI_API_KEY ?? "").trim();
  if (!key) return res.status(500).json({ error: "VITE_GEMINI_API_KEY not set" });

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;

  try {
    const response = await fetch(endpoint, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents:         [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Gemini text API error:", response.status, errText);
      return res.status(response.status).json({ error: errText });
    }

    const data = await response.json() as any;
    const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
    return res.json({ text });
  } catch (err) {
    console.error("gemini-text error:", err);
    return res.status(500).json({ error: String(err) });
  }
}
