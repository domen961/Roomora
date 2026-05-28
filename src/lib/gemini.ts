const GEMINI_MODEL = "gemini-2.5-flash-image";
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

async function resizeImage(src: string, maxW: number, maxH: number, quality = 0.8, background?: string): Promise<string> {
  try {
    const img = await loadImage(src);
    const scale = Math.min(maxW / img.width, maxH / img.height, 1);
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    if (background) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", quality);
  } catch {
    return src;
  }
}

/**
 * Prepares a product reference image for Gemini:
 * 1. Composites onto white (handles transparency)
 * 2. Auto-crops the white margins so the product fills the frame
 * 3. Resizes to maxW × maxH
 *
 * Tight framing gives Gemini better visual fidelity and avoids the
 * "flat paste-in" look caused by excessive white border area.
 */
async function prepareProductImage(src: string, maxW: number, maxH: number, quality = 0.92): Promise<string> {
  try {
    const img = await loadImage(src);

    // Step 1: composite onto white at full resolution
    const full = document.createElement("canvas");
    full.width = img.width; full.height = img.height;
    const fCtx = full.getContext("2d")!;
    fCtx.fillStyle = "#ffffff";
    fCtx.fillRect(0, 0, img.width, img.height);
    fCtx.drawImage(img, 0, 0);

    // Step 2: find bounding box of non-white pixels (threshold < 242 on any channel)
    const pixels = fCtx.getImageData(0, 0, img.width, img.height).data;
    let minX = img.width, minY = img.height, maxX = 0, maxY = 0;
    const T = 242;
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        const i = (y * img.width + x) * 4;
        if (pixels[i] < T || pixels[i + 1] < T || pixels[i + 2] < T) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    const cropW = maxX - minX + 1;
    const cropH = maxY - minY + 1;

    // Fallback: image is all-white or trivially small
    if (cropW < 10 || cropH < 10) return resizeImage(src, maxW, maxH, quality, "#ffffff");

    // Step 3: add ~6% padding around the detected object
    const padX = Math.round(cropW * 0.06);
    const padY = Math.round(cropH * 0.06);
    const sx = Math.max(0, minX - padX);
    const sy = Math.max(0, minY - padY);
    const sw = Math.min(img.width  - sx, cropW + padX * 2);
    const sh = Math.min(img.height - sy, cropH + padY * 2);

    // Step 4: scale cropped region to target size
    const scale = Math.min(maxW / sw, maxH / sh, 1);
    const outW  = Math.round(sw * scale);
    const outH  = Math.round(sh * scale);

    const out = document.createElement("canvas");
    out.width = outW; out.height = outH;
    const oCtx = out.getContext("2d")!;
    oCtx.fillStyle = "#ffffff";
    oCtx.fillRect(0, 0, outW, outH);
    oCtx.drawImage(full, sx, sy, sw, sh, 0, 0, outW, outH);
    return out.toDataURL("image/jpeg", quality);
  } catch {
    return resizeImage(src, maxW, maxH, quality, "#ffffff");
  }
}

