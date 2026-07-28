/* eslint-disable @typescript-eslint/no-explicit-any */

// Server proxy to OpenAI's image-edit endpoint (gpt-image-1). Takes the room photo + product
// reference images (as data URLs) plus a prompt, forwards them as multipart to OpenAI, and
// returns the edited image as a data URL. Keeps OPENAI_API_KEY server-side (never in the client).

export const config = {
  api: { bodyParser: { sizeLimit: "20mb" }, responseLimit: false },
  maxDuration: 60,   // gpt-image-1 edits can take 20-40s; default 10s would time out (60 = Hobby max)
};

function dataUrlToBlob(dataUrl: string): { blob: Blob; ext: string } | null {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return null;
  const mime = m[1];
  const buf = Buffer.from(m[2], "base64");
  const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
  return { blob: new Blob([buf], { type: mime }), ext };
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).end();

  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return res.status(500).json({ error: "OPENAI_API_KEY not set" });

  const { prompt, images, size } = req.body as { prompt: string; images: string[]; size?: string };
  if (!prompt || !Array.isArray(images) || images.length === 0)
    return res.status(400).json({ error: "Missing prompt or images" });

  try {
    const form = new FormData();
    form.append("model", "gpt-image-2");
    form.append("prompt", prompt);
    form.append("size", size || "auto");
    form.append("quality", "high");          // gpt-image-2 handles input fidelity natively (no input_fidelity param)
    images.forEach((dataUrl, i) => {
      const conv = dataUrlToBlob(dataUrl);
      if (conv) form.append("image[]", conv.blob, `image_${i}.${conv.ext}`);
    });

    const r = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form as any,
    });

    if (!r.ok) {
      const errText = await r.text();
      console.error("openai-image error:", r.status, errText.slice(0, 600));
      return res.status(502).json({ error: "openai image failed", status: r.status, detail: errText.slice(0, 400) });
    }
    const data = await r.json() as any;
    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) return res.status(502).json({ error: "no image returned" });
    return res.json({ image: `data:image/png;base64,${b64}` });
  } catch (err) {
    console.error("openai-image exception:", err);
    return res.status(500).json({ error: "openai image exception", detail: err instanceof Error ? err.message : String(err) });
  }
}
