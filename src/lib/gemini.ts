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
    img.onload = () => {
      // Force a full decode before resolving. Without this, the FIRST time a
      // freshly-loaded image is drawn to a canvas the bitmap can still be
      // undecoded, yielding blank/partial pixel data — which made the very first
      // generation of a session silently fail (erase no-op → "nothing changed"),
      // while every later run worked because the image was decoded & cached.
      // decode() may reject for some valid images, so resolve regardless.
      if (img.decode) img.decode().then(() => resolve(img), () => resolve(img));
      else resolve(img);
    };
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

/**
 * Returns a 0–255 mean-absolute-difference between two images (downscaled to 64×64).
 * Used to detect a placement "no-op" — when Gemini returns the room essentially
 * unchanged (old furniture still in place, no swap). A genuine swap changes the
 * furniture region enough to push this well above the no-op noise floor.
 */
async function imageMeanDiff(a: string, b: string): Promise<number> {
  try {
    const [ia, ib] = await Promise.all([loadImage(a), loadImage(b)]);
    const W = 64, H = 64;
    const ca = document.createElement("canvas"); ca.width = W; ca.height = H;
    const cb = document.createElement("canvas"); cb.width = W; cb.height = H;
    ca.getContext("2d")!.drawImage(ia, 0, 0, W, H);
    cb.getContext("2d")!.drawImage(ib, 0, 0, W, H);
    const da = ca.getContext("2d")!.getImageData(0, 0, W, H).data;
    const db = cb.getContext("2d")!.getImageData(0, 0, W, H).data;
    let sum = 0;
    for (let i = 0; i < da.length; i += 4) {
      sum += Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
    }
    return sum / (W * H * 3);
  } catch {
    return 255; // on error, assume "different" so we never block a result
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
  visible_refs:       Array<{ name: string; height_cm: number | null; width_cm?: number | null }>;  // visible furniture with estimated height + width (width = footprint yardstick)
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
 * Estimates a typical footprint (longest horizontal side, cm) from the product category and
 * height, used as a FALLBACK when the merchant left length/width blank. Without this, a
 * product with only a height would get no footprint anchor at all and render far too small.
 * Returns null for categories with no reliable typical size.
 */
function estimateFootprintCm(category: string | null | undefined, heightCm: number | null): number | null {
  const c = (category ?? "").toLowerCase();
  const h = heightCm ?? 0;
  if (c.includes("table"))                          return h >= 65 ? 150 : 110;  // dining/console vs coffee/side
  if (c.includes("sofa") || c.includes("couch"))    return 200;                  // ~3-seat default
  if (c.includes("bed"))                            return 150;                  // double mattress width
  if (c.includes("wardrobe") || c.includes("cabinet")) return 100;
  if (c.includes("shelv") || c.includes("bookcase"))   return 90;
  if (c.includes("desk"))                           return 130;
  if (c.includes("chair"))                          return 65;
  return null;  // unknown category → no reliable estimate, skip the footprint anchor
}

/**
 * True when a measured room object (`refName`) is the SAME furniture type currently being
 * replaced (`category`). Such objects get ERASED before placement, so they must NOT be used
 * as a "still visible in the room" yardstick — the classic phantom-anchor bug where the note
 * says "80% as wide as the sofa in the room" but that sofa was just erased.
 */
function matchesReplacedType(refName: string, category?: string | null): boolean {
  const n = refName.toLowerCase();
  const c = (category ?? "").toLowerCase().trim();
  if (!c) return false;
  const groups: string[][] = [
    ["sofa", "couch", "sectional", "settee", "loveseat", "chaise"],
    ["table", "desk"],
    ["bed"],
    ["chair", "armchair"],
    ["wardrobe", "cabinet", "dresser", "sideboard"],
    ["shelv", "bookcase", "bookshelf"],
  ];
  for (const g of groups) {
    if (g.some((w) => c.includes(w))) return g.some((w) => n.includes(w));
  }
  const base = c.split(/\s+/)[0];
  return base.length > 2 && n.includes(base);
}

/**
 * Builds a scale hint with MULTIPLE concrete anchors Gemini can verify against objects
 * it can actually see in the room. Two anchors matter:
 *  - FOOTPRINT (longest horizontal side vs a visible object's width) — the dominant size
 *    cue for tables, beds, sofas and rugs, which Gemini otherwise renders too small. When
 *    length/width are missing it falls back to a category-typical estimate.
 *  - HEIGHT (vs the visible room object closest in height, falling back to a 200cm door).
 * Anchoring footprint is what fixes "the table looks smaller than its real dimensions":
 * height alone never constrains how much floor the piece covers.
 */
function buildScaleNote(m: RoomMeasurement | null, dims?: ProductDimensions, category?: string | null): string {
  if (!dims) return "";
  const height = dims.height_cm ?? null;

  // Real footprint from entered dims; fall back to a category-typical estimate if blank.
  let footprint = Math.max(dims.length_cm ?? 0, dims.width_cm ?? 0) || null;
  let footprintApprox = false;
  if (!footprint) {
    const est = estimateFootprintCm(category, height);
    if (est) { footprint = est; footprintApprox = true; }
  }

  const anchors: string[] = [];

  // Footprint anchor — the dominant scale cue for low/wide furniture (tables, beds, sofas).
  // Prefer a specific visible object (above all the sofa) as the yardstick: anchoring to a
  // real, known-width object in frame is far more reliable than an abstract floor-width
  // estimate. Confirmed in testing — scale is most accurate when a full sofa is visible to
  // compare against; the floor-width fallback is noisier from cluttered head-on angles.
  if (footprint) {
    const widthRefs = (m?.visible_refs ?? []).filter(
      (r): r is { name: string; height_cm: number | null; width_cm: number } =>
        typeof r.width_cm === "number" && r.width_cm > 0,
    );
    // CRITICAL: split refs into objects that SURVIVE into the empty room vs the piece being
    // replaced (which is erased). Anchoring to an erased object is the phantom-anchor bug —
    // Gemini can't measure against something no longer in the picture.
    const persistentWide = widthRefs.filter((r) => !matchesReplacedType(r.name, category));
    const replacedWide   = widthRefs.filter((r) =>  matchesReplacedType(r.name, category));
    // A flat rug/carpet is a poor footprint yardstick — the product sits ON it, so Gemini
    // reads it as floor rather than a discrete object to compare against. Prefer a real 3D
    // object that has a height; only fall back to a flat ref if nothing else.
    const solidRefs = persistentWide.filter((r) => typeof r.height_cm === "number" && r.height_cm > 0);
    const pool      = solidRefs.length ? solidRefs : persistentWide;
    const anchorObj = pool.length
      ? pool.reduce((a, b) => (b.width_cm > a.width_cm ? b : a))  // widest object that stays visible
      : null;
    // The object being replaced: no longer visible, but its footprint is the most RELEVANT
    // scale cue in a swap — the new piece goes exactly where it was.
    const replacedObj = replacedWide.length
      ? replacedWide.reduce((a, b) => (b.width_cm > a.width_cm ? b : a))
      : null;
    const floorW = (m && m.confidence !== "low") ? m.floor_width_cm : null;
    // When the footprint is an estimate (dims left blank), phrase it as typical, not exact.
    const sizePhrase = footprintApprox
      ? `a ${(category ?? "piece").toLowerCase()} like this is typically about ${footprint}cm across`
      : `its longest side measures ${footprint}cm`;
    if (anchorObj) {
      const pct = Math.round((footprint / anchorObj.width_cm) * 100);
      anchors.push(
        `${sizePhrase} — about ${pct}% as wide as the ${anchorObj.name} ` +
        `still visible in the room (~${anchorObj.width_cm}cm wide); use that object as your size yardstick`,
      );
    } else if (replacedObj) {
      const pct = Math.round((footprint / replacedObj.width_cm) * 100);
      anchors.push(
        `${sizePhrase}. The ${replacedObj.name} that previously stood in this exact spot was ` +
        `about ${replacedObj.width_cm}cm wide — size the new piece to roughly ${pct}% of that width, ` +
        `covering the same proportion of the cleared floor area`,
      );
    } else if (floorW) {
      const pct = Math.round((footprint / floorW) * 100);
      anchors.push(
        `${sizePhrase} — about ${pct}% of the visible floor width ` +
        `(~${floorW}cm across the room), so it should cover that much of the floor`,
      );
    } else {
      anchors.push(`${sizePhrase}`);
    }
  }

  // Height anchor — compared to a real object that REMAINS visible in the room (never the
  // erased piece being replaced, which would be another phantom anchor).
  if (height) {
    const refs = (m?.visible_refs ?? []).filter(
      (r): r is { name: string; height_cm: number; width_cm?: number | null } =>
        typeof r.height_cm === "number" && r.height_cm > 0 && !matchesReplacedType(r.name, category),
    );
    if (refs.length) {
      const best = refs.reduce((a, b) =>
        Math.abs(a.height_cm - height) < Math.abs(b.height_cm - height) ? a : b,
      );
      const word = height < best.height_cm * 0.85 ? "lower than"
                 : height > best.height_cm * 1.15 ? "taller than"
                 : "about the same height as";
      anchors.push(`it stands ${height}cm tall — ${word} the ${best.name} already in the room (~${best.height_cm}cm tall)`);
    } else {
      anchors.push(`it stands ${height}cm tall — ${Math.round((height / 200) * 100)}% the height of a standard 200cm door`);
    }
  }

  if (!anchors.length) return "";
  return (
    ` Real-world scale (critical — match precisely): ${anchors.join("; ")}.` +
    ` Furniture of this kind is very often rendered too small — size it to these real measurements,` +
    ` and if anything err slightly LARGER rather than smaller. If its edges reach or exceed the frame` +
    ` at the correct size, that is correct; never shrink it to fit the view.`
  );
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

  // ── Build Gemini parts array for direct modification (slot 0 / master) ──────
  // Sends: product photo + color swatches. Gemini interprets the hex/description
  // and applies the changes directly. Works well on perspective-view product photos.
  const buildGeminiParts = (prepared: string): unknown[] => {
    const refImages: string[] = [];
    parts.forEach((_, i) => {
      const img = swatches[i] ?? textures[i];
      if (img) refImages.push(img);
    });

    let imgSlot = 2; // image 1 = product photo; image 2+ = swatches/textures
    const changeLines = parts.map((p, i) => {
      const ref  = swatches[i] ?? textures[i];
      const desc = p.modification.type === "color"
        ? (p.modification.description?.trim()
            ? `${p.modification.description.trim()} — exact hex ${p.modification.hexColor}`
            : `color ${p.modification.hexColor}`)
        : "texture from the reference image";
      const swatchNote = ref
        ? ` (image ${imgSlot} = ${swatches[i] ? "exact solid-color swatch — match this color precisely" : "texture sample — apply this material"})`
        : "";
      if (ref) imgSlot++;
      return `• ${p.targetPart}: recolor to ${desc}${swatchNote}`;
    });

    const many = parts.length > 1;
    // Framing master = same image as image 1, sent again as the last image.
    // Gemini gets a pixel-level visual ruler it cannot ignore (same technique
    // that fixed zoom/pan in room placement).
    const framingSlot = 2 + refImages.length; // image 1 + swatches + framing master

    const prompt =
      `You are generating a product photo variant for a furniture retailer. ` +
      `A customer has chosen specific colors/textures for parts of this ${furnitureType}. ` +
      `Your task: apply the customer's selections exactly as specified.\n\n` +
      `Image 1 — ${furnitureType} product photo to modify.\n` +
      (refImages.length
        ? `Images 2–${1 + refImages.length} — color swatches or texture samples for the changes below.\n`
        : "") +
      `Image ${framingSlot} — FRAMING MASTER: the identical product photo included solely as a framing reference. ` +
      `Your output must reproduce the exact pixel positions of the product — same distance from each edge, ` +
      `same left-right position, same vertical placement. Do not shift, pan, crop, or reframe. ` +
      `Ignore the colors in this image; use it only as a composition ruler.\n` +
      `\nCustomer color selections (apply ALL of these — none are optional):\n` +
      `${changeLines.join("\n")}\n\n` +
      `Requirements:\n` +
      `- Every part listed above MUST be recolored in the output. Do not leave any listed part unchanged.\n` +
      `- When the target part refers to the whole furniture or a large section (e.g. "whole sofa", "entire chair", "the sofa"), apply the change to EVERY visible surface — main body, seat cushions, back cushions/pillows, armrests, side panels, and any separate loose pieces. No part of the furniture should remain in the original color.\n` +
      `- Recolor ONLY the listed part${many ? "s" : ""}. All other surfaces stay exactly as in image 1.\n` +
      `- Color accuracy is critical: match the swatch image${refImages.length > 1 ? "s" : ""} exactly — same hue, same lightness.\n` +
      `- The new color must fully replace the original hue — no ghosting or bleed-through of the old color. Apply it like a painted or lacquered finish: the hue is completely new, but the underlying wood grain texture, surface relief, and highlight/shadow shading from the original material are preserved and visible through the new color.\n` +
      `- Keep the original lighting, exposure, and brightness exactly — do not darken, brighten, or add dramatic studio lighting. Preserve shadows, proportions, and camera angle.\n` +
      `- White background. No room context.\n` +
      `Output: ONE product photo with all customer color selections applied. No text.`;

    return [
      { text: prompt },
      { inlineData: { mimeType: "image/jpeg", data: stripPrefix(prepared) } },           // Image 1: to modify
      ...refImages.map((img) => ({ inlineData: { mimeType: "image/jpeg", data: stripPrefix(img) } })), // swatches
      { inlineData: { mimeType: "image/jpeg", data: stripPrefix(prepared) } },           // Framing master
    ];
  };

  // ── Build parts for 75° overhead angle synthesis (slots 2–3) ────────────────
  // The 75° overhead views are synthesised FROM the already-colored slot-0 result
  // rather than coloring the original overhead base images directly.
  //
  // Why: from 75° above, structural parts like legs appear as barely-visible stubs.
  // Direct color modification fails (Gemini can't find the parts) and color-match
  // copies the wrong camera angle. Angle synthesis from an already-correct image
  // avoids both problems: colors are already right in the master, we only change
  // the camera viewpoint.
  const buildAltViewFromModifiedParts = (
    masterResult: string,
    variant: "perspective" | "front",
  ): unknown[] => {
    const partNames = parts.map((p) => p.targetPart).join(", ");

    // Both variants are extreme overhead views — be very explicit so Gemini doesn't
    // produce a shallow product-photo angle that looks like the slot-0 perspective.
    const viewDesc = variant === "perspective"
      ? "a NEARLY OVERHEAD bird's-eye view from a slight 3/4 diagonal. " +
        "The camera is 75° above horizontal — almost straight down. " +
        "The seat/top surface FILLS most of the frame; the backrest appears as a narrow strip at the far edge. " +
        "The four legs are barely visible — tiny stubby projections at the bottom corners. " +
        "This is NOT a standard product photo angle. It looks like a drone shot from directly above."
      : "a NEARLY OVERHEAD bird's-eye view from directly in front. " +
        "The camera is 75° above horizontal — almost straight down. " +
        "The seat/top surface FILLS most of the frame; the front face of the backrest is a thin sliver at the bottom. " +
        "The legs appear as tiny short stubs at the bottom corners only. " +
        "This is NOT a standard product photo angle. It looks like a drone shot from above.";

    const prompt =
      `You receive a product photo of a ${furnitureType} with custom colors applied.\n` +
      `Re-render this exact same ${furnitureType} from ${viewDesc}\n\n` +
      `Critical requirements:\n` +
      `- The camera angle MUST be a steep overhead view — 75° above horizontal. Do not produce a standard low-angle product photo.\n` +
      `- Keep ALL colors and materials EXACTLY as shown in the input image — only the camera angle changes.\n` +
      `- The custom colors on ${partNames} must be preserved exactly in the output.\n` +
      `- Maintain the same material textures, surface finish, and proportions.\n` +
      `- White background. Single object only, centred. No room context.\n` +
      `Output: ONE product photo from the steep 75° overhead angle. No text.`;

    return [
      { text: prompt },
      { inlineData: { mimeType: "image/jpeg", data: stripPrefix(masterResult) } },
    ];
  };

  // ── Generate all 4 slots sequentially ───────────────────────────────────────
  // Strategy:
  //   Slots 0–1 (~28° views)  — direct modification: send base image + swatches.
  //                             These views are standard product angles where all
  //                             parts are clearly visible and direct mod works well.
  //   Slots 2–3 (75° views)   — angle synthesis from slot-0 result: take the already-
  //                             correctly-colored perspective result and ask Gemini to
  //                             re-render it from 75° overhead. Colors are already right;
  //                             we only ask Gemini to change the viewpoint, which it
  //                             handles far better than recoloring tiny overhead stubs.
  //   Fallback: if slot 0 fails, slots 2–3 fall back to direct modification.
  const results: (string | null)[] = [null, null, null, null];

  // ── Slots 0 and 1: direct modification ──────────────────────────────────────
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

  // ── Slots 2 and 3: 75° angle synthesis from slot-0 result ────────────────────
  for (const i of [2, 3]) {
    const img = dataUrls[i];
    if (!img) { onSlotReady?.(i, null); continue; }
    try {
      const masterRef = results[0];
      let geminiParts: unknown[];
      if (masterRef) {
        // Preferred path: synthesise overhead angle from already-colored slot-0 result
        const variant = i === 2 ? "perspective" : "front";
        geminiParts = buildAltViewFromModifiedParts(masterRef, variant);
      } else {
        // Fallback: slot 0 failed — try direct modification on the overhead base image
        const prepared = await prepareProductImage(img, 1024, 1024, 0.92);
        geminiParts = buildGeminiParts(prepared);
      }
      results[i] = await callGemini(geminiParts).catch((err) => {
        console.error(`generateVariant: callGemini slot ${i} failed:`, err instanceof Error ? err.message : err);
        return null;
      });
      onSlotReady?.(i, results[i]);
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
  return extractProductDataFromHtml(html, pageUrl);
}

/**
 * Parses already-fetched product-page HTML into structured product data. Shared by
 * extractProductData (after a successful scrape) and the paste-HTML fallback, where the
 * merchant supplies the page source their own browser loaded past Cloudflare protection.
 * pageUrl is used only to resolve relative image URLs against the site origin.
 */
export async function extractProductDataFromHtml(
  html: string,
  pageUrl: string,
): Promise<ExtractedProductData> {
  const origin = new URL(pageUrl).origin;

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
  "category": "<one of: table | sofa | chair | bed | wardrobe | other>",
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

  const roomResized = await resizeImage(roomPhoto, 2048, 2048, 0.92);

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
  const isSofa = eraseLabel === "sofa";
  const erasePrompt =
    `FRAMING RULE (non-negotiable): the output must have the EXACT same crop, field of view, and aspect ratio as the input. Do NOT zoom, pan, or reframe in any way.\n\n` +
    `Edit this room photo: remove every ${eraseLabel} in it, ` +
    (isSofa
      ? `INCLUDING large L-shaped, corner and sectional sofas. Remove EVERY connected upholstered seating section — the chaise lounge and corner modules that form the L or U shape — regardless of colour, shadow, or anything draped over it (blankets, throws, pillows). A blanket-covered section is still part of the sofa; do not mistake it for a separate object and leave it. CRITICAL: this also includes any section of the sofa that sits close to the camera in the FOREGROUND, or that is CUT OFF by the edge of the frame — a sofa section running off the edge of the photo, or looming large in a corner of the frame, is still part of the same sofa even though only a fragment is visible; remove that fragment completely too, do not leave it behind as if it were a different object. `
      : `including any connected sections or modules of it. `) +
    `Remove ALL of it — every cushion, back panel, armrest, base and leg — down to the bare floor. Fill the vacated floor and wall area with realistic textures that blend seamlessly with the surroundings — no smearing, no ghost outlines, no blank patches. Leaving any part of the ${eraseLabel} behind is a FAILURE.\n\n` +
    `Do NOT remove or alter any OTHER object — keep ${otherTypes}, coffee and side tables, rugs, plants, curtains, lamps, artwork and decorations exactly as they are. Do not "clear the area" to make space. If there is genuinely no ${eraseLabel} in the room, return the photo unchanged.\n\n` +
    `Output only the edited photo. No text.`;

  // Room-measurement layer (detection gating + scale/perspective notes + camera-tilt
  // warp). A diagnostic with this disabled confirmed it is NOT the cause of furniture
  // loss, and that it is in fact needed for the sofa swap to occur at all.
  const USE_CLAUDE_MEASURE = true;

  const eraseParts: unknown[] = [
    { text: erasePrompt },
    { inlineData: { mimeType: "image/jpeg", data: stripPrefix(roomResized) } },
  ];

  const [eraseResult, measureResult] = await Promise.allSettled([
    callGemini(eraseParts),
    USE_CLAUDE_MEASURE
      ? measureRoom(roomResized)
      : Promise.resolve<RoomMeasurement | null>(null),
  ]);

  const measurement = measureResult.status === "fulfilled" ? measureResult.value : null;

  // ── Product image prep: the two standard product photos as references ────────
  const productDataUrls = productImages.length > 0
    ? await Promise.all(productImages.slice(0, 2).map(toDataUrl))
    : [];
  const productResized = await Promise.all(
    productDataUrls.map((img) => prepareProductImage(img, 1024, 1024, 0.92)),
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

  console.log(`[Furora] BUILD v3 · erase-decision: targetPresent=${targetPresent}, eraseCall=${eraseResult.status}, detected=${JSON.stringify(measurement?.detected_furniture ?? null)}`);

  // Erase. The blunt erase prompt fills the vacated floor/wall, so a good pass yields a true
  // EMPTY ROOM. But erase is non-deterministic on big L-sectionals: the same room can come
  // back clean, with a straggler, or (worst case) barely touched. Prompt tuning alone can't
  // fix that — so for sofas we VERIFY and RETRY: after each erase, ask Claude whether a sofa
  // is still present; if it is, erase again. This never proceeds to placement with the old
  // sofa still there (the two-sofa fusion failure). Capped so it can't drift or run away.
  let emptyRoom = roomResized;
  if (targetPresent && eraseResult.status === "fulfilled") {
    emptyRoom = await cropToRatio(eraseResult.value, origW, origH);
    if (isSofa) {
      const MAX_EXTRA_PASSES = 2;  // up to 3 erase passes total; hard rooms only
      for (let pass = 1; pass <= MAX_EXTRA_PASSES; pass++) {
        // Check the CURRENT erased image — is a sofa still detectable?
        let stillThere = true;
        try {
          const check = await measureRoom(emptyRoom);
          // check === null → detection failed → assume still there and sweep (safe default).
          stillThere = check === null || check.detected_furniture.some((f) => {
            const t = f.toLowerCase();
            return t.includes("sofa") || t.includes("couch") || t.includes("sectional");
          });
          console.log(`[Furora] erase-verify ${pass}: sofaPresent=${stillThere}, detected=${JSON.stringify(check?.detected_furniture ?? "check-failed")}`);
        } catch { stillThere = true; }
        if (!stillThere) break;  // clean — stop early (fast path for easy rooms)
        try {
          emptyRoom = await cropToRatio(
            await callGemini([{ text: erasePrompt }, { inlineData: { mimeType: "image/jpeg", data: stripPrefix(emptyRoom) } }]),
            origW, origH,
          );
          console.log(`[Furora] erase: ran extra sweep pass ${pass}`);
        } catch (e) { console.warn(`[Furora] erase sweep ${pass} failed:`, e instanceof Error ? e.message : e); break; }
      }
    }
  }

  const scaleNote = buildScaleNote(measurement, dimensions, category ?? eraseLabel);
  console.log(`[Furora] scale: refs=${JSON.stringify(measurement?.visible_refs ?? null)} ·${scaleNote || " (none)"}`);

  // ── CALL 2: PLACE — put the product into the EMPTY ROOM ──────────────────────
  // Old proven approach: feed the clean empty room + the product photos, and ask for a
  // simple CLEAR → PLACE → INTEGRATE edit. No framing-master, no retry loop, no swap.
  const persp = productResized[0] ?? null;
  const front = productResized[1] ?? null;

  const placeParts: unknown[] = [
    { text:
      `FRAMING RULE (non-negotiable): your output MUST keep the EXACT same crop, field of view and aspect ratio as the EMPTY ROOM photo. Do NOT zoom, pan, or reframe.\n\n` +
      `You will receive reference photo(s) of a ${productLabel} and an EMPTY ROOM photo to edit.` },
  ];
  if (persp) placeParts.push(
    { text: `DESIGN REFERENCE — a photo of the exact ${productLabel.toLowerCase()} to place. Study every detail: material, colour, cushion/surface shape, armrest/leg/base design and overall proportions.` },
    { inlineData: { mimeType: "image/jpeg", data: stripPrefix(persp) } },
  );
  if (front) placeParts.push(
    { text: `SILHOUETTE REFERENCE — another photo of the same ${productLabel.toLowerCase()}. Use it to judge the exact width, height and outline.` },
    { inlineData: { mimeType: "image/jpeg", data: stripPrefix(front) } },
  );
  placeParts.push(
    { text: `EMPTY ROOM (edit this photo):` },
    { inlineData: { mimeType: "image/jpeg", data: stripPrefix(emptyRoom) } },
    { text:
      `Edit the EMPTY ROOM photo:\n` +
      `STEP 1 — CLEAR: if ANY piece of the old ${eraseLabel} is still visible — especially a section in the FOREGROUND close to the camera, or one CUT OFF by the edge of the frame — erase it completely and fill the space with realistic floor, rug and wall that match the surroundings. A fragment running off the photo edge is still part of the old ${eraseLabel}; remove all of it, leave nothing behind.\n` +
      `STEP 2 — PLACE: add the ${productLabel.toLowerCase()} from the reference photos. Copy its exact material, colour, shape and details${productDescription ? ` (${productDescription})` : ""}. Place it in the SAME spot and the SAME orientation the old ${eraseLabel} had — against the same wall, facing the same direction, with its back parallel to that wall. Align it to the room's perspective and the floor/wall lines so it sits flat and squarely grounded on the floor — not skewed, angled oddly, or floating. Its viewing angle must match the room's camera, not the product photo's angle.\n` +
      `SHAPE FIDELITY — CRITICAL: place EXACTLY ONE ${productLabel.toLowerCase()} with the SAME shape, size and configuration as the reference photos. If the reference shows a straight two-seater, the result must be a straight two-seater. Do NOT duplicate it, mirror it, extend it, add extra seats/modules, or reshape it into a larger, corner, L-shaped or sectional arrangement — even if the ${eraseLabel} that was there was bigger or L-shaped. Never "grow" the ${productLabel.toLowerCase()} to fill the space. If it is smaller than the area the old furniture occupied, that is fine — leave the remaining area as plain empty floor.\n` +
      `STEP 3 — INTEGRATE: scale it realistically to the room.${dimNote}${scaleNote} Match its lighting and shadows to the room's own light sources, and add a soft contact shadow beneath it.\n` +
      `KEEP THE ROOM AS-IS: the ${productLabel.toLowerCase()} may be SMALLER than the ${eraseLabel} that was there — any floor it does not cover stays as plain EMPTY floor. Do NOT add or invent any other furniture, plants, lamps, rugs or decor, and do NOT restage, redecorate or relight the rest of the room. Every other object stays exactly as in the EMPTY ROOM photo. This is a factual edit of THIS room, not a styled catalogue photo.\n` +
      `FRAMING RULE (repeated): same crop and framing as the EMPTY ROOM photo. No zoom, no reframe. Output only the final edited photo. No text.` },
  );

  // Place, with a single retry if the first result no-ops (returns the empty room ~unchanged).
  let raw = await callGemini(placeParts);
  try {
    const diff = await imageMeanDiff(raw, emptyRoom);
    console.log(`[Furora] place: diff vs empty room = ${diff.toFixed(1)}`);
    if (diff < 8) {
      console.warn(`[Furora] place looks like a no-op — retrying once`);
      raw = await callGemini(placeParts);
    }
  } catch { /* diff is best-effort */ }

  return cropToRatio(raw, origW, origH);
}
