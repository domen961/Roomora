const GEMINI_MODEL       = "gemini-2.5-flash-image";
const GEMINI_TEXT_MODEL = "gemini-2.5-flash";

function getEndpoint() {
  const key = import.meta.env.VITE_GEMINI_API_KEY as string;
  if (!key) throw new Error("VITE_GEMINI_API_KEY is not set");
  return `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;
}

const stripPrefix = (b64: string) => b64.replace(/^data:[^;]+;base64,/, "");


function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/**
 * Ensures an image is a data URL. If it's an http(s) URL, fetches it via the
 * /api/scrape proxy (which handles CORS) and returns a base64 data URL.
 */
async function toDataUrl(src: string): Promise<string> {
  if (src.startsWith("data:")) return src;
  const res = await fetch(`/api/scrape?url=${encodeURIComponent(src)}&type=image`);
  if (!res.ok) throw new Error(`Failed to fetch image (${res.status}): ${src}`);
  const { data, mimeType } = await res.json();
  if (!data) throw new Error(`Empty image data from proxy: ${src}`);
  return `data:${mimeType};base64,${data}`;
}


async function cropToRatio(src: string, targetW: number, targetH: number): Promise<string> {
  try {
    const img = await loadImage(src);
    const srcRatio = img.width / img.height;
    const tgtRatio = targetW / targetH;
    let sx = 0, sy = 0, sw = img.width, sh = img.height;
    if (srcRatio > tgtRatio) {
      sw = Math.round(img.height * tgtRatio);
      sx = Math.round((img.width - sw) / 2);
    } else if (srcRatio < tgtRatio) {
      sh = Math.round(img.width / tgtRatio);
      sy = Math.round((img.height - sh) / 2);
    }
    const canvas = document.createElement("canvas");
    canvas.width = targetW; canvas.height = targetH;
    canvas.getContext("2d")!.drawImage(img, sx, sy, sw, sh, 0, 0, targetW, targetH);
    return canvas.toDataURL("image/jpeg", 0.92);
  } catch {
    return src;
  }
}

async function resizeImage(src: string, maxW: number, maxH: number, quality = 0.8): Promise<string> {
  try {
    const img = await loadImage(src);
    const scale = Math.min(maxW / img.width, maxH / img.height, 1);
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", quality);
  } catch {
    return src;
  }
}

async function callGemini(parts: unknown[]): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000); // 90 s hard limit

  const body = {
    contents: [{ role: "user", parts }],
    generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
  };

  try {
    const res = await fetch(getEndpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Gemini API ${res.status}: ${text}`);
    }

    const data = await res.json();
    const responseParts: unknown[] = data?.candidates?.[0]?.content?.parts ?? [];
    const imgPart = responseParts.find((p: any) => typeof p?.inlineData?.data === "string") as any;
    if (!imgPart) throw new Error("No image returned by Gemini");

    return `data:${imgPart.inlineData.mimeType};base64,${imgPart.inlineData.data}`;
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw new Error("Generation timed out after 90 s — please try again");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export interface ProductDimensions {
  length_cm?: number | null;
  width_cm?:  number | null;
  height_cm?: number | null;
}

export interface ExtractedProductData {
  name:        string;
  description: string;
  length_cm:   number | null;
  width_cm:    number | null;
  height_cm:   number | null;
  imageUrls:   string[];
}

/**
 * Scrapes a product page URL (via the /api/scrape proxy) and uses Gemini
 * to extract name, description, dimensions, and the best product image URLs.
 */
