const GEMINI_MODEL       = "gemini-2.5-flash-image";
const GEMINI_TEXT_MODEL  = "gemini-2.5-flash";
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
 * Ensures an image is a data URL.
 * - Data URLs are returned as-is.
 * - HTTP(S) URLs: first tries a direct browser fetch (works for Supabase Storage
 *   and other CORS-accessible CDNs); falls back to the /api/scrape proxy for
 *   URLs that block cross-origin requests.
 */
async function toDataUrl(src: string): Promise<string> {
  if (src.startsWith("data:")) return src;

  // 1. Try direct fetch — works for Supabase Storage public URLs and most CDNs
  try {
    const direct = await fetch(src);
    if (direct.ok) {
      const blob = await direct.blob();
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload  = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    }
  } catch {
    // CORS blocked or network error — fall through to proxy
  }

  // 2. Proxy fallback for CORS-blocked URLs (e.g. retailer product pages)
  const res = await fetch(`/api/scrape?url=${encodeURIComponent(src)}&type=image`);
  if (!res.ok) throw new Error(`Failed to fetch image (${res.status}): ${src}`);
  const { data, mimeType } = await res.json();
  if (!data) throw new Error(`Empty image data from proxy: ${src}`);
  return `data:${mimeType};base64,${data}`;
}



/**
 * Crops `src` from the center to match targetW:targetH aspect ratio, then scales
 * to fit within targetW×targetH — but NEVER scales up (avoids zoom-in artifacts).
 */
