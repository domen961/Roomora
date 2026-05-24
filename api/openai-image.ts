/* eslint-disable @typescript-eslint/no-explicit-any */
export const config = {
  api: { bodyParser: { sizeLimit: "20mb" } },
};

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).end();

  const { images, prompt } = req.body as { images: string[]; prompt: string };
  if (!images?.length || !prompt) return res.status(400).json({ error: "Missing images or prompt" });

  const key = (process as any).env.VITE_OPENAI_API_KEY;
  if (!key) return res.status(500).json({ error: "VITE_OPENAI_API_KEY not set" });

  const form = new FormData();
  form.append("model",           "gpt-image-1");
  form.append("prompt",          prompt);
  form.append("response_format", "b64_json");
  form.append("size",            "1024x1024");

  for (let i = 0; i < images.length; i++) {
    const [header, data] = images[i].split(",");
    const mimeType = header.match(/:(.*?);/)?.[1] ?? "image/jpeg";
    const binary   = atob(data);
    const bytes    = new Uint8Array(binary.length);
    for (let j = 0; j < binary.length; j++) bytes[j] = binary.charCodeAt(j);
    form.append("image[]", new Blob([bytes], { type: mimeType }), `img_${i}.jpg`);
  }

  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method:  "POST",
    headers: { Authorization: `Bearer ${key}` },
    body:    form,
  });

  if (!response.ok) {
    const text = await response.text();
    return res.status(response.status).json({ error: text });
  }

  const result = await response.json();
  res.json(result);
}