async function callGemini(parts: unknown[]): Promise<string> {
  const MAX_RETRIES = 4;
  // Exponential back-off delays for 429: 5 s, 10 s, 20 s, 40 s
  const BACKOFF_MS = [5_000, 10_000, 20_000, 40_000];

  const body = {
    contents: [{ role: "user", parts }],
    generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
  };

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90_000); // 90 s per attempt

    try {
      const res = await fetch(getEndpoint(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      // Rate-limited — check whether it's daily quota or per-minute spike
      if (res.status === 429) {
        const errText = await res.text();
        console.warn("callGemini 429 body:", errText.slice(0, 300));

        // Daily/project quota exhausted — retrying won't help until reset
        const isQuotaExhausted =
          errText.includes("per_day") ||
          errText.includes("daily") ||
          errText.includes("RESOURCE_EXHAUSTED");

        if (isQuotaExhausted && attempt === 0) {
          // First hit on a quota-exhausted error → fail fast with a clear message
          throw new Error(
            "Gemini quota exhausted — your free daily limit has been reached. " +
            "Check https://aistudio.google.com for quota status or use a paid API key. " +
            "Quota resets at midnight Pacific time.",
          );
        }

        if (attempt >= MAX_RETRIES) {
          throw new Error(
            "Gemini rate limit (429) — too many requests. Wait a minute and try again.",
          );
        }
        const delay = BACKOFF_MS[attempt] ?? 40_000;
        console.warn(`callGemini: 429 rate limit, retrying in ${delay / 1000}s (attempt ${attempt + 1}/${MAX_RETRIES})`);
        clearTimeout(timer);
        await new Promise((r) => setTimeout(r, delay));
        continue; // next iteration of the loop
      }

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

  // Should never reach here — TypeScript requires an explicit throw
  throw new Error("Gemini: max retries exceeded");
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
  camera_height_cm:   number | null;
  horizon_pct:        number | null;
  camera_angle:       "looking_down" | "level" | "looking_up" | null;
  camera_tilt_deg:    number | null;  // degrees camera looks down from horizontal (0=level, 90=straight down)
  visible_refs:       Array<{ name: string; height_cm: number }>;  // visible furniture with estimated heights
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

function buildPerspectiveNote(m: RoomMeasurement | null): string {
  if (!m || m.confidence === "low") return "";
  const parts: string[] = [];
  if (m.camera_height_cm)
    parts.push(`camera is at ~${m.camera_height_cm}cm from the floor`);
  if (m.camera_tilt_deg !== null && m.camera_tilt_deg > 5) {
    const desc = m.camera_tilt_deg < 20 ? "nearly level"
               : m.camera_tilt_deg < 35 ? "mild downward tilt"
               : m.camera_tilt_deg < 55 ? "strong downward tilt"
               : "very steep downward angle";
    parts.push(`camera looks down at ~${m.camera_tilt_deg}° from horizontal (${desc}) — the furniture's top surface and the top of the backrest are visible; show them accordingly`);
  } else if (m.camera_angle === "looking_down") {
    parts.push("camera tilts downward — more of the furniture top surface is visible");
  } else if (m.camera_angle === "looking_up") {
    parts.push("camera tilts upward — furniture top surface is mostly hidden");
  }
  if (m.horizon_pct !== null) {
    const pos = m.horizon_pct < 35 ? "high in the frame"
               : m.horizon_pct > 65 ? "low in the frame"
               : "mid-frame";
    parts.push(`horizon line is ${pos}`);
  }
  if (!parts.length) return "";
  return ` Camera viewpoint: ${parts.join("; ")}.`;
}

/**
 * Computes a scale hint using a door (200cm) as a universal visible reference.
 * Door comparison is far more reliable than "% of ceiling height" because a door
 * is a concrete, universally-recognised object Gemini can anchor to in the image.
 */
function buildScaleNote(m: RoomMeasurement | null, dims?: ProductDimensions): string {
  if (!dims?.height_cm) return "";
  const height = dims.height_cm;

  // Visual anchor: find the visible room object whose height is closest to the product's
  let anchorPart = "";
  const refs = m?.visible_refs ?? [];
  if (refs.length) {
    const best = refs.reduce((a, b) =>
      Math.abs(a.height_cm - height) < Math.abs(b.height_cm - height) ? a : b,
    );
    const word = height < best.height_cm * 0.88 ? "noticeably shorter than"
               : height > best.height_cm * 1.12 ? "noticeably taller than"
               : "roughly the same height as";
    anchorPart =
      ` It is ${word} the ${best.name} already visible in the room (~${best.height_cm}cm tall).` +
      ` Use that object as your primary visual size anchor — their heights must compare correctly in the final image.`;
  }

  const doorPct  = Math.round((height / 200) * 100);
  const ceilPart = (m && m.confidence !== "low" && m.ceiling_height_cm)
    ? `, and ${Math.round((height / m.ceiling_height_cm) * 100)}% as tall as the ceiling (~${m.ceiling_height_cm}cm)`
    : "";

  return ` Scale: the furniture is ${height}cm tall — ${doorPct}% as tall as a standard door (~200cm)${ceilPart}.${anchorPart} Match this scale precisely.`;
}

/**
 * Asks Gemini to synthesise a view of the furniture from a specific elevation angle.
 * Used when the room camera is steeply tilted (≥ 35°) and the 2 standard product
 * photos don't give enough angular coverage for Gemini to composite correctly.
 *
 * @param preparedImgs  - white-bg + auto-cropped product images (already prepared)
 * @param tiltDeg       - target elevation in degrees (from Claude camera_tilt_deg)
 * @param furnitureType - e.g. "chair", "sofa", "table"
 * @returns data URL of the synthesised view, or null on failure
 */
/** Elevation angle of a standard product photo (roughly 28° above horizontal). */
const PRODUCT_SOURCE_ANGLE = 28;
/**
 * Controls warp aggressiveness.
 * 0 = no warp, 1 = full geometric warp.
 * 0.55 gives a natural-looking result; lower if over-distorted, higher if too subtle.
 */
const WARP_TUNE = 0.35;

/**
 * Applies a strip-based keystone (perspective) warp to a product image so that
 * the viewing angle matches the room camera rather than the standard product-photo angle.
 *
 * - deltaDeg > 0 (room camera higher) → compress the top → more seat/tabletop visible
 * - deltaDeg < 0 (room camera lower)  → expand the top  → more front face visible
 * - |deltaDeg| < 8°                   → skip (imperceptible difference)
 */
async function warpProductAngle(src: string, roomAngleDeg: number): Promise<string> {
  const deltaDeg = roomAngleDeg - PRODUCT_SOURCE_ANGLE;
  if (Math.abs(deltaDeg) < 8) return src;  // too small to bother

  try {
    const img = await loadImage(src);
    const W = img.width;
    const H = img.height;
    const canvas = document.createElement("canvas");
    canvas.width  = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);

    // topScale < 1 compresses the top, creating a trapezoid that simulates a higher camera
    const topScale = Math.max(0.35, 1 - Math.sin(deltaDeg * Math.PI / 180) * WARP_TUNE);

    for (let y = 0; y < H; y++) {
      const progress = y / H;
      const scale    = topScale + (1 - topScale) * progress;
      const rowW     = Math.round(W * scale);
      const offsetX  = Math.round((W - rowW) / 2);
      // Draw one scanline of the source into the (possibly narrower) row
      ctx.drawImage(img, 0, y, W, 1, offsetX, y, rowW, 1);
    }
    return canvas.toDataURL("image/jpeg", 0.92);
  } catch {
    return src;  // graceful fallback — never blocks placement
  }
}

/**
 * Generates a steep-angle (75° elevation) view of a product using Gemini Image.
 * Called automatically when photos are added in the admin panel; results are stored in
 * Supabase as `image_2` (perspective alt) and `image_3` (front alt). At placement time
 * `placeInRoom` uses them as extra reference images so Gemini can composite from the
 * room's steep camera without having to extrapolate perspective from flat product photos.
 *
 * @param productImgs   Supabase storage URLs or data URLs of the product (perspective + front)
 * @param furnitureType e.g. "chair", "sofa", "table" — used in the generation prompt
 * @param variant       "perspective" = diagonal overhead view; "front" = straight-on overhead
 */
export async function generateProductAltView(
  productImgs: string[],
  furnitureType: string,
  variant: "perspective" | "front" = "perspective",
): Promise<string> {
  const dataUrls = await Promise.all(productImgs.slice(0, 2).map(toDataUrl));
  const prepared = await Promise.all(
    dataUrls.map((img) => prepareProductImage(img, 1024, 1024, 0.92)),
  );

  const perspPrompt =
    `You receive photos of a ${furnitureType}. ` +
    `Synthesise ONE new photo of this exact same ${furnitureType} as seen from a camera ` +
    `elevated at approximately 75° above horizontal — almost directly overhead, ` +
    `from a slightly diagonal (3/4) angle. ` +
    `The top surface (seat/cushion/tabletop) should dominate the frame; ` +
    `legs or base visible only as short stubs at the corners spreading slightly outward. ` +
    `Keep the model, materials, colours, stitching details, and proportions ` +
    `IDENTICAL to the reference photos. ` +
    `White background. Single object only, centred. No shadows, no room context.`;

  const frontPrompt =
    `You receive photos of a ${furnitureType}. ` +
    `Synthesise ONE new photo of this exact same ${furnitureType} as seen from a camera ` +
    `elevated at approximately 75° above horizontal, positioned directly in front of the furniture — ` +
    `looking steeply down at the front face from above. ` +
    `The front face is visible at the bottom of the frame, heavily foreshortened; ` +
    `the top surface occupies most of the upper portion of the frame. ` +
    `Legs visible only at the bottom corners as short stubs. ` +
    `Keep the model, materials, colours, stitching details, and proportions ` +
    `IDENTICAL to the reference photos. ` +
    `White background. Single object only, centred. No shadows, no room context.`;

  const prompt = variant === "front" ? frontPrompt : perspPrompt;

  const parts: unknown[] = [
    { text: prompt },
    ...prepared.map((img) => ({
      inlineData: { mimeType: "image/jpeg", data: stripPrefix(img) },
    })),
  ];
  return callGemini(parts);
}

/**
 * Renders a 200×200 solid-color JPEG swatch from a hex string.
 * Included in every color-variant Gemini call as an absolute visual anchor
 * so all 4 slots interpret the target color identically regardless of angle/lighting.
 */
function createColorSwatch(hexColor: string): string {
  try {
    const canvas = document.createElement("canvas");
    canvas.width  = 200;
    canvas.height = 200;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = hexColor.startsWith("#") ? hexColor : "#888888";
    ctx.fillRect(0, 0, 200, 200);
    return canvas.toDataURL("image/jpeg", 0.95);
  } catch {
    return "";
  }
}

/**
 * Generates a color or texture variant of a product.
 *
 * Strategy for color consistency:
 *   1. Generate the MASTER variant from the first available base image using the
 *      full modification prompt (hex / description / texture).
 *   2. Generate all remaining slots in parallel, passing the master result as a
 *      visual COLOR REFERENCE so Gemini matches the exact hue/material instead
 *      of re-interpreting the text description independently each time.
 *
 * This adds one sequential step (~8 s extra) but eliminates per-image color drift.
 *
 * @param baseImages    - Supabase storage URLs or data URLs for the product (up to 4)
 * @param furnitureType - e.g. "sofa", "chair", "table"
 * @param parts         - one or more { targetPart, modification } descriptors applied simultaneously
 * @param onSlotReady   - optional callback fired as each slot resolves (for progressive UI updates)
 */

export type VariantPart = {
  targetPart:   string;
  modification:
    | { type: "color"; hexColor: string; description?: string }
    | { type: "texture"; dataUrl: string };
};

export async function generateVariant(
  baseImages:    string[],
  furnitureType: string,
  parts:         VariantPart[],
  onSlotReady?:  (index: number, dataUrl: string | null) => void,
): Promise<(string | null)[]> {

  // ── Prepare all base images up front ────────────────────────────────────────
  const dataUrls = await Promise.all(
    baseImages.slice(0, 4).map((img, i) =>
      toDataUrl(img).catch((err) => {
        console.error(`generateVariant: toDataUrl slot ${i} failed:`, err instanceof Error ? err.message : err, "\nURL:", img?.slice(0, 120));
        return null;
      }),
    ),
  );

  // Pre-load all textures in parallel (one per texture part, keyed by index)
  const textures = await Promise.all(
    parts.map((p) =>
      p.modification.type === "texture"
        ? toDataUrl(p.modification.dataUrl).then((d) => resizeImage(d, 512, 512, 0.85)).catch(() => null)
        : Promise.resolve(null),
    ),
  );

  // Pre-build solid swatches for all color parts
  const swatches = parts.map((p) =>
    p.modification.type === "color" ? createColorSwatch(p.modification.hexColor) : null,
  );

  // ── Build Gemini parts array for a single product photo ─────────────────────
  const buildGeminiParts = (prepared: string): unknown[] => {
    // Count how many reference images we'll attach (swatch or texture per part)
    const refImages: string[] = [];
    parts.forEach((_, i) => {
      const img = swatches[i] ?? textures[i];
      if (img) refImages.push(img);
    });

    // Build numbered change instructions that reference image slots
    let imgSlot = 2; // slot 1 = product photo; slot 2+ = reference images
    const changeLines = parts.map((p, i) => {
      const ref   = swatches[i] ?? textures[i];
      const label = swatches[i]
        ? `image ${imgSlot} is a COLOR SWATCH showing the exact target hue — use it as the absolute color reference`
        : `image ${imgSlot} is a TEXTURE REFERENCE — apply that material to this part`;
      const desc  = p.modification.type === "color"
        ? (p.modification.description?.trim() || `the color ${p.modification.hexColor}`)
        : "the texture shown in the reference image";
      if (ref) imgSlot++;
      return `${i + 1}. Change ${p.targetPart} to ${desc}. ${label}.`;
    });

    const many = parts.length > 1;
    const prompt =
      `You receive a product photo of a ${furnitureType}` +
      (refImages.length ? ` and ${refImages.length} reference image${refImages.length > 1 ? "s" : ""}` : "") + `.\n` +
      (many
        ? `Apply ALL of the following changes simultaneously:\n${changeLines.join("\n")}\n`
        : `${changeLines[0]}\n`) +
      `RULES:\n` +
      (many ? `- Apply ALL changes at once — do not skip any part.\n` : "") +
      `- Only change the specified part${many ? "s" : ""} — every other area of the furniture stays identical.\n` +
      `- Preserve the original lighting, shadows, and highlights — do not alter the light direction.\n` +
      `- Shape, proportions, stitching, and background must remain pixel-perfect identical.\n` +
      `- White background. Same camera angle. Same lighting direction.\n` +
      `Output: the modified product photo only. No text.`;

    return [
      { text: prompt },
      { inlineData: { mimeType: "image/jpeg", data: stripPrefix(prepared) } },
      ...refImages.map((img) => ({ inlineData: { mimeType: "image/jpeg", data: stripPrefix(img) } })),
    ];
  };

  // ── Color-transfer helper ────────────────────────────────────────────────────
  // Used for slots 1, 2, 3 once the master (slot 0) is ready.
  // Image 1 = target view (original, unmodified, at its own angle)
  // Image 2 = master (slot 0 result — the single source of truth for color)
  // Gemini's task: copy the exact coloring from Image 2 onto Image 1's angle.
  // This is far more reliable than re-interpreting "dark brown" text independently
  // for each angle — Gemini just matches pixels, not descriptions.
  const buildColorTransferParts = (prepared: string, master: string): unknown[] => {
    const prompt =
      `You receive two product photos of the same ${furnitureType}:\n` +
      `- Image 1: the original furniture at a specific camera angle\n` +
      `- Image 2: the same furniture with a color/material modification correctly applied\n\n` +
      `Task: Reproduce the furniture exactly as shown in Image 1 (IDENTICAL camera angle, framing, shape, proportions, and lighting), ` +
      `but apply the EXACT SAME color and material changes that are visible in Image 2.\n\n` +
      `RULES:\n` +
      `- Match the colors and materials from Image 2 part by part — copy them precisely.\n` +
      `- Parts that were NOT changed in Image 2 must stay their original color from Image 1.\n` +
      `- The camera angle in your output must match Image 1 exactly — do not change the viewpoint.\n` +
      `- Preserve the lighting, shadows, and material texture from Image 1.\n` +
      `- White background. No text.\n` +
      `Output: one photo only.`;
    return [
      { text: prompt },
      { inlineData: { mimeType: "image/jpeg", data: stripPrefix(prepared) } },
      { inlineData: { mimeType: "image/jpeg", data: stripPrefix(master) } },
    ];
  };

  // ── Generate all slots sequentially (one at a time) ────────────────────────
  // Running slots in parallel fires multiple Gemini image requests simultaneously
  // and reliably hits the per-minute rate limit (429). Sequential execution avoids
  // this with zero extra latency on the *first* slot (user sees progressive fills).
  //
  // Order: 0 → 1 → 2 → 3
  // Slots 0 and 1: direct modification with the colour swatch as visual anchor.
  // Slots 2 and 3: colour-transfer from slot 0 result (avoids phantom colours on
  //               the ambiguous 75° overhead angle).
  const results: (string | null)[] = [null, null, null, null];

  // ── Slots 0 and 1: direct modification ───────────────────────────────────
  for (const i of [0, 1]) {
    const img = dataUrls[i];
    if (!img) { onSlotReady?.(i, null); continue; }
    try {
      const prepared = await prepareProductImage(img, 1024, 1024, 0.92);
      results[i] = await callGemini(buildGeminiParts(prepared)).catch((err) => {
        console.error(`generateVariant: callGemini slot ${i} failed:`, err instanceof Error ? err.message : err);
        return null;
      });
      onSlotReady?.(i, results[i]);
    } catch (err) {
      console.error(`generateVariant: slot ${i} unexpected error:`, err instanceof Error ? err.message : err);
      onSlotReady?.(i, null);
    }
  }

  // ── Slots 2 and 3: colour-transfer from the master (slot 0 or 1) ─────────
  const masterResult  = results[0] ?? results[1];
  const masterResized = masterResult
    ? await resizeImage(masterResult, 1024, 1024, 0.92)
    : null;

  for (const i of [2, 3]) {
    const img = dataUrls[i];
    if (!img) { onSlotReady?.(i, null); continue; }
    try {
      const prepared = await prepareProductImage(img, 1024, 1024, 0.92);
      let result: string | null = null;

      if (masterResized) {
        result = await callGemini(buildColorTransferParts(prepared, masterResized)).catch((err) => {
          console.error(`generateVariant: color-transfer slot ${i} failed:`, err instanceof Error ? err.message : err);
          return null;
        });
      }
      // Fallback: direct modification if master unavailable
      if (!result) {
        result = await callGemini(buildGeminiParts(prepared)).catch((err) => {
          console.error(`generateVariant: direct fallback slot ${i} failed:`, err instanceof Error ? err.message : err);
          return null;
        });
      }

      results[i] = result;
      onSlotReady?.(i, result);
    } catch (err) {
      console.error(`generateVariant: slot ${i} unexpected error:`, err instanceof Error ? err.message : err);
      onSlotReady?.(i, null);
    }
  }

  return results;
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
    return fetch("/api/gemini-text", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
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
  const rawText    = geminiData?.text ?? "{}";
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

  // ── CALL 1: ERASE + Claude room measurement (run in parallel) ────────────────
  // Product image prep intentionally runs AFTER allSettled so it can use camera_tilt_deg.
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

  // ── Product image prep ──────────────────────────────────────────────────────
  // productImages[2] = 75° perspective alt view (topdown.jpg)
  // productImages[3] = 75° front alt view (topdown_front.jpg)
  // Both are pre-computed at product-save time via generateProductAltView().
  const productDataUrls = productImages.length > 0
    ? await Promise.all(productImages.slice(0, 4).map(toDataUrl))
    : [];
  const roomAngle      = measurement?.camera_tilt_deg ?? null;
  const hasPrebuiltAlt = productDataUrls.length >= 3;

  const preparedImgs = await Promise.all(
    productDataUrls.map((img) => prepareProductImage(img, 1024, 1024, 0.92)),
  );

  // Apply geometric warp only for the two standard views and only when no
  // pre-built alt view exists (the alt view is already at the right angle).
  const productResized: string[] = await Promise.all(
    preparedImgs.map((img, i) => {
      if (hasPrebuiltAlt || i >= 2) return Promise.resolve(img);
      return roomAngle !== null ? warpProductAngle(img, roomAngle) : Promise.resolve(img);
    }),
  );

  // Only use the erase result if Claude confirmed the target furniture type is present.
  // - measurement === null  → Claude API failed entirely → fall back (use erase result, old behaviour)
  // - detected_furniture: [] → Claude checked, found nothing → SKIP erase (nothing of that type exists)
  // - detected_furniture contains eraseLabel → target is present → use erase result
  const targetPresent =
    measurement === null                       // Claude API failed entirely → fall back
    || measurement.detected_furniture.some(
         (f) => f.toLowerCase().includes(eraseLabel) || eraseLabel.includes(f.toLowerCase())
       );

  const eraseWasApplied = eraseResult.status === "fulfilled" && targetPresent;

  let canvasDataUrl = roomResized;
  if (eraseWasApplied) {
    // Crop erase output back to the original aspect ratio so any erase-step
    // framing drift doesn't compound into the place step
    canvasDataUrl = await cropToRatio(eraseResult.value, origW, origH);
  }

  const roomNote  = buildRoomNote(measurement);
  const perspNote = buildPerspectiveNote(measurement);
  const scaleNote = buildScaleNote(measurement, dimensions);

  // ── CALL 2: PLACE (erased room + product photos + original as framing master) ──
  const numRefs     = productResized.length;
  const productSlot = numRefs >= 4 ? "second, third, fourth, and fifth images"
                    : numRefs >= 3 ? "second, third, and fourth images"
                    : numRefs >= 2 ? "second and third images"
                    : "second image";
  const framingSlot = numRefs >= 4 ? "sixth image"
                    : numRefs >= 3 ? "fifth image"
                    : numRefs >= 2 ? "fourth image"
                    : "third image";
  const numAltViews = Math.max(0, numRefs - 2);

  // When the erase step was skipped (target furniture not in room), the background
  // still contains all original furniture — tell Gemini this explicitly so it does
  // not clear anything to "make room" for the new product.
  const backgroundDesc = eraseWasApplied
    ? `BACKGROUND (first image): The room to composite into. The existing ${eraseLabel} has been cleared from the floor area — the rest of the room is untouched.`
    : `BACKGROUND (first image): The original room as photographed. Every piece of furniture, rug, plant, and decoration you can see MUST remain in your output exactly as-is. Do not remove, move, or alter any existing object.`;

  const placePrompt =
    `You are a compositing tool. You will overlay a furniture object onto an existing room photo.\n\n` +
    `${backgroundDesc}\n\n` +
    (hasPrebuiltAlt
      ? `${productLabel} REFERENCE (${productSlot}): Photos of the exact ${productLabel.toLowerCase()} to place. ` +
        `The first two are standard product photos. ` +
        `The last ${numAltViews} image${numAltViews > 1 ? "s show" : " shows"} this exact furniture from a steep downward angle (~75°, nearly overhead) — ` +
        `use ${numAltViews > 1 ? "these" : "it"} as the primary perspective reference when compositing from the room's camera angle.\n`
      : `${productLabel} REFERENCE (${productSlot}): Photos of the exact ${productLabel.toLowerCase()} to place in the room.\n`) +
    (productDescription ? `Product details: ${productDescription}\n` : ``) +
    `PRODUCT FIDELITY: The ${productLabel.toLowerCase()} must look identical to the REFERENCE — same shape, colour, material, texture, surface finish, and proportions. Do not redesign or substitute it.\n` +
    `Do NOT carry over any background from the reference images.\n\n` +
    `FRAMING MASTER (${framingSlot}): The same room from the same camera angle — used as a pixel-level framing template only. Your output must reproduce the framing of this image exactly: ceiling line, wall edges, artworks, windows, and floor boundaries must appear at the identical positions. Ignore any furniture visible in this image.\n\n` +
    `Compositing steps:\n` +
    `0. This is a precise technical overlay, not a creative photography task. Do not recompose, crop, zoom, pan, or rotate the scene. Treat the image grid as locked pixels.\n` +
    `1. Compare BACKGROUND with FRAMING MASTER — they show the same room. Use FRAMING MASTER as your ruler: every structural element (ceiling, walls, artworks, floor edges) must be at the same position in your output. Do not zoom in.\n` +
    `2. Place the ${productLabel.toLowerCase()} on the floor at a natural position.${dimNote}${roomNote} Render it from the room's exact camera viewpoint — NOT from the product-photo's angle.${perspNote} Do not displace or remove any existing furniture to fit the new product — work around what is already there.\n` +
    `3. Size it to real-world scale — this is critical. A life-sized ${productLabel.toLowerCase()} is a substantial object.${scaleNote} If it is so large that its edges are cropped, that is correct — never shrink it to fit the frame.\n` +
    `4. The furniture must rest firmly on the floor — no floating. Add soft contact shadows where each leg or base touches the floor (a small dark penumbra at each contact point anchors it to the surface).\n` +
    `5. Lighting — study the room carefully before rendering:\n` +
    `   a. Identify every light source: windows (and which wall they're on), ceiling lights, floor lamps. Note which side of objects the shadows fall toward.\n` +
    `   b. Apply that exact lighting to the placed object — direction, colour temperature (warm incandescent / cool daylight), and intensity. The reference photo uses neutral studio lighting — completely discard it.\n` +
    `   c. If the room has backlighting (window behind the subject), the back edges of the furniture get a bright rim; the front face is in relative shadow with warm ambient fill from the floor.\n` +
    `   d. Material response from the REFERENCE must be preserved: leather and vinyl show sharp specular highlights from the dominant light; fabric and bouclé are diffuse with no strong highlights; wood shows grain texture and a soft sheen.\n` +
    `   e. The shadow cast on the floor must be directional — matching the angle and softness of other floor shadows in the scene, not a simple round blob.\n` +
    `6. Blend edges naturally — no hard cuts, bright halos, or visible compositing seams.\n\n` +
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
