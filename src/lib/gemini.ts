const GEMINI_MODEL       = "gemini-2.5-flash-image";
const GEMINI_TEXT_MODEL = "gemini-2.5-flash";

function getEndpoint() {
  const key = import.meta.env.VITE_GEMINI_API_KEY as string;
  if (!key) throw new Error("VITE_GEMINI_API_KEY is not set");
  return `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;
}

const stripPrefix = (b64: string) => b64.replace(/^data:[^;]+;base64,/, "");

function parseDataUrl(dataUrl: string): { mimeType: string; data: string } {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
  if (match) return { mimeType: match[1], data: match[2] };
  return { mimeType: "image/jpeg", data: dataUrl };
}

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
  const body = {
    contents: [{ role: "user", parts }],
    generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
  };

  const res = await fetch(getEndpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
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

  const roomResized = await resizeImage(roomPhoto, 2048, 2048, 0.92);

  let raw: string;

  if (productImages.length > 0) {
    // ── Call 1: Erase existing furniture ──────────────────────────────────────
    const eraseParts = [
      {
        text:
          "⚠️ FRAMING RULE (non-negotiable): The output must have the EXACT same crop, field of view, and aspect ratio as the input. Do NOT zoom, pan, or reframe in any way.\n\n" +
          `The product being placed is: "${productDescription}".\n\n` +
          "TASK — ERASE STEP:\n" +
          "1. Identify the furniture CATEGORY of the product above (e.g. dining table, sofa, desk, bed, coffee table, wardrobe, shelf, armchair, etc.).\n" +
          "2. Find and remove EVERY item in the room photo that belongs to that same category — regardless of colour, size, material, or style. Remove ALL of them, not just the most obvious one.\n" +
          "3. Fill every vacated area with realistic floor, wall, or background textures that blend seamlessly with the surroundings — no smearing, no ghost outlines, no blank patches.\n" +
          "4. Leave all other objects, walls, lighting, and architecture completely unchanged.\n\n" +
          "Output only the edited photo with the category cleared. No text.",
      },
      { inlineData: { mimeType: "image/jpeg", data: stripPrefix(roomResized) } },
    ];

    const emptyRoom = await callGemini(eraseParts);
    const { mimeType: emptyMime, data: emptyData } = parseDataUrl(emptyRoom);

    // ── Call 2: Place the product ─────────────────────────────────────────────
    // Convert any Supabase / HTTP URLs to base64 data URLs via proxy first,
    // so canvas operations don't get blocked by CORS taint.
    const dataUrls = await Promise.all(
      productImages.slice(0, 2).map(toDataUrl)
    );
    const resized = await Promise.all(
      dataUrls.map((img) => resizeImage(img, 1024, 1024, 0.92))
    );

    const placeParts: unknown[] = [
      {
        text:
          "⚠️ FRAMING RULE (non-negotiable): The output must have the EXACT same crop, field of view, and aspect ratio as the EMPTY ROOM photo. Do NOT zoom, pan, or reframe in any way.\n\n" +
          "You will receive product reference images and an EMPTY ROOM photo to edit.",
      },
    ];

    if (resized[0]) {
      placeParts.push(
        { text: "DESIGN REFERENCE — a photo of the product. Study the main furniture piece only: its material, colour, shape, proportions, and style. Ignore any chairs, stools, decorations, tableware, flowers, lamps, or other objects shown alongside it — those are styling props, not part of the product." },
        { inlineData: { mimeType: "image/jpeg", data: stripPrefix(resized[0]) } },
      );
    }
    if (resized[1]) {
      placeParts.push(
        { text: "SECONDARY REFERENCE — another view of the same product. Use this to understand its exact outline and depth. Again, focus only on the main furniture piece — ignore all styling props, chairs, decorations, and accessories." },
        { inlineData: { mimeType: "image/jpeg", data: stripPrefix(resized[1]) } },
      );
    }

    placeParts.push(
      { text: "EMPTY ROOM (place the product into this photo):" },
      { inlineData: { mimeType: emptyMime, data: emptyData } },
      {
        text:
          "Edit the EMPTY ROOM photo as follows:\n" +
          "STEP 1 — CLEAR: If any similar furniture is still visible, erase it and fill with realistic floor/wall textures.\n" +
          "STEP 2 — PLACE: Put ONLY the main furniture piece from the reference images into the cleared space — not the chairs, not the decorations, not the tableware, only the product itself. Copy its exact material, colour, shape, and style. Position it naturally on the floor, centred in the main area. Match its viewing angle to the room's perspective.\n" +
          "STEP 3 — INTEGRATE: Scale it realistically to the room." +
          (dimensions?.length_cm || dimensions?.width_cm || dimensions?.height_cm
            ? ` The product's real dimensions are:${dimensions.length_cm ? ` length ${dimensions.length_cm} cm` : ""}${dimensions.width_cm ? `, width ${dimensions.width_cm} cm` : ""}${dimensions.height_cm ? `, height ${dimensions.height_cm} cm` : ""}. Use these to set the correct proportional scale relative to the room's architecture (doorframes, walls, floor tiles, etc.).`
            : " Use the room's architectural elements to judge realistic scale.") +
          " Match its lighting and shadows to the room's light sources. Add a soft drop shadow beneath it.\n\n" +
          "⚠️ FRAMING RULE (repeated): Same crop, same framing as the EMPTY ROOM photo. No zoom. No reframe. Output only the final photo.",
      },
    );

    raw = await callGemini(placeParts);

  } else {
    // ── Single-call fallback: text description only ───────────────────────────
    const parts = [
      {
        text:
          "You are a photo editor. I am giving you a real room photograph.\n\n" +
          "EDIT this exact photo — do NOT recreate or regenerate it.\n\n" +
          "Task:\n" +
          `1. Identify the furniture category of "${productDescription}". Find and remove EVERY item in the room that belongs to that same category — regardless of colour or size — and fill the area with natural floor/wall textures.\n` +
          `2. Place a ${productDescription} in the cleared space.\n` +
          `3. Place it in the most natural position in the room.\n` +
          `4. Scale it realistically — it should look like it physically belongs there.\n` +
          `5. Match its lighting and shading to the room's light sources. Add a soft shadow beneath it.\n` +
          `6. Keep every other element completely unchanged.\n` +
          `7. MANDATORY — do NOT crop, zoom, pan, or reframe the image in any way.\n\n` +
          "Output only the edited photo. No text.",
      },
      { inlineData: { mimeType: "image/jpeg", data: stripPrefix(roomResized) } },
    ];

    raw = await callGemini(parts);
  }

  return cropToRatio(raw, origW, origH);
}
