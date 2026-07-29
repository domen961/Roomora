/* eslint-disable @typescript-eslint/no-explicit-any */

// Internal harness persistence: uploads a result image to the product-images bucket under
// harness/ using the service-role key (the harness page is unauthenticated), and returns its
// public URL so runs survive a refresh and can be fetched/shared later.
// Optional gate: if HARNESS_TOKEN is set, callers must send a matching x-harness-token header.

export const config = {
  api: { bodyParser: { sizeLimit: "16mb" } },
};

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).end();
  { const _o=String(req.headers.origin||req.headers.referer||""); let _h=""; try{_h=new URL(_o).host.toLowerCase();}catch{} if(!_h||_h!==String(req.headers.host||"").toLowerCase()){res.status(403).json({error:"forbidden"});return;} }

  const gate = process.env.HARNESS_TOKEN?.trim();
  if (gate && req.headers["x-harness-token"] !== gate) return res.status(403).json({ error: "forbidden" });

  const { path, dataUrl } = req.body as { path: string; dataUrl: string };
  if (!path || !dataUrl) return res.status(400).json({ error: "Missing path or dataUrl" });

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return res.status(500).json({ error: "Supabase env not set" });

  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return res.status(400).json({ error: "Invalid dataUrl" });
  const [, mimeType, base64Data] = m;
  const bytes = Buffer.from(base64Data, "base64");

  // Keep paths inside a fixed prefix; strip anything unsafe.
  const safe = `harness/${path.replace(/[^a-zA-Z0-9._/-]/g, "_")}`;

  try {
    const up = await fetch(`${supabaseUrl}/storage/v1/object/product-images/${safe}`, {
      method: "POST",
      headers: {
        "apikey":        serviceKey,
        "Authorization": `Bearer ${serviceKey}`,
        "Content-Type":  mimeType,
        "x-upsert":      "true",
      },
      body: bytes,
    });
    if (!up.ok) {
      console.error("harness-save upload error:", up.status, await up.text());
      return res.status(500).json({ error: "upload failed" });
    }
    const url = `${supabaseUrl}/storage/v1/object/public/product-images/${safe}`;
    return res.json({ url });
  } catch (err) {
    console.error("harness-save error:", err);
    return res.status(500).json({ error: "upload failed" });
  }
}
