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
 * Calls /api/claude-verify to check a placement result for fusion (the old furniture
 * left in alongside the new one) — something pixel-diff cannot detect. Returns null on
 * any failure, which the caller treats as "clean" so a verifier outage never blocks output.
 */
async function verifyPlacement(
  resultDataUrl:   string,
  originalDataUrl: string,
  targetLabel:     string,
): Promise<{ old_present: boolean; new_present: boolean } | null> {
  try {
    const res = await fetch("/api/claude-verify", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ resultDataUrl, originalDataUrl, targetLabel }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || typeof data.old_present !== "boolean") return null;
    return data;
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
 * Builds a scale hint with MULTIPLE concrete anchors Gemini can verify against objects
 * it can actually see in the room. Two anchors matter:
 *  - FOOTPRINT (longest horizontal side vs the visible floor width) — the dominant size
 *    cue for tables, beds, sofas and rugs, which Gemini otherwise renders too small.
 *  - HEIGHT (vs the visible room object closest in height, falling back to a 200cm door).
 * Anchoring footprint is what fixes "the table looks smaller than its real dimensions":
 * height alone never constrains how much floor the piece covers.
 */
function buildScaleNote(m: RoomMeasurement | null, dims?: ProductDimensions): string {
  if (!dims) return "";
  const height    = dims.height_cm ?? null;
  const footprint = Math.max(dims.length_cm ?? 0, dims.width_cm ?? 0) || null;

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
    // A flat rug/carpet is a poor footprint yardstick — the product sits ON it, so Gemini
    // reads it as floor rather than a discrete object to compare against. Prefer a real 3D
    // object that has a height (the sofa); only fall back to a flat ref if nothing else.
    const solidRefs = widthRefs.filter((r) => typeof r.height_cm === "number" && r.height_cm > 0);
    const pool      = solidRefs.length ? solidRefs : widthRefs;
    const anchorObj = pool.length
      ? pool.reduce((a, b) => (b.width_cm > a.width_cm ? b : a))  // widest among preferred pool
      : null;
    const floorW = (m && m.confidence !== "low") ? m.floor_width_cm : null;
    if (anchorObj) {
      const pct = Math.round((footprint / anchorObj.width_cm) * 100);
      anchors.push(
        `its longest side measures ${footprint}cm — about ${pct}% as wide as the ${anchorObj.name} ` +
        `visible in the room (~${anchorObj.width_cm}cm wide); use that object as your size yardstick`,
      );
    } else if (floorW) {
      const pct = Math.round((footprint / floorW) * 100);
      anchors.push(
        `its longest side measures ${footprint}cm — about ${pct}% of the visible floor width ` +
        `(~${floorW}cm across the room), so it should cover that much of the floor`,
      );
    } else {
      anchors.push(`its longest side measures ${footprint}cm across`);
    }
  }

  // Height anchor — compared to a real object already visible in the room.
  if (height) {
    const refs = (m?.visible_refs ?? []).filter(
      (r): r is { name: string; height_cm: number; width_cm?: number | null } =>
        typeof r.height_cm === "number" && r.height_cm > 0,
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
  const isSofa = eraseLabel === "sofa";
  const erasePrompt =
    `You are a photo editor. You will receive one image.\n\n` +
    `CANVAS: A real photograph of a room.\n\n` +
    `Task: Look for a ${eraseLabel} in this room. ` +
    `If one is present, erase ALL of it and fill the area naturally with the surrounding floor and wall.\n\n` +
    (isSofa
      ? `WHAT COUNTS AS THE SOFA — erase the whole thing:\n` +
        `- The main seating body.\n` +
        `- If it is a corner or sectional sofa, EVERY connected upholstered seating section — the chaise lounge and corner module that form the L or U shape — even if a section is a different colour, in shadow, or covered by a blanket. The entire sofa goes, leaving no seating section behind.\n` +
        `- Any blanket, throw, or pillow lying on the sofa is erased together with it. A section covered by a blanket is still part of the sofa — do NOT mistake it for a separate pile or a different object and leave it.\n\n` +
        `STRICT RULES:\n` +
        `- Erase the COMPLETE sofa — all connected sections plus anything draped on it. Leaving one section (e.g. a blanket-covered corner) still in the room is a FAILURE.\n` +
        `- Do NOT touch or remove any of these — leave them EXACTLY as-is: ${otherTypes}, rugs, plants, curtains, lamps, artwork, decorations. A coffee table or side table sitting next to, in front of, or even partly overlapping the sofa is NOT part of it — keep it fully intact. Only upholstered seating is part of the sofa; hard furniture like tables is never part of it.\n` +
        `- If you cannot find a sofa in the room, return the photo pixel-for-pixel unchanged. Do not erase anything.\n` +
        `- Do not "clear the area" or remove nearby items to make space — erase only the sofa and what is draped on it.\n\n`
      : `STRICT RULES:\n` +
        `- Erase ONLY items that are clearly a ${eraseLabel}. Do not erase any other furniture type.\n` +
        `- Do NOT touch or remove any of these — they must stay exactly as-is: ${otherTypes}, rugs, plants, curtains, lamps, artwork, decorations, or any other object.\n` +
        `- If you cannot find a ${eraseLabel} in the room, return the photo pixel-for-pixel unchanged. Do not erase anything.\n` +
        `- Do not "clear the area" or remove things to make space — only erase an actual ${eraseLabel} if you can see one.\n\n`) +
    `IMPORTANT: Output the photo at the EXACT SAME framing and zoom level as the input. Do not zoom in, zoom out, pan, or recompose in any way.\n\n` +
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

  console.log(`[Furora] BUILD v3 · erase-decision: targetPresent=${targetPresent}, eraseCall=${eraseResult.status}, detected=${JSON.stringify(measurement?.detected_furniture ?? null)}`);

  // ── Erase, with retry on failure AND on weak/no-op result ────────────────────
  // Three ways the erase leaves old furniture behind → place step fuses:
  //   1. the erase Gemini call REJECTS (returns text not an image / times out),
  //   2. it no-ops (returns the room unchanged),
  //   3. it partially erases (e.g. one section of a sectional).
  // All three are handled the same way: keep calling the erase until we get an image
  // that substantially changes the room. We seed from the erase that already ran in
  // parallel with claude-measure, then retry as needed.
  // Empirically: a full sofa removal scores ~20+ mean diff vs the original; a weak
  // partial erase scores ~11. Threshold sits between them.
  // Empirically: a small sofa cleared in one shot scores ~14–20 mean diff vs the original;
  // a large sectional fully cleared scores ~28+; a weak partial that left most of it scores ~11–18.
  const ERASE_MIN_DIFF     = 14;   // pass-1 one-shot clear bar (simple, single-piece rooms)
  const ERASE_GOOD_DIFF    = 28;   // diff at which a big sectional is convincingly cleared
  const ERASE_PLATEAU_GAIN = 8;    // once past GOOD_DIFF, a pass adding < this means the bulk is gone
  const ERASE_STALL_GAIN   = 3;    // a pass adding < this means the model converged → noop, stop
  const MAX_ERASE_ATTEMPTS = 4;

  let canvasDataUrl   = roomResized;
  let eraseWasApplied = false;

  if (targetPresent) {
    let candidate: string | null = eraseResult.status === "fulfilled"
      ? await cropToRatio(eraseResult.value, origW, origH)
      : null;

    let best: string | null = null;   // most-erased image so far (highest diff vs original)
    let bestDiff = 0;
    let prevDiff = 0;                  // diff from the previous pass, to measure per-pass progress

    for (let attempt = 1; attempt <= MAX_ERASE_ATTEMPTS; attempt++) {
      if (candidate) {
        const diff = await imageMeanDiff(candidate, roomResized);
        const gain = diff - prevDiff;
        console.log(`[Furora] erase attempt ${attempt}: diff vs original = ${diff.toFixed(1)} (need ≥ ${ERASE_MIN_DIFF}, gain ${gain.toFixed(1)})`);
        if (diff > bestDiff) { best = candidate; bestDiff = diff; }

        // Decide whether to stop. Crucially, a small gain does NOT mean "done" while the
        // absolute diff is still low — that's a weak pass with lots of furniture remaining,
        // so we must keep climbing. Only stop when the room is convincingly cleared, or the
        // model has genuinely converged (a pass changed almost nothing → further passes are noops).
        const oneShot = attempt === 1 && diff >= ERASE_MIN_DIFF;                    // simple room cleared in one pass
        const cleared = diff >= ERASE_GOOD_DIFF && gain < ERASE_PLATEAU_GAIN;        // bulk of a sectional removed + plateaued
        const stalled = attempt > 1 && gain < ERASE_STALL_GAIN;                      // model won't remove any more this run
        if (oneShot || cleared || stalled) break;

        prevDiff = diff;
      } else {
        console.warn(`[Furora] erase attempt ${attempt}: call returned no image`);
      }
      if (attempt >= MAX_ERASE_ATTEMPTS) break;
      // PROGRESSIVE: feed the current partial erase back in so each pass removes more of
      // a large sectional (re-erasing the original just repeats the same partial result).
      // Fall back to the original room if we don't have a candidate yet.
      const src = candidate ?? roomResized;
      console.warn(`[Furora] erase still climbing — running progressive pass ${attempt + 1}/${MAX_ERASE_ATTEMPTS}`);
      try {
        candidate = await cropToRatio(
          await callGemini([{ text: erasePrompt }, { inlineData: { mimeType: "image/jpeg", data: stripPrefix(src) } }]),
          origW, origH,
        );
      } catch (e) { console.warn(`[Furora] erase pass failed:`, e instanceof Error ? e.message : e); /* keep previous candidate */ }
    }

    // Always composite onto the most-erased image we produced across all passes.
    if (best) { canvasDataUrl = best; eraseWasApplied = true; }
  }

  const roomNote  = buildRoomNote(measurement);
  const perspNote = buildPerspectiveNote(measurement);
  const scaleNote = buildScaleNote(measurement, dimensions);
  console.log(`[Furora] scale: refs=${JSON.stringify(measurement?.visible_refs ?? null)} ·${scaleNote || " (none)"}`);

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
    `FRAMING MASTER (${framingSlot}): The room with the old ${eraseLabel} ALREADY REMOVED — there is an empty floor area where it used to be. This image still shows every OTHER object that must stay (coffee tables, side tables, chairs, lamps, plants, rugs, decor). Use it as (a) a pixel-level framing template — ceiling line, wall edges, artworks, windows and floor boundaries at the identical positions; and (b) the truth for what furniture remains. There is NO old ${eraseLabel} in this image and there must be none in your output — you will add the NEW ${productLabel.toLowerCase()} in that empty area instead.\n\n` +
    `PRIMARY GOAL — DO NOT SKIP: Your output MUST show the new ${productLabel.toLowerCase()} standing in the room. Returning the room with the empty floor area still empty (no ${productLabel.toLowerCase()} added) is a FAILURE. The single most important thing is that the new ${productLabel.toLowerCase()} is clearly, visibly present.\n\n` +
    `SIZE — JUST AS IMPORTANT AS PLACEMENT:${scaleNote || ` Render the ${productLabel.toLowerCase()} at full, real-world size — furniture of this kind is very often rendered too small. Err larger rather than smaller; never shrink it to fit the frame.`}\n` +
    `CRITICAL: the new ${productLabel.toLowerCase()} may be LARGER than whatever was previously in that spot. Size it to its OWN real measurements above — NEVER to the size of the cleared gap or the object that was removed. It is expected to extend beyond that gap.\n` +
    `Before finishing, sanity-check the size against the yardstick object above: if the ${productLabel.toLowerCase()} looks small or dainty next to it, it is WRONG — make it bigger.\n\n` +
    `Compositing steps:\n` +
    `0. This is a precise technical overlay, not a creative photography task. Do not recompose, crop, zoom, pan, or rotate the scene. Treat the image grid as locked pixels.\n` +
    `1. Add the new ${productLabel.toLowerCase()} on the floor in the same part of the room where the old ${eraseLabel} used to be — but at its OWN real-world size (it may be larger than what was removed and may extend beyond that spot). Do not shrink it to match the cleared footprint.${dimNote}${roomNote} Render it from the room's exact camera viewpoint — NOT from the product-photo's angle.${perspNote} It must be clearly, prominently visible.\n` +
    `2. Keep the framing identical to the FRAMING MASTER: ceiling, walls, artworks, windows and floor boundaries at the same positions. Do not zoom or recompose.\n` +
    `2b. Preserve every OTHER object exactly as it appears in the FRAMING MASTER — coffee tables, side tables, chairs, lamps, plants, rugs, decor. Never delete or move any of them. The ONLY change to the room is adding the new ${productLabel.toLowerCase()}.\n` +
    `3. Size it to real-world scale (per SIZE above) — this is critical. A life-sized ${productLabel.toLowerCase()} is a substantial object. If it is so large that its edges are cropped, that is correct — never shrink it to fit the frame.\n` +
    `4. The furniture must rest firmly on the floor — no floating. Add soft contact shadows where each leg or base touches the floor (a small dark penumbra at each contact point anchors it to the surface).\n` +
    `5. Lighting — study the room carefully before rendering:\n` +
    `   a. Identify every light source: windows (and which wall they're on), ceiling lights, floor lamps. Note which side of objects the shadows fall toward.\n` +
    `   b. Apply that exact lighting to the placed object — direction, colour temperature (warm incandescent / cool daylight), and intensity. The reference photo uses neutral studio lighting — completely discard it.\n` +
    `   c. If the room has backlighting (window behind the subject), the back edges of the furniture get a bright rim; the front face is in relative shadow with warm ambient fill from the floor.\n` +
    `   d. Material response from the REFERENCE must be preserved: leather and vinyl show sharp specular highlights from the dominant light; fabric and bouclé are diffuse with no strong highlights; wood shows grain texture and a soft sheen.\n` +
    `   e. The shadow cast on the floor must be directional — matching the angle and softness of other floor shadows in the scene, not a simple round blob.\n` +
    `6. Blend edges naturally — no hard cuts, bright halos, or visible compositing seams.\n\n` +
    `Output only the composited image. No text.`;

  // FRAMING MASTER = the ERASED canvas (not the original room) when an erase ran, so
  // the old furniture is absent from EVERY input to the place step. This prevents the
  // two dominant failures: fusion (new product blended with the old one) and
  // "nothing-changed" (the old furniture reproduced from the framing master). The
  // erased canvas still carries all OTHER furniture (tables etc.), so they're kept.
  const framingMaster = eraseWasApplied ? canvasDataUrl : roomResized;

  const parts: unknown[] = [
    { text: placePrompt },
    { inlineData: { mimeType: "image/jpeg", data: stripPrefix(canvasDataUrl) } },           // BACKGROUND (erased)
    ...productResized.map((img) => ({ inlineData: { mimeType: "image/jpeg", data: stripPrefix(img) } })), // PRODUCT REFERENCE
    { inlineData: { mimeType: "image/jpeg", data: stripPrefix(framingMaster) } },           // FRAMING MASTER (erased canvas)
  ];

  // ── Place call with retry-on-no-op ──────────────────────────────────────────
  // With a clean erased canvas, the place step should add the new product. If it
  // no-ops it returns the canvas essentially unchanged (no product added). Detect
  // that by comparing against the BACKGROUND it composited onto: a real placement
  // changes the product region well above the re-encode noise floor. Retry so the
  // user reliably gets a placed product without manually clicking regenerate.
  // Empirically: a clear placement scores ~12+ mean diff; a weak/ghosted placement
  // that the user reads as "failed" scores ~8-9 (e.g. a chair that didn't really
  // land). Threshold sits above those so weak placements are retried.
  const PLACE_DIFF_THRESHOLD = 10;
  const MAX_PLACE_ATTEMPTS   = 4;

  let raw = await callGemini(parts);
  let placedOk = false;
  for (let attempt = 1; attempt <= MAX_PLACE_ATTEMPTS; attempt++) {
    const diffCanvas = await imageMeanDiff(raw, canvasDataUrl);  // ≈0 → nothing placed
    const diffOrig   = eraseWasApplied ? await imageMeanDiff(raw, roomResized) : 255; // ≈0 → old furniture reproduced
    console.log(`[Furora] place attempt ${attempt}: diff vs erased-canvas = ${diffCanvas.toFixed(1)} (need ≥ ${PLACE_DIFF_THRESHOLD}), diff vs original = ${diffOrig.toFixed(1)}`);
    const placedSomething = diffCanvas >= PLACE_DIFF_THRESHOLD;
    const stillOriginal   = diffOrig < PLACE_DIFF_THRESHOLD;  // result looks like the untouched room
    if (placedSomething && !stillOriginal) { placedOk = true; break; }  // a real, new placement
    if (attempt >= MAX_PLACE_ATTEMPTS) break;
    console.warn(`[Furora] place result looks wrong (placed=${placedSomething}, stillOriginal=${stillOriginal}), retrying place (attempt ${attempt + 1}/${MAX_PLACE_ATTEMPTS})`);
    raw = await callGemini(parts);
  }

  // VERIFY with Claude vision. Pixel-diff can detect "nothing placed" and "identical to
  // original", but it is blind to FUSION — the old furniture left in alongside the new one
  // (happens when the erase silently failed but the place step still added the new product).
  // A clean result has the old target gone and the new one present. Only runs when we erased
  // a present target (no old furniture to fuse with otherwise). Null verdict → treat as clean.
  let needsSwap = !placedOk;
  if (placedOk && eraseWasApplied) {
    const verdict = await verifyPlacement(raw, roomResized, eraseLabel);
    if (verdict && verdict.old_present) {
      console.warn(`[Furora] verify: old ${eraseLabel} still present (old=${verdict.old_present}, new=${verdict.new_present}) — fusion, routing to swap fallback`);
      needsSwap = true;
    } else if (verdict) {
      console.log(`[Furora] verify: clean (old=${verdict.old_present}, new=${verdict.new_present})`);
    }
  }

  // FALLBACK — direct swap on the ORIGINAL room.
  // Triggered either by a place no-op or by a verified fusion. The usual root cause is a
  // silently-failed erase: the old furniture was never actually removed (the mean-diff
  // metric was inflated by re-encoding drift), so the place step composited the new product
  // on top of / beside the old one. A one-shot "remove the old X, put this new one in its
  // place" edit on the clean original is a different mechanism that often succeeds where the
  // cleared-canvas path stalls. Only runs on the failure path, so clean rooms are untouched.
  // Gated on eraseWasApplied so we only "swap" when there was a target present.
  if (needsSwap && eraseWasApplied) {
    console.warn(`[Furora] result needs recovery — falling back to a framing-locked swap on the original room`);
    // Faithful swap: SWAP ONLY the sofa, leave the rest of the real room pixel-identical.
    // Earlier this prompt had no framing discipline, so Gemini restaged the whole room
    // (new rug, relit, decluttered) — a regression for a "see it in YOUR room" product.
    // Now it carries the same pixel-lock language + FRAMING MASTER as the main place path.
    const swapPrompt =
      `You are a precise photo editor. In the room photo you will SWAP one piece of furniture for a different one and change NOTHING else.\n\n` +
      `BACKGROUND (first image): the room exactly as photographed. It currently contains the old ${eraseLabel}.\n\n` +
      `NEW ${productLabel} REFERENCE (${productSlot}): photos of the new ${productLabel.toLowerCase()} to put in.\n` +
      (productDescription ? `Product details: ${productDescription}\n` : ``) +
      `FRAMING MASTER (${framingSlot}): the same room again. Your output MUST match it pixel-for-pixel EVERYWHERE except the single ${eraseLabel} being swapped.\n\n` +
      `This is a precise technical edit, NOT a creative re-render. Do NOT restage, redecorate, declutter, recompose, crop, zoom, pan, rotate, or relight the room. Treat every pixel as locked except the ${eraseLabel} region.\n\n` +
      `Steps:\n` +
      `1. Remove the existing ${eraseLabel} completely — every section, including any corner, chaise or extension modules and any cushions, pillows, throws or bags resting on it.\n` +
      `2. In that exact spot put the NEW ${productLabel.toLowerCase()} from the REFERENCE — matching its shape, colour, material, texture and proportions exactly.${dimNote}${scaleNote} Render it from the room's own camera angle, resting firmly on the floor with realistic contact shadows and lighting matched to the room.${perspNote}\n` +
      `3. EVERYTHING else stays pixel-identical to the FRAMING MASTER: the same walls, floor, windows, curtains, rug, coffee table and side tables, lamps, plants, clock, wall art, the bouquet, the items on the table, and the exact same camera framing. Do not add, remove, move, restyle or relight any of them.\n` +
      `Output only the edited image. No text.`;
    const swapParts: unknown[] = [
      { text: swapPrompt },
      { inlineData: { mimeType: "image/jpeg", data: stripPrefix(roomResized) } },  // BACKGROUND = original room
      ...productResized.map((img) => ({ inlineData: { mimeType: "image/jpeg", data: stripPrefix(img) } })),
      { inlineData: { mimeType: "image/jpeg", data: stripPrefix(roomResized) } },  // FRAMING MASTER = original room
    ];
    for (let attempt = 1; attempt <= 2; attempt++) {
      const swapRaw  = await callGemini(swapParts);
      const swapDiff = await imageMeanDiff(swapRaw, roomResized);
      raw = swapRaw;  // keep the latest swap result regardless — it's the best remaining option
      if (swapDiff < PLACE_DIFF_THRESHOLD) {
        console.log(`[Furora] swap fallback attempt ${attempt}: diff vs original = ${swapDiff.toFixed(1)} — no change, retrying`);
        continue;  // swap did nothing — try once more
      }
      const v     = await verifyPlacement(swapRaw, roomResized, eraseLabel);
      const clean = !v || (!v.old_present && v.new_present);  // null verdict → accept, don't loop
      console.log(`[Furora] swap fallback attempt ${attempt}: diff vs original = ${swapDiff.toFixed(1)}${v ? `, verify(old=${v.old_present}, new=${v.new_present})` : ""}`);
      if (clean) break;  // old furniture gone and new one present → done
    }
  }

  return cropToRatio(raw, origW, origH);
}
