// All image generation runs on OpenAI gpt-image-2 (server proxy /api/openai-image). Gemini was
// fully removed — no client-exposed key, no Google dependency.


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

/** Calls the OpenAI image-edit proxy (gpt-image-2). Returns a data URL. */
type ImageQuality = "low" | "medium" | "high";

async function callOpenAIImage(promptText: string, images: string[], size: string, quality: ImageQuality): Promise<string> {
  const res = await fetch("/api/openai-image", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ prompt: promptText, images, size, quality }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`OpenAI image failed (${res.status}): ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  if (!data?.image) throw new Error("OpenAI image: empty response");
  return data.image as string;
}

/**
 * Single-image edit: one prompt + ordered images (room first, then product references).
 * Default quality "low" ≈ 27s (the fast preview); "high" is the on-demand HD render.
 */
async function generateImage(promptText: string, images: string[], size: string, quality: ImageQuality = "low"): Promise<string> {
  return callOpenAIImage(promptText, images, size, quality);
}

/**
 * DEPRECATED / inert. The 75° "top view" alt-view generation ran on Gemini and its output
 * (image_2/image_3) is no longer used at placement time. Kept as a stub so the admin UI still
 * compiles; the "AI top views" section in ProductForm is now inert. TODO: remove that UI.
 */
export async function generateProductAltView(
  _productImgs: string[], _furnitureType: string, _variant: "perspective" | "front" = "perspective",
): Promise<string> {
  throw new Error("alt-view generation removed");
}

export type RefineMode = "straighten" | "floor" | "hd";

/**
 * Result-image passes for the "Fix" buttons and the HD render. Operates on the RESULT image
 * alone (no original room), so it can never reintroduce the old furniture.
 *  - straighten/floor: targeted correction at "low" quality (fast, matches the preview).
 *  - hd: re-render the whole thing at "medium" quality for a crisp, downloadable version.
 */
export async function refinePlacement(
  resultImage: string, category: string | null | undefined, mode: RefineMode,
): Promise<string> {
  const img = await loadImage(resultImage);
  const w = img.width, h = img.height;
  const resized = await resizeImage(resultImage, 2048, 2048, 0.92);
  const label = (category ?? "furniture").toLowerCase();

  const prompt = mode === "straighten"
    ? `The ${label} in this photo is CROOKED — it is angled/rotated relative to the wall behind it. ` +
      `Rotate the ${label} so it sits STRAIGHT: its back flush and PARALLEL to the wall directly behind it, squared to the room and aligned with the floor and wall lines, its front facing straight out into the room. ` +
      `This is the ONLY change — keep the ${label}'s exact appearance, colour, size and floor position, and keep the room, camera angle, framing, lighting and every other object identical. Output only the corrected photo.`
    : mode === "floor"
    ? `The floor in this photo is inconsistent — the wood planks / tiles do not all run in the same direction, or there is a visible seam where furniture was changed. ` +
      `Re-render ONLY the floor so every plank/tile runs in ONE straight, consistent direction that matches the room's perspective, with no mismatched seams or patches. ` +
      `Keep the ${label}, the walls, and every other object exactly the same — change nothing but the floor. Output only the corrected photo.`
    : `Re-render this exact photo at maximum detail, resolution and photorealism. Keep the composition, colours, every object, the ${label}, the camera angle and framing 100% identical — do NOT move, add, remove, recolour or restyle anything. Make the ${label} read as a REAL photograph, not a 3D/CGI render: bring out true material texture and micro-detail (stone veining, metal, wood grain, fabric weave), natural reflections and highlights, and match the photographic grain and lighting of the rest of the room. Output only the enhanced photo.`;

  const quality: ImageQuality = mode === "hd" ? "medium" : "low";
  const raw = await generateImage(prompt, [resized], "auto", quality);
  return cropToRatio(raw, w, h);
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

  // Build one edit prompt + reference images (product photo + swatches/textures) for gpt-image-2.
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

  const prompt =
    `You are editing image 1, a product photo of a ${furnitureType}, for a furniture retailer. ` +
    `Apply the customer's colour/texture selections exactly.\n` +
    (refImages.length ? `Images 2–${1 + refImages.length} are colour swatches or texture samples for the changes below.\n` : "") +
    `\nSelections (apply ALL — none optional):\n${changeLines.join("\n")}\n\n` +
    `Requirements:\n` +
    `- Every listed part MUST change; leave none in the original colour. When a part means the whole piece (e.g. "whole sofa"), recolour EVERY visible surface — body, seat and back cushions, armrests, side panels, loose pieces.\n` +
    `- Recolour ONLY the listed part${many ? "s" : ""}; all other surfaces stay exactly as in image 1.\n` +
    `- Match the swatch hue and lightness exactly; fully replace the old colour (no ghosting), applied like a painted/lacquered finish — a brand-new hue, but the underlying grain, surface relief and original shading stay visible.\n` +
    `- Keep the original lighting, exposure, proportions, camera angle, framing and white background. Output only the edited product photo.`;

  // Only slots 0 and 1 are used by the app (revolver thumbnail + placement use the first two
  // images). Generate them via gpt-image-2; the old 75° overhead slots (2/3) are no longer made.
  const results: (string | null)[] = [null, null, null, null];
  for (const i of [0, 1]) {
    const img = dataUrls[i];
    if (!img) { onSlotReady?.(i, null); continue; }
    try {
      const prepared = await prepareProductImage(img, 1024, 1024, 0.92);
      results[i] = await generateImage(prompt, [prepared, ...refImages], "auto").catch((err) => {
        console.error(`generateVariant: slot ${i} failed:`, err instanceof Error ? err.message : err);
        return null;
      });
      onSlotReady?.(i, results[i]);
    } catch (err) {
      console.error(`generateVariant: slot ${i} unexpected error:`, err instanceof Error ? err.message : err);
      onSlotReady?.(i, null);
    }
  }
  // Settle the unused slots so callers tracking completion don't wait forever.
  onSlotReady?.(2, null);
  onSlotReady?.(3, null);

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
    return fetch("/api/claude-text", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
  };

  let textRes = await callTextModel();

  // Retry once after 2s on overload / rate-limit
  if (textRes.status === 503 || textRes.status === 429) {
    await new Promise((r) => setTimeout(r, 2000));
    textRes = await callTextModel();
  }

  if (!textRes.ok) {
    throw new Error(`Extraction ${textRes.status}: ${await textRes.text()}`);
  }

  const textData = await textRes.json();
  const rawText  = textData?.text ?? "{}";
  const json     = JSON.parse(rawText);

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

  // ── Room measurement (scale) + product prep, in parallel ─────────────────────
  const isSofa = eraseLabel === "sofa";

  const [measurement, productResized] = await Promise.all([
    measureRoom(roomResized),
    (async () => {
      const urls = productImages.length > 0
        ? await Promise.all(productImages.slice(0, 2).map(toDataUrl))
        : [];
      return Promise.all(urls.map((img) => prepareProductImage(img, 1024, 1024, 0.92)));
    })(),
  ]);

  const scaleNote = buildScaleNote(measurement, dimensions, category ?? eraseLabel);
  console.log(`[Furora] scale: refs=${JSON.stringify(measurement?.visible_refs ?? null)} ·${scaleNote || " (none)"}`);

  const persp = productResized[0] ?? null;
  const front = productResized[1] ?? null;

  // ── SINGLE COMBINED EDIT — swap the furniture in the ORIGINAL room, keep the camera.
  // One prompt + ordered images (room first, then product references). Routed to the active
  // image provider (gpt-image-1 by default — it preserves the room's camera as a true editor).
  const sectionalClause = isSofa
    ? ` This includes any L-shaped, corner, chaise or sectional section, anything draped over it (blankets, throws, pillows), and any part looming in the foreground or cut off by the frame edge — remove ALL of it.`
    : "";
  const refCount = (persp ? 1 : 0) + (front ? 1 : 0);

  const promptText =
    `You are editing the FIRST image, a photo of a real room.` +
    (refCount ? ` The other ${refCount === 1 ? "image is a reference photo" : "images are reference photos"} of a ${productLabel} to place into that room.` : ``) + `\n\n` +
    `Replace the existing ${eraseLabel} in the room with the ${productLabel}. Erase the old ${eraseLabel} completely${sectionalClause} and place the ${productLabel} in the same spot — against the same wall, centered on the footprint the old ${eraseLabel} occupied. ORIENTATION: rotate it to match the old ${eraseLabel} exactly — its back flush and parallel to the wall behind it, squared to the room so it runs parallel to that wall and perpendicular to the side walls, aligned with the floorboards and the floor/wall lines. Do NOT angle or twist it out into the room.` +
    (productDescription ? ` (${productDescription})` : ``) +
    (refCount ? ` Use the reference photo(s) ONLY for the ${productLabel}'s appearance — its material, colour, shape and proportions; ignore their background, lighting and camera angle.` : ``) + `\n\n` +
    `CRITICAL: keep the original room photo EXACTLY as it is otherwise — the SAME camera angle, perspective and framing, the SAME flooring (identical wood-plank/tile DIRECTION, pattern and joints — do not rotate, re-lay or re-render the floor; where you remove the old ${eraseLabel}, fill with floor that continues the existing planks in the same direction), and every other object (walls, window, curtains, artwork, rug, tables, lamps, lighting and shadows). Keep ${otherTypes} untouched. The output must look like the same photograph, pixel-perfect, with only the ${eraseLabel} swapped. Do NOT re-render, straighten, zoom or reframe.\n\n` +
    `Place exactly ONE ${productLabel} with the same shape and configuration as the reference. STRUCTURE: assemble it correctly with its parts properly stacked and aligned exactly as in the reference — a top or surface must sit CENTERED, level and symmetric directly over its base, pedestal or legs (never shifted, tilted or offset to one side, never floating). Do not duplicate, extend, or reshape it into a larger/L-shaped/sectional arrangement even if the old ${eraseLabel} was bigger. If it is smaller than the old furniture, leave the extra as empty floor. Ground it flat on the floor with a soft contact shadow, matching the room's lighting.${dimNote}${scaleNote}\n\n` +
    `PHOTOREALISM: the ${productLabel} must look like a REAL photograph taken in this room, not a 3D/CGI render or a flat cut-out. Reproduce true physical materials — real surface texture, grain and micro-detail (e.g. stone veining, brushed/glossy metal, wood grain, fabric weave), with natural reflections, highlights and soft shadows cast by the room's own light. Match the photographic sharpness, grain and colour temperature of the surrounding room so it blends seamlessly.`;

  const images = [roomResized, ...(persp ? [persp] : []), ...(front ? [front] : [])];
  // "auto" makes gpt-image-2 match the INPUT aspect ratio (verified) — forcing a discrete size
  // (e.g. 3:2) cropped/reframed non-matching inputs like 16:9. cropToRatio then trims to exact.
  const size = "auto";

  // Single call, with one retry if it no-ops (returns the room ~unchanged).
  let raw = await generateImage(promptText, images, size);
  try {
    const diff = await imageMeanDiff(raw, roomResized);
    console.log(`[Furora] combined(gpt-image-2): diff vs room = ${diff.toFixed(1)}`);
    if (diff < 8) {
      console.warn(`[Furora] combined looks like a no-op — retrying once`);
      raw = await generateImage(promptText, images, size);
    }
  } catch { /* diff is best-effort */ }

  return cropToRatio(raw, origW, origH);
}