async function cropToRatio(src: string, targetW: number, targetH: number): Promise<string> {
  try {
    const img = await loadImage(src);
    const srcRatio = img.width / img.height;
    const tgtRatio = targetW / targetH;
    let sx = 0, sy = 0, sw = img.width, sh = img.height;
    if (srcRatio > tgtRatio) {         // too wide — trim sides
      sw = Math.round(img.height * tgtRatio);
      sx = Math.round((img.width - sw) / 2);
    } else if (srcRatio < tgtRatio) {  // too tall — trim top/bottom
      sh = Math.round(img.width / tgtRatio);
      sy = Math.round((img.height - sh) / 2);
    }
    // Scale DOWN to fit inside targetW×targetH; never scale UP
    const scale = Math.min(targetW / sw, targetH / sh, 1);
    const outW = Math.round(sw * scale);
    const outH = Math.round(sh * scale);
    const canvas = document.createElement("canvas");
    canvas.width = outW; canvas.height = outH;
    canvas.getContext("2d")!.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
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

export interface RoomMeasurement {
  ceiling_height_cm:  number | null;
  floor_width_cm:     number | null;
  reference_objects:  string[];
  confidence:         "low" | "medium" | "high";
  detected_furniture: string[];   // furniture types Claude can see in the room
}

/** Calls /api/claude-measure to estimate room dimensions from a photo. */
async function measureRoom(roomDataUrl: string): Promise<RoomMeasurement | null> {
  try {
    const res = await fetch("/api/claude-measure", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ imageDataUrl: roomDataUrl }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data ?? null;
  } catch {
    return null;
  }
}

/**
 * Converts a RoomMeasurement into a short sentence appended to instruction 2.
 * Returns "" for null or low-confidence measurements.
 */
function buildRoomNote(m: RoomMeasurement | null): string {
  if (!m || m.confidence === "low") return "";
  const parts: string[] = [];
  if (m.ceiling_height_cm) parts.push(`ceiling ~${m.ceiling_height_cm}cm tall`);
  if (m.floor_width_cm)    parts.push(`visible floor ~${m.floor_width_cm}cm wide`);
  if (!parts.length) return "";
  return ` Room scale context: ${parts.join(", ")}.`;
}

export interface ExtractedProductData {
  name:        string;
  description: string;
  category:    string | null;
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
  "description": "one sentence describing only the materials and surface finishes of this product — the information that cannot be seen from photos alone. Focus on: what material each part is made of, and whether the finish is glossy, matte, satin, velvet, bouclé, lacquered, oiled, etc. Do not describe shape, silhouette, colour, or dimensions — those are visible in photos. Skip anything unknown. Example: 'Sintered stone top with a high-gloss Calacatta Black finish; fluted MDF base in matte caramel lacquer.'",
  "category": "<one of: table | sofa | chair | bed | wardrobe | shelving | desk | TV stand | other>",
  "length_cm": <number or null>,
  "width_cm": <number or null>,
  "height_cm": <number or null>,
  "imageUrls": ["<url1>", "<url2>", "<url3>", "<url4>", "<url5>"]
}

Rules:
- description: concrete visual details only, no marketing language
- category: pick the single best match from the allowed values. Use "table" for any type of table (dining, coffee, side, console, extendable). Use "sofa" for sofas and sectional sofas. Use "chair" for chairs and armchairs. Never leave null — default to "other" if unsure.
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
    category:    json.category    ?? null,
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
  productName: string,
  productDescription: string,
  dimensions?: ProductDimensions,
  category?: string | null,
): Promise<string> {
  const origImg = await loadImage(roomPhoto);
  const origW = origImg.width;
  const origH = origImg.height;

  const roomResized = await resizeImage(roomPhoto, 1536, 1536, 0.92);

  // eraseLabel: derive the clearest possible single furniture-type word for Gemini.
  // Priority: (1) explicit category, (2) furniture keyword found in product name, (3) first word of name.
  const KNOWN_TYPES = ["sofa", "table", "chair", "bed", "wardrobe", "shelving", "desk", "tv stand"];
  function resolveEraseLabel(cat: string | null | undefined, name: string): string {
    if (cat && cat !== "other") return cat.toLowerCase();
    const lower = name.toLowerCase();
    const match = KNOWN_TYPES.find((t) => lower.includes(t));
    if (match) return match;
    return name.split(/[,.(]/)[0].trim().toLowerCase();
  }
  const eraseLabel   = resolveEraseLabel(category, productName);
  // placeLabel: always use product name for the placement prompt (more specific)
  const productLabel = productName
    ? productName.split(/[,.(]/)[0].trim().toUpperCase().slice(0, 40)
    : "PRODUCT";
  // All other furniture types Gemini must NOT touch during erase
  const otherTypes = KNOWN_TYPES.filter((t) => t !== eraseLabel).join(", ");

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

  // ── CALL 1: ERASE + Claude room measurement (run in parallel) ────────────────
  const erasePrompt =
    `You are a photo editor. You will receive one image.\n\n` +
    `CANVAS: A real photograph of a room.\n\n` +
    `Task: Look for a ${eraseLabel} in this room. ` +
    `If one is present, erase it completely and fill the area naturally with the surrounding floor and wall.\n\n` +
    `STRICT RULES:\n` +
    `- Erase ONLY items that are clearly a ${eraseLabel}. Do not erase any other furniture type.\n` +
    `- Do NOT touch or remove any of these — they must stay exactly as-is: ${otherTypes}, rugs, plants, curtains, lamps, artwork, decorations, or any other object.\n` +
    `- If you cannot find a ${eraseLabel} in the room, return the photo pixel-for-pixel unchanged. Do not erase anything.\n` +
    `- Do not "clear the area" or remove things to make space — only erase an actual ${eraseLabel} if you can see one.\n\n` +
    `IMPORTANT: Output the photo at the EXACT SAME framing and zoom level as the input. Do not zoom in, zoom out, pan, or recompose in any way.\n\n` +
    `Output only the edited photo. No text.`;

  const [eraseResult, measureResult] = await Promise.allSettled([
    callGemini([
      { text: erasePrompt },
      { inlineData: { mimeType: "image/jpeg", data: stripPrefix(roomResized) } },
    ]),
    measureRoom(roomResized),
  ]);

  const measurement = measureResult.status === "fulfilled" ? measureResult.value : null;

  // Only use the erase result if Claude confirmed the target furniture type is present.
  // If Claude didn't run or returned no detected_furniture, fall back to using the erase
  // result (conservative: preserves existing behaviour when measurement is unavailable).
  const targetPresent =
    !measurement?.detected_furniture?.length   // Claude didn't detect anything → fall back
    || measurement.detected_furniture.some(
         (f) => f.toLowerCase().includes(eraseLabel) || eraseLabel.includes(f.toLowerCase())
       );

  let canvasDataUrl = roomResized;
  if (eraseResult.status === "fulfilled" && targetPresent) {
    // Crop erase output back to the original aspect ratio so any erase-step
    // framing drift doesn't compound into the place step
    canvasDataUrl = await cropToRatio(eraseResult.value, origW, origH);
  }

  const roomNote = buildRoomNote(measurement);

  // ── CALL 2: PLACE (erased room + product photos + original as framing master) ──
  const numRefs     = productResized.length;
  const productSlot = numRefs >= 2 ? "second and third images" : "second image";
  const framingSlot = numRefs >= 2 ? "fourth image" : "third image";

  const placePrompt =
    `You are a compositing tool. You will overlay a furniture object onto an existing room photo.\n\n` +
    `BACKGROUND (first image): The room to composite into. Furniture has been cleared from this area.\n\n` +
    `${productLabel} REFERENCE (${productSlot}): Photos of the exact ${productLabel.toLowerCase()} to place in the room.\n` +
    (productDescription ? `Product details: ${productDescription}\n` : ``) +
    `PRODUCT FIDELITY: The ${productLabel.toLowerCase()} must look identical to the REFERENCE — same shape, colour, material, texture, surface finish, and proportions. Do not redesign or substitute it.\n` +
    `Do NOT carry over any background from the reference images.\n\n` +
    `FRAMING MASTER (${framingSlot}): The same room from the same camera angle — used as a pixel-level framing template only. Your output must reproduce the framing of this image exactly: ceiling line, wall edges, artworks, windows, and floor boundaries must appear at the identical positions. Ignore any furniture visible in this image.\n\n` +
    `Compositing steps:\n` +
    `0. This is a precise technical overlay, not a creative photography task. Do not recompose, crop, zoom, pan, or rotate the scene. Treat the image grid as locked pixels.\n` +
    `1. Compare BACKGROUND with FRAMING MASTER — they show the same room. Use FRAMING MASTER as your ruler: every structural element (ceiling, walls, artworks, floor edges) must be at the same position in your output. Do not zoom in.\n` +
    `2. Place the ${productLabel.toLowerCase()} on the floor at a natural central position.${dimNote}${roomNote}\n` +
    `3. Size it to real-world scale. If very large, let its edges be cropped — do not shrink the room to fit the furniture.\n` +
    `4. The furniture must rest naturally on the floor with no gap — it must not appear to float.\n` +
    `5. Light it to match the room's light sources. Cast a realistic shadow beneath it. Reproduce the exact surface qualities from the REFERENCE — matte stays matte, glossy surfaces show realistic reflections, fabric textures stay visible.\n` +
    `6. Blend its edges naturally into the scene.\n\n` +
    `Output only the composited image. No text.`;

  const parts: unknown[] = [
    { text: placePrompt },
    { inlineData: { mimeType: "image/jpeg", data: stripPrefix(canvasDataUrl) } },           // BACKGROUND (erased)
    ...productResized.map((img) => ({ inlineData: { mimeType: "image/jpeg", data: stripPrefix(img) } })), // PRODUCT REFERENCE
    { inlineData: { mimeType: "image/jpeg", data: stripPrefix(roomResized) } },             // FRAMING MASTER (original)
  ];

  const raw = await callGemini(parts);
  return cropToRatio(raw, origW, origH);
}