export async function extractProductData(
  pageUrl: string,
): Promise<ExtractedProductData> {
  const key = import.meta.env.VITE_GEMINI_API_KEY as string;
  if (!key) throw new Error("VITE_GEMINI_API_KEY is not set");

  // 1. Fetch page HTML through our CORS proxy
  const scrapeRes = await fetch(
    `/api/scrape?url=${encodeURIComponent(pageUrl)}`,
  );
  if (!scrapeRes.ok) {
    const err = await scrapeRes.json().catch(() => ({}));
    throw new Error(err.error ?? `Scrape failed: ${scrapeRes.status}`);
  }
  const { html } = await scrapeRes.json();
  const origin   = new URL(pageUrl).origin;

  // ── Helper: normalise a URL found in HTML ──────────────────────────────────
  const normalise = (u: string): string | null => {
    u = u.trim();
    if (u.startsWith("//"))   u = "https:" + u;
    if (u.startsWith("/"))    u = origin + u;
    if (!u.startsWith("http")) return null;
    // skip icons, logos, banners, tiny thumbnails
    if (/logo|icon|banner|sprite|placeholder|svg|gif/i.test(u)) return null;
    return u;
  };

  const addUrl = (list: string[], u: string) => {
    const n = normalise(u);
    if (n && !list.includes(n)) list.push(n);
  };

  // ── 1. JSON-LD structured data (richest source) ────────────────────────────
  const jsonLdBlocks: string[] = [];
  const jsonLdRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let jm: RegExpExecArray | null;
  while ((jm = jsonLdRe.exec(html)) !== null) jsonLdBlocks.push(jm[1]);

  // ── 2. og:image meta tags ──────────────────────────────────────────────────
  const ogImgUrls: string[] = [];
  const ogRe = /<meta[^>]+(?:property=["']og:image["'][^>]+content=["']([^"']+)|content=["']([^"']+)["'][^>]+property=["']og:image["'])/gi;
  while ((jm = ogRe.exec(html)) !== null) addUrl(ogImgUrls, jm[1] ?? jm[2]);

  // ── 3. High-res image attributes: data-large_image, data-src, srcset ───────
  const imgUrls: string[] = [...ogImgUrls];

  // data-large_image (WooCommerce full-size)
  const largeRe = /data-large_image=["']([^"']+)/gi;
  while ((jm = largeRe.exec(html)) !== null) addUrl(imgUrls, jm[1]);

  // srcset — grab the largest (last) URL in each srcset
  const srcsetRe = /srcset=["']([^"']+)/gi;
  while ((jm = srcsetRe.exec(html)) !== null) {
    const candidates = jm[1].split(",").map((s) => s.trim().split(/\s+/)[0]);
    if (candidates.length) addUrl(imgUrls, candidates[candidates.length - 1]);
  }

  // Regular src / data-src / data-lazy-src
  const srcRe = /(?:^|\s)(?:src|data-src|data-lazy-src|data-original)=["']([^"']+\.(?:jpe?g|png|webp)(?:\?[^"']*)?)/gi;
  while ((jm = srcRe.exec(html)) !== null) addUrl(imgUrls, jm[1]);

  // URLs inside JSON-LD blocks
  const jsonImgRe = /"(?:image|url)"\s*:\s*"(https?:[^"]+\.(?:jpe?g|png|webp)[^"]*)"/gi;
  for (const block of jsonLdBlocks) {
    while ((jm = jsonImgRe.exec(block)) !== null) addUrl(imgUrls, jm[1]);
  }

  // ── 4. Page text (scripts stripped, styles stripped) ──────────────────────
  const stripped = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const pageText = stripped.slice(0, 14_000);

  // ── 4b. Targeted spec/dimension extraction ─────────────────────────────────
  // Search the RAW HTML (including script tags) for dimension-like patterns.
  // Many WooCommerce sites render specs via JS — the data is still in the HTML
  // source as JSON variables or inline text, just not in visible DOM elements.
  const specChunks: string[] = [];
  let sm: RegExpExecArray | null;

  // Tables containing dimension keywords (static HTML)
  const specTableRe = /<table[^>]*>[\s\S]*?<\/table>/gi;
  while ((sm = specTableRe.exec(html)) !== null) {
    const text = sm[0].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (/\b(?:cm|mm|wys|szer|dł|głęb|wymiary?|rozmiary?|dimension|height|width|depth|length)\b/i.test(text))
      specChunks.push(text.slice(0, 600));
  }

  // Dimension keyword windows in full stripped text
  const dimKwRe = /(?:wys(?:okość)?|szer(?:okość)?|dług(?:ość)?|głęb(?:okość)?|wymiary?|rozmiary?|dimension|height|width|depth|length).{0,200}/gi;
  while ((sm = dimKwRe.exec(stripped)) !== null) specChunks.push(sm[0]);

  // Numeric dimension patterns anywhere in raw HTML (catches JS-embedded data):
  //   "76 cm", "160 x 90 cm", "160x90", "76cm", etc.
  const numDimRe = /\b\d{2,3}\s*(?:x|×|X)\s*\d{2,3}(?:\s*(?:x|×|X)\s*\d{2,3})?\s*cm\b|\b\d{2,3}\s*cm\b/gi;
  const rawMatches: string[] = [];
  while ((sm = numDimRe.exec(html)) !== null) {
    // grab surrounding context (100 chars before and after)
    const start   = Math.max(0, sm.index - 100);
    const end     = Math.min(html.length, sm.index + sm[0].length + 100);
    const context = html.slice(start, end).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    rawMatches.push(context);
  }
  // Deduplicate and add top matches
  [...new Set(rawMatches)].slice(0, 8).forEach((c) => specChunks.push(c));

  const specContext = specChunks.length
    ? `\nDimension / specification data found in page source:\n${[...new Set(specChunks)].slice(0, 12).join("\n---\n")}`
    : "";

  // ── 5. Ask Gemini to extract structured product data ──────────────────────
  const structuredContext = jsonLdBlocks.length
    ? `\nStructured JSON-LD data found on page:\n${jsonLdBlocks.join("\n").slice(0, 3_000)}`
    : "";

  const prompt = `You are extracting product data from an e-commerce page to populate a furniture AR app.

Return ONLY valid JSON (no markdown fences, no extra text):
{
  "name": "full product name",
  "description": "concise visual description for AI image generation, max 40 words. Include only concrete details: shape, material, finish, color, leg style. Skip anything vague or unknown — do not write 'unspecified'. Example: 'oval extendable dining table, sintered stone top in Calacatta Black, fluted MDF legs in matte black'.",
  "length_cm": <number or null>,
  "width_cm": <number or null>,
  "height_cm": <number or null>,
  "imageUrls": ["<url1>", "<url2>", "<url3>", "<url4>", "<url5>"]
}

Rules:
- description: concrete visual details only, no marketing language
- dimensions: look hard — check spec tables, bullet lists, product descriptions. Polish patterns: "dł." = length, "szer." = width, "wys." = height, "głęb." = depth. Convert mm→cm. If a dimension has a range (e.g. 160–200 cm), use the base/smaller value. If only height is listed, still return it. Never leave all three null if any dimension data exists on the page.
- imageUrls: pick up to 5 best full-size product photos from the list below (prefer og:image or data-large_image sources; avoid thumbnails, avoid duplicate angles)
${structuredContext}

Available image URLs (ordered by likely quality):
${imgUrls.slice(0, 50).join("\n")}
${specContext}
Page text:
${pageText}`;

  const callTextModel = async () => {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TEXT_MODEL}:generateContent?key=${key}`;
    return fetch(endpoint, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents:         [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
    });
  };

  let geminiRes = await callTextModel();

  // Retry once after 2s on overload / rate-limit
  if (geminiRes.status === 503 || geminiRes.status === 429) {
    await new Promise((r) => setTimeout(r, 2000));
    geminiRes = await callTextModel();
  }

  if (!geminiRes.ok) {
    throw new Error(`Gemini ${geminiRes.status}: ${await geminiRes.text()}`);
  }

  const geminiData = await geminiRes.json();
  const rawText    = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
  const json       = JSON.parse(rawText);

  return {
    name:        json.name        ?? "",
    description: json.description ?? "",
    length_cm:   json.length_cm   ?? null,
    width_cm:    json.width_cm    ?? null,
    height_cm:   json.height_cm   ?? null,
    imageUrls:   Array.isArray(json.imageUrls) ? json.imageUrls : [],
  };
}

/**
 * Places a product into a room photo using two sequential Gemini calls.
 *
 * Two-call flow (productImages provided):
 *   Call 1 — ERASE: removes all existing instances of the product type from the room
 *   Call 2 — PLACE: inserts the product using the reference images
 *
 * Single-call fallback (no productImages):
 *   Text description of the product only.
 */
export async function placeInRoom(
  productImages: string[],
  roomPhoto: string,
  productDescription: string,
  dimensions?: ProductDimensions,
): Promise<string> {
  const origImg = await loadImage(roomPhoto);
  const origW = origImg.width;
  const origH = origImg.height;

  const roomResized = await resizeImage(roomPhoto, 1536, 1536, 0.92);

  // Derive a short label from the product description (e.g. "dining table, oak" → "DINING TABLE")
  const productLabel = productDescription
    ? productDescription.split(/[,.(]/)[0].trim().toUpperCase().slice(0, 40)
    : "PRODUCT";

  const dimNote = (dimensions?.length_cm || dimensions?.width_cm || dimensions?.height_cm)
    ? ` Real-world dimensions:${dimensions?.length_cm ? ` L${dimensions.length_cm}cm` : ""}${dimensions?.width_cm ? ` W${dimensions.width_cm}cm` : ""}${dimensions?.height_cm ? ` H${dimensions.height_cm}cm` : ""}.`
    : "";

  // Load perspective + front product images for Call 2.
  const productDataUrls = productImages.length > 0
    ? await Promise.all(productImages.slice(0, 2).map(toDataUrl))
    : [];
  const productResized = await Promise.all(
    productDataUrls.map((img) => resizeImage(img, 1024, 1024, 0.92)),
  );

  // ── CALL 1: ERASE (room only, 1 image) ───────────────────────────────────────
  const erasePrompt =
    `You are a photo editor. You will receive one image.\n\n` +
    `CANVAS: A real photograph of a room.\n\n` +
    `Task: Find and completely erase any ${productLabel.toLowerCase()} or furniture of the same type — ` +
    `regardless of style, colour, or material, and even if covered or obscured by other objects. ` +
    `Fill the erased area naturally with the floor and wall visible in the surrounding areas. ` +
    `Do not change anything else in the room.\n\n` +
    `Output only the edited photo. No text.`;

  let canvasDataUrl = roomResized;
  try {
    const erased = await callGemini([
      { text: erasePrompt },
      { inlineData: { mimeType: "image/jpeg", data: stripPrefix(roomResized) } },
    ]);
    canvasDataUrl = await resizeImage(erased, 1536, 1536, 0.92);
  } catch {
    // Fall back to original room if erase fails
  }

  // ── CALL 2: PLACE (erased room + perspective + front) ────────────────────────
  const numRefs = productResized.length;
  const refLabel = numRefs >= 2 ? "(second and third images)" : "(second image)";
  const imgWord  = numRefs >= 2 ? "three" : "two";

  const placePrompt =
    `You are a photo compositor. You will receive ${imgWord} images and editing instructions.\n\n` +
    `CANVAS (first image): A real photograph of a room. This is what you must edit.\n` +
    `Do not change any existing room content — walls, floor, ceiling, windows must stay exactly as they are.\n\n` +
    `${productLabel} REFERENCE ${refLabel}: Real product photos showing the exact ${productLabel.toLowerCase()} from different angles.\n` +
    (productDescription ? `Product details: ${productDescription}\n` : ``) +
    `Closely replicate every visual detail — shape, material, texture, colour, leg style, and proportions.\n` +
    `Do NOT include any background or environment from the reference photos in the output.\n\n` +
    `Editing instructions:\n` +
    `1. Insert the ${productLabel.toLowerCase()} from the REFERENCE into the CANVAS photo.\n` +
    `2. Place it on the floor in the most natural central position.${dimNote}\n` +
    `3. Use real-world scale — if the ${productLabel.toLowerCase()} doesn't fully fit in the frame at that scale, let it be cropped at the edges. Never shrink it just to make it fit.\n` +
    `4. Match its lighting and colour temperature to the room. Cast a realistic shadow on the floor that follows the direction and softness of existing shadows in the room.\n` +
    `5. The result must look like a single real photograph — not a composite. Blend the edges naturally into the scene. Match the photo's grain, ambient light, and colour cast.\n` +
    `6. Keep the exact same framing, crop, and orientation as the CANVAS photo.\n\n` +
    `Output only the final edited image. No text.`;

  const parts: unknown[] = [
    { text: placePrompt },
    { inlineData: { mimeType: "image/jpeg", data: stripPrefix(canvasDataUrl) } },
    ...productResized.map((img) => ({ inlineData: { mimeType: "image/jpeg", data: stripPrefix(img) } })),
  ];

  const raw = await callGemini(parts);
  return cropToRatio(raw, origW, origH);
}
