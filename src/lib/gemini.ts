const GEMINI_MODEL = "gemini-2.5-flash-image";

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
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
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
          "Edit this room photo: Remove every sofa, couch, sectional, and upholstered seating — including large L-shaped or corner sectionals, regardless of colour or size. Remove every cushion, back panel, armrest, and leg down to the bare floor. Fill the vacated floor and wall area with realistic textures that blend seamlessly with the surroundings — no smearing, no ghost outlines, no blank patches.\n\n" +
          "Output only the edited photo with all seating removed. No text.",
      },
      { inlineData: { mimeType: "image/jpeg", data: stripPrefix(roomResized) } },
    ];

    const emptyRoom = await callGemini(eraseParts);
    const { mimeType: emptyMime, data: emptyData } = parseDataUrl(emptyRoom);

    // ── Call 2: Place the product ─────────────────────────────────────────────
    const resized = await Promise.all(
      productImages.slice(0, 2).map((img) => resizeImage(img, 1024, 1024, 0.92))
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
        { text: "DESIGN REFERENCE — a perspective photo of the product. Study every detail: material, colour, shape, proportions, and style." },
        { inlineData: { mimeType: "image/jpeg", data: stripPrefix(resized[0]) } },
      );
    }
    if (resized[1]) {
      placeParts.push(
        { text: "SECONDARY REFERENCE — another view of the same product. Use this to understand its exact outline and depth." },
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
          "STEP 2 — PLACE: Put the product from the reference images into the cleared space. Copy the exact material, colour, shape, and style from the references. Position it naturally on the floor, centred in the main area. Match its viewing angle to the room's perspective.\n" +
          "STEP 3 — INTEGRATE: Scale it realistically to the room. Match its lighting and shadows to the room's light sources. Add a soft drop shadow beneath it.\n\n" +
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
          `1. If there is existing furniture of the same type in the photo, remove it and fill the area naturally.\n` +
          `2. Add a ${productDescription}.\n` +
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
