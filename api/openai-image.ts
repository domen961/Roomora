/* eslint-disable @typescript-eslint/no-explicit-any */
import FormData from "form-data";
import https from "https";

export const config = {
  api: { bodyParser: { sizeLimit: "20mb" } },
};

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).end();

  const { images, prompt } = req.body as { images: string[]; prompt: string };
  if (!images?.length || !prompt)
    return res.status(400).json({ error: "Missing images or prompt" });

  const key = process.env.VITE_OPENAI_API_KEY?.trim();
  if (!key) return res.status(500).json({ error: "VITE_OPENAI_API_KEY not set" });

  const form = new FormData();
  form.append("model",           "gpt-image-1");
  form.append("prompt",          prompt);
  form.append("response_format", "b64_json");
  form.append("size",            "1024x1024");

  for (let i = 0; i < images.length; i++) {
    const [header, b64] = images[i].split(",");
    const mimeType = header.match(/:(.*?);/)?.[1] ?? "image/jpeg";
    const buf      = Buffer.from(b64, "base64");
    form.append("image[]", buf, {
      filename:    `img_${i}.jpg`,
      contentType: mimeType,
    });
  }

  // Use Node https to send multipart form (avoids any fetch/FormData compat issues)
  const formHeaders = form.getHeaders();
  const body        = form.getBuffer();

  const apiRes = await new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req2 = https.request(
      {
        hostname: "api.openai.com",
        path:     "/v1/images/edits",
        method:   "POST",
        headers:  {
          Authorization:  `Bearer ${key}`,
          "Content-Type": formHeaders["content-type"],
          "Content-Length": body.length,
        },
      },
      (r) => {
        let data = "";
        r.on("data", (chunk) => (data += chunk));
        r.on("end", () => resolve({ status: r.statusCode ?? 500, body: data }));
      },
    );
    req2.on("error", reject);
    req2.write(body);
    req2.end();
  });

  if (apiRes.status !== 200) {
    return res.status(apiRes.status).json({ error: apiRes.body });
  }

  const result = JSON.parse(apiRes.body);
  res.json(result);
}
