import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, Pencil, Plus, Trash2, ImageIcon, X, Upload } from "lucide-react";
import { generateVariant, generateProductAltView, type VariantPart } from "@/lib/gemini";
import { getVariants, saveVariant, deleteVariant, renameVariant, type ProductVariant } from "@/lib/db";
import type { Product } from "@/lib/products";

interface Props {
  product:    Product;
  merchantId: string;
}

// ── Per-part row data ────────────────────────────────────────────────────────
type PartMode = "color" | "texture";

interface PartRow {
  id:             string;
  targetPart:     string;
  mode:           PartMode;
  colorHex:       string;
  colorDesc:      string;
  hexAutoResolved:boolean;
  textureUrl:     string | null;
}

function makePartRow(): PartRow {
  return {
    id:              crypto.randomUUID(),
    targetPart:      "",
    mode:            "color",
    colorHex:        "#8B6F47",
    colorDesc:       "",
    hexAutoResolved: false,
    textureUrl:      null,
  };
}

// ── Material / color name → hex lookup ──────────────────────────────────────
// When the merchant types a description, we resolve it to a hex so a solid
// color swatch is always sent to Gemini (visual anchor > text description).
const MATERIAL_COLORS: Record<string, string> = {
  // ── Wood tones ──
  "ebony":           "#1C1008",
  "dark walnut":     "#3B2314",
  "walnut":          "#5C3317",
  "medium walnut":   "#6B3A2A",
  "light walnut":    "#8B6447",
  "dark oak":        "#4E3524",
  "oak":             "#A07850",
  "white oak":       "#C8A97D",
  "teak":            "#9B6B3C",
  "mahogany":        "#4E2728",
  "cherry":          "#722F37",
  "maple":           "#D4A96A",
  "ash":             "#C8B99A",
  "pine":            "#D4B483",
  "bamboo":          "#C9B06B",
  "whitewashed":     "#E8E0D4",
  "bleached wood":   "#DDD5C8",
  "natural wood":    "#C4A882",
  "dark wood":       "#3B2A1E",

  // ── Neutrals / fabric ──
  "pure white":      "#FAFAFA",
  "white":           "#FFFFFF",
  "chalk white":     "#F0EDE8",
  "ivory":           "#FFFFF0",
  "cream":           "#F5EDD6",
  "off white":       "#F2EDE4",
  "linen":           "#D8CAB8",
  "warm beige":      "#D4B896",
  "beige":           "#C8B99A",
  "sand":            "#C2A97D",
  "greige":          "#B8A898",
  "taupe":           "#9E8B7A",
  "camel":           "#C19A6B",
  "tan":             "#D2B48C",

  // ── Greys ──
  "light grey":      "#D3D3D3",
  "silver":          "#C0C0C0",
  "grey":            "#9E9E9E",
  "medium grey":     "#808080",
  "dark grey":       "#606060",
  "charcoal":        "#36454F",
  "slate":           "#708090",
  "graphite":        "#4A4A4A",
  "anthracite":      "#383E42",

  // ── Dark / black ──
  "matte black":     "#1C1C1C",
  "black":           "#1A1A1A",

  // ── Blues ──
  "navy":            "#1B2A4A",
  "midnight blue":   "#191970",
  "dark blue":       "#1A237E",
  "petrol":          "#1B5E6B",
  "teal":            "#008080",
  "dusty blue":      "#7B9BAB",
  "powder blue":     "#B0C4DE",
  "sky blue":        "#87CEEB",
  "denim":           "#1560BD",

  // ── Greens ──
  "dark green":      "#1B5E20",
  "forest green":    "#228B22",
  "bottle green":    "#006A4E",
  "emerald":         "#50C878",
  "olive":           "#808000",
  "sage green":      "#87AE73",
  "sage":            "#87AE73",
  "moss":            "#8A9A5B",
  "eucalyptus":      "#5F8B6E",
  "mint":            "#98FF98",

  // ── Reds / pinks / terracotta ──
  "burgundy":        "#722F37",
  "wine":            "#722F37",
  "rust":            "#B7410E",
  "terracotta":      "#C0622B",
  "brick red":       "#CB4154",
  "coral":           "#FF6B6B",
  "blush":           "#E8C5B5",
  "dusty rose":      "#DCAE9D",
  "pink":            "#FFC0CB",

  // ── Yellows / browns / warm ──
  "mustard":         "#FFDB58",
  "ochre":           "#CC7722",
  "amber":           "#FFBF00",
  "caramel":         "#C68642",
  "cognac":          "#9A3B2A",
  "tobacco":         "#7F5E3D",
  "chocolate":       "#3D1C02",
  "dark brown":      "#4E342E",
  "brown":           "#795548",
  "warm brown":      "#8B5E3C",

  // ── Metals ──
  "matte gold":      "#C5A028",
  "gold":            "#D4AF37",
  "brass":           "#B5A642",
  "antique brass":   "#8A7038",
  "bronze":          "#8C6239",
  "copper":          "#B87333",
  "chrome":          "#DBE2E9",
  "brushed nickel":  "#C0BDB8",

  // ── Upholstery composites ──
  "bouclé white":    "#F0EDE8",
  "bouclé cream":    "#E8E0D0",
  "bouclé beige":    "#D8C8B0",
  "velvet navy":     "#1B2A4A",
  "velvet emerald":  "#50C878",
  "velvet burgundy": "#722F37",
  "velvet grey":     "#808080",
  "velvet teal":     "#008080",
  "dark leather":    "#3B2314",
  "cognac leather":  "#9A3B2A",
  "leather brown":   "#795548",
};

/**
 * Resolves a natural-language color description to the closest hex in
 * MATERIAL_COLORS. Returns null when nothing close enough is found.
 *
 * Strategy: exact match → starts-with → longest contained key → word overlap.
 */
function resolveColorDescription(desc: string): string | null {
  const norm = desc.trim().toLowerCase();
  if (!norm) return null;

  // 1. Exact match
  if (MATERIAL_COLORS[norm]) return MATERIAL_COLORS[norm];

  // 2. Description starts with a known key (e.g. "dark walnut finish" → "dark walnut")
  const byPrefix = Object.entries(MATERIAL_COLORS)
    .filter(([key]) => norm.startsWith(key))
    .sort((a, b) => b[0].length - a[0].length);
  if (byPrefix.length) return byPrefix[0][1];

  // 3. Known key is fully contained in description (e.g. "warm dark walnut wood" → "dark walnut")
  const byContains = Object.entries(MATERIAL_COLORS)
    .filter(([key]) => norm.includes(key))
    .sort((a, b) => b[0].length - a[0].length);
  if (byContains.length) return byContains[0][1];

  // 4. Best word-overlap score (≥2 words must match)
  const words = norm.split(/\s+/);
  let bestKey = "", bestScore = 0;
  for (const key of Object.keys(MATERIAL_COLORS)) {
    const kw = key.split(/\s+/);
    const overlap = words.filter((w) => kw.includes(w)).length;
    if (overlap >= 2 && overlap > bestScore) { bestScore = overlap; bestKey = key; }
  }
  if (bestKey) return MATERIAL_COLORS[bestKey];

  return null;
}

export default function VariantCreator({ product, merchantId }: Props) {
  // ── Part rows ─────────────────────────────────────────────────────────────
  const [partRows,     setPartRows]     = useState<PartRow[]>([makePartRow()]);
  const [variantName,  setVariantName]  = useState("");

  const textureRefs    = useRef<Record<string, HTMLInputElement | null>>({});
  const uploadSlotRefs = useRef<(HTMLInputElement | null)[]>([null, null]);

  // ── Top-view generation from uploaded images ─────────────────────────────
  const [generatingTopViews, setGeneratingTopViews] = useState(false);

  const updateRow = (id: string, patch: Partial<PartRow>) =>
    setPartRows((prev) => prev.map((r) => r.id === id ? { ...r, ...patch } : r));

  const addRow = () => setPartRows((prev) => [...prev, makePartRow()]);

  const removeRow = (id: string) =>
    setPartRows((prev) => prev.length > 1 ? prev.filter((r) => r.id !== id) : prev);

  // ── Preview (4 slots) ────────────────────────────────────────────────────
  const [previewImages, setPreviewImages] = useState<(string | null)[]>([null, null, null, null]);
  const [generating,    setGenerating]    = useState<boolean[]>([false, false, false, false]);
  const [hasGenerated,  setHasGenerated]  = useState(false);

  // ── Saving ───────────────────────────────────────────────────────────────
  const [saving,         setSaving]         = useState(false);
  const [savedVariants,  setSavedVariants]  = useState<ProductVariant[]>([]);
  const [variantsLoaded, setVariantsLoaded] = useState(false);

  // ── Loaded variant (editing mode) ────────────────────────────────────────
  // When a saved variant is loaded for editing, we store its ID here so that
  // clicking "Save" overwrites the original rather than creating a duplicate.
  const [loadedVariantId,   setLoadedVariantId]   = useState<string | null>(null);
  const [loadedVariantName, setLoadedVariantName] = useState<string>("");

  // ── Lightbox ─────────────────────────────────────────────────────────────
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // ── Apply error ───────────────────────────────────────────────────────────
  const [applyError, setApplyError] = useState<string | null>(null);

  // ── URL scan ──────────────────────────────────────────────────────────────
  const [scanUrl,      setScanUrl]      = useState("");
  const [scanning,     setScanning]     = useState(false);
  const [scannedChips, setScannedChips] = useState<{ name: string; hexColor: string }[]>([]);
  const [scanError,    setScanError]    = useState("");

  // ── Inline rename ─────────────────────────────────────────────────────────
  const [editingVariantId, setEditingVariantId] = useState<string | null>(null);
  const [editingName,      setEditingName]      = useState("");

  // ── Load saved variants on mount ─────────────────────────────────────────
  useEffect(() => {
    getVariants(merchantId, product.id)
      .then(setSavedVariants)
      .catch(console.error)
      .finally(() => setVariantsLoaded(true));
  }, [merchantId, product.id]);

  // ── Handle texture file pick for a specific row ───────────────────────────
  const handleTextureFile = (id: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const reader = new FileReader();
    reader.onload = () => updateRow(id, { textureUrl: reader.result as string });
    reader.readAsDataURL(file);
  };

  // ── Per-row color description auto-resolve (synchronous lookup) ───────────
  const handleColorDescChange = (id: string, desc: string) => {
    const resolved = resolveColorDescription(desc);
    updateRow(id, {
      colorDesc:       desc,
      ...(resolved
        ? { colorHex: resolved, hexAutoResolved: true }
        : { hexAutoResolved: false }),
    });
  };

  // ── Upload a photo directly into a preview slot (0 = Perspective, 1 = Front) ──
  const handleSlotUpload = (slot: 0 | 1, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setPreviewImages((prev) => {
        const next = [...prev] as (string | null)[];
        next[slot] = dataUrl;
        return next;
      });
      setHasGenerated(true);
    };
    reader.readAsDataURL(file);
  };

  // ── Generate 75° overhead views from whatever is in slots 0+1 ─────────────
  const handleGenerateTopViews = async () => {
    const imgs = ([previewImages[0], previewImages[1]] as (string | null)[]).filter(Boolean) as string[];
    if (imgs.length === 0) return;
    setGeneratingTopViews(true);
    setGenerating((prev) => { const n = [...prev] as boolean[]; n[2] = true; n[3] = true; return n; });
    try {
      const [view2, view3] = await Promise.all([
        generateProductAltView(imgs, product.category || "furniture", "perspective").catch(() => null),
        generateProductAltView(imgs, product.category || "furniture", "front").catch(() => null),
      ]);
      setPreviewImages((prev) => {
        const next = [...prev] as (string | null)[];
        if (view2) next[2] = view2;
        if (view3) next[3] = view3;
        return next;
      });
    } finally {
      setGenerating([false, false, false, false]);
      setGeneratingTopViews(false);
    }
  };

  // ── Apply variant generation ──────────────────────────────────────────────
  const handleApply = useCallback(async () => {
    if (product.images.length === 0) return;

    // Guard: Gemini key must be present (baked into bundle at build time)
    if (!import.meta.env.VITE_GEMINI_API_KEY) {
      setApplyError("Configuration error: VITE_GEMINI_API_KEY is not set in this deployment.");
      return;
    }
    setApplyError(null);

    // Build the parts array from all rows
    const variantParts: VariantPart[] = partRows.map((r) => ({
      targetPart:   r.targetPart.trim() || "the furniture",
      modification: r.mode === "color"
        ? { type: "color" as const, hexColor: r.colorHex, description: r.colorDesc.trim() || undefined }
        : { type: "texture" as const, dataUrl: r.textureUrl! },
    }));

    // Reset preview — mark all slots with a base image as "generating"
    const hasBases = product.images.slice(0, 4).map((img) => !!img);
    setPreviewImages([null, null, null, null]);
    setHasGenerated(false);
    setGenerating(hasBases as [boolean, boolean, boolean, boolean]);

    // Track how many slots have settled so we know when all are done
    let settledCount = 0;
    let successCount = 0;
    const totalSlots = hasBases.filter(Boolean).length;

    try {
      await generateVariant(
        product.images,
        product.category || "furniture",
        variantParts,
        // onSlotReady: update each slot as it resolves (progressive reveal)
        (index, dataUrl) => {
          if (dataUrl !== null) successCount++;
          setPreviewImages((prev) => {
            const next = [...prev] as (string | null)[];
            next[index] = dataUrl;
            return next;
          });
          setGenerating((prev) => {
            const next = [...prev] as boolean[];
            next[index] = false;
            return next;
          });
          settledCount++;
          if (settledCount >= totalSlots) setHasGenerated(true);
        },
      );
    } catch (err) {
      console.error("generateVariant failed:", err);
      setApplyError(`Generation error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setGenerating([false, false, false, false]);
      setHasGenerated(true);
      if (successCount === 0 && totalSlots > 0) {
        setApplyError(
          "Generation failed — no images were produced. " +
          "Check that the product images load correctly and open the browser console (F12) for the specific error.",
        );
      }
    }
  }, [partRows, product]);

  // ── Load a saved variant back into the editor ─────────────────────────────
  const loadVariantForEdit = (v: ProductVariant) => {
    // Map the variant's saved images into the 4-slot preview array
    const imgs: (string | null)[] = [null, null, null, null];
    v.images.forEach((img, i) => { if (i < 4) imgs[i] = img; });
    setPreviewImages(imgs);
    setVariantName(v.name);
    setHasGenerated(true);
    setLoadedVariantId(v.id);
    setLoadedVariantName(v.name);
    setApplyError(null);
    // Scroll the top of the page so the user sees the preview immediately
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const cancelLoadedEdit = () => {
    setLoadedVariantId(null);
    setLoadedVariantName("");
    setPreviewImages([null, null, null, null]);
    setHasGenerated(false);
    setVariantName("");
    setApplyError(null);
  };

  // ── Save variant ──────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!variantName.trim()) return;
    setSaving(true);
    try {
      // When overwriting a loaded variant, delete the old storage files first
      // then re-save under the same ID so it stays in the same list position.
      const id = loadedVariantId ?? crypto.randomUUID();
      if (loadedVariantId) {
        await deleteVariant(merchantId, product.id, loadedVariantId);
      }
      await saveVariant(merchantId, product.id, id, variantName.trim(), previewImages);
      const updated = await getVariants(merchantId, product.id);
      setSavedVariants(updated);
      // Reset after save
      setPreviewImages([null, null, null, null]);
      setHasGenerated(false);
      setVariantName("");
      setLoadedVariantId(null);
      setLoadedVariantName("");
    } catch (err) {
      console.error("saveVariant failed:", err);
    } finally {
      setSaving(false);
    }
  };

  // ── Delete a saved variant ────────────────────────────────────────────────
  const handleDelete = async (variantId: string) => {
    if (!confirm("Delete this variant?")) return;
    try {
      await deleteVariant(merchantId, product.id, variantId);
      setSavedVariants((prev) => prev.filter((v) => v.id !== variantId));
    } catch (err) {
      console.error("deleteVariant failed:", err);
    }
  };

  // ── Scan product page for variants ───────────────────────────────────────
  const handleScan = async () => {
    if (!scanUrl.trim()) return;
    setScanning(true);
    setScannedChips([]);
    setScanError("");
    try {
      const res  = await fetch("/api/extract-variants", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ url: scanUrl.trim() }),
      });
      const data = await res.json();
      const chips = data.variants ?? [];
      setScannedChips(chips);
      if (chips.length === 0) setScanError("No color variants found on that page.");
    } catch {
      setScanError("Failed to scan page. Check the URL and try again.");
    } finally {
      setScanning(false);
    }
  };

  const applyChip = (chip: { name: string; hexColor: string }) => {
    // Apply to the first part row (most common case — single-part selection)
    const firstId = partRows[0]?.id;
    if (firstId) updateRow(firstId, { colorDesc: chip.name, colorHex: chip.hexColor, hexAutoResolved: true });
  };

  // ── Inline rename ─────────────────────────────────────────────────────────
  const startEdit = (v: ProductVariant) => {
    setEditingVariantId(v.id);
    setEditingName(v.name);
  };

  const cancelEdit = () => {
    setEditingVariantId(null);
    setEditingName("");
  };

  const commitEdit = async (v: ProductVariant) => {
    const trimmed = editingName.trim();
    if (!trimmed || trimmed === v.name) { cancelEdit(); return; }
    try {
      await renameVariant(merchantId, product.id, v.id, trimmed);
      setSavedVariants((prev) =>
        prev.map((x) => x.id === v.id ? { ...x, name: trimmed } : x),
      );
    } catch (err) {
      console.error("renameVariant failed:", err);
    } finally {
      cancelEdit();
    }
  };

  const isApplying     = generating.some(Boolean);
  const canApply       = !isApplying
                         && product.images.length > 0
                         && partRows.length > 0
                         && partRows.every((r) => r.mode === "texture" ? !!r.textureUrl : true);
  const anyGenerated   = previewImages.some((img) => img !== null);
  const canSave        = hasGenerated && anyGenerated && variantName.trim().length > 0 && !saving;

  const SLOT_LABELS = ["Perspective", "Front", "75° diag", "75° front"];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-sm font-medium text-foreground mb-0.5">Variant Creator</h3>
        <p className="text-xs text-muted-foreground">
          Generate color or material variations of this product.
        </p>
      </div>

      {/* ── Import from URL ── */}
      <div className="flex flex-col gap-2">
        <label className="text-xs text-muted-foreground uppercase tracking-widest">
          Import colors from product page
        </label>
        <div className="flex gap-2">
          <input
            type="url"
            placeholder="https://yourstore.com/product-page"
            value={scanUrl}
            onChange={(e) => { setScanUrl(e.target.value); setScanError(""); setScannedChips([]); }}
            onKeyDown={(e) => { if (e.key === "Enter") handleScan(); }}
            className="flex-1 rounded border border-input bg-card px-3 py-1.5 text-xs text-foreground
                       placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <button
            onClick={handleScan}
            disabled={scanning || !scanUrl.trim()}
            className="rounded border border-border bg-card px-3 py-1.5 text-xs text-foreground
                       hover:bg-secondary transition-colors disabled:opacity-40 disabled:cursor-not-allowed
                       flex items-center gap-1.5 flex-shrink-0"
          >
            {scanning ? <><Loader2 className="h-3 w-3 animate-spin" />Scanning…</> : "Scan"}
          </button>
        </div>

        {/* Chips */}
        {scannedChips.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-0.5">
            {scannedChips.map((chip, i) => (
              <button
                key={i}
                onClick={() => applyChip(chip)}
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                  chip.hexColor === partRows[0]?.colorHex && chip.name === partRows[0]?.colorDesc
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border bg-card text-foreground hover:bg-secondary"
                }`}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0 border border-black/10"
                  style={{ backgroundColor: chip.hexColor }}
                />
                {chip.name}
              </button>
            ))}
          </div>
        )}

        {scanError && (
          <p className="text-[11px] text-amber-500/80">{scanError}</p>
        )}
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:gap-8">
        {/* ── Left: part rows + controls ── */}
        <div className="flex flex-col gap-3 flex-1 min-w-0">

          {/* Part rows */}
          {partRows.map((row, idx) => (
            <div key={row.id} className="flex flex-col gap-2 rounded-lg border border-border bg-card/50 p-3">

              {/* Row header */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground uppercase tracking-widest flex-1">
                  Part {partRows.length > 1 ? idx + 1 : ""}
                </span>
                {/* Mode mini-toggle */}
                <div className="flex rounded border border-border overflow-hidden text-[10px]">
                  {(["color", "texture"] as PartMode[]).map((m) => (
                    <button key={m} onClick={() => updateRow(row.id, { mode: m })}
                      className={`px-2.5 py-1 capitalize transition-colors ${
                        row.mode === m
                          ? "bg-primary text-primary-foreground"
                          : "bg-card text-muted-foreground hover:text-foreground"
                      }`}>
                      {m}
                    </button>
                  ))}
                </div>
                {partRows.length > 1 && (
                  <button onClick={() => removeRow(row.id)}
                    className="text-muted-foreground hover:text-destructive transition-colors"
                    aria-label="Remove part">
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {/* Part name */}
              <input
                type="text"
                placeholder="Which part (optional): seat cushion, wooden legs, tabletop…"
                value={row.targetPart}
                onChange={(e) => updateRow(row.id, { targetPart: e.target.value })}
                className="w-full rounded border border-input bg-card px-3 py-1.5 text-xs text-foreground
                           placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />

              {/* Color or texture controls */}
              {row.mode === "color" ? (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={row.colorHex}
                      onChange={(e) => updateRow(row.id, { colorHex: e.target.value, hexAutoResolved: false })}
                      className="w-8 h-7 rounded border border-border cursor-pointer bg-transparent p-0.5 flex-shrink-0"
                    />
                    <span className="text-xs text-muted-foreground font-mono">{row.colorHex}</span>
                    {row.hexAutoResolved && (
                      <span className="text-[10px] text-primary/80 font-medium">✓ matched</span>
                    )}
                  </div>
                  <input
                    type="text"
                    placeholder="Describe: dark walnut, sage green, warm beige…"
                    value={row.colorDesc}
                    onChange={(e) => handleColorDescChange(row.id, e.target.value)}
                    className="w-full rounded border border-input bg-card px-3 py-1.5 text-xs text-foreground
                               placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  {row.textureUrl ? (
                    <div className="relative w-16 h-16 rounded border border-border overflow-hidden group cursor-pointer flex-shrink-0"
                      onClick={() => setPreviewUrl(row.textureUrl!)}>
                      <img src={row.textureUrl} alt="Texture" className="w-full h-full object-cover" />
                      <button
                        onClick={(e) => { e.stopPropagation(); updateRow(row.id, { textureUrl: null }); }}
                        className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center
                                   justify-center transition-opacity text-white text-[10px]">
                        Remove
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => textureRefs.current[row.id]?.click()}
                      className="w-16 h-16 rounded border-2 border-dashed border-border hover:border-primary/50
                                 flex flex-col items-center justify-center gap-1 transition-colors
                                 text-muted-foreground hover:text-foreground flex-shrink-0">
                      <ImageIcon className="h-4 w-4" />
                      <span className="text-[10px]">Upload</span>
                    </button>
                  )}
                  <input
                    ref={(el) => { textureRefs.current[row.id] = el; }}
                    type="file" accept="image/*" className="hidden"
                    onChange={(e) => handleTextureFile(row.id, e)}
                  />
                </div>
              )}
            </div>
          ))}

          {/* Add part button */}
          <button
            onClick={addRow}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground
                       transition-colors w-fit"
          >
            <Plus className="h-3.5 w-3.5" />
            Add another part
          </button>

          {/* Variant name */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground uppercase tracking-widest">
              Variant name
            </label>
            <input
              type="text"
              placeholder="e.g. Cognac + Dark Walnut, Sand Bouclé…"
              value={variantName}
              onChange={(e) => setVariantName(e.target.value)}
              className="w-full rounded border border-input bg-card px-3 py-1.5 text-xs text-foreground
                         placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          {/* Save button */}
          {hasGenerated && anyGenerated && (
            <button
              onClick={handleSave}
              disabled={!canSave}
              className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground
                         hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed
                         flex items-center justify-center gap-2"
            >
              {saving ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin" />Saving…</>
              ) : loadedVariantId ? (
                <>Save variant</>
              ) : (
                <>Save as variant</>
              )}
            </button>
          )}
          {hasGenerated && anyGenerated && !variantName.trim() && (
            <p className="text-[11px] text-amber-500/80">Enter a variant name above to save.</p>
          )}
        </div>

        {/* ── Right: 2×2 preview ── */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground uppercase tracking-widest">Preview</label>
            {loadedVariantId && (
              <span className="flex items-center gap-1 rounded-full bg-primary/15 border border-primary/30 px-2 py-0.5 text-[10px] text-primary font-medium">
                Editing: {loadedVariantName}
                <button onClick={cancelLoadedEdit} className="ml-0.5 hover:text-primary/60 transition-colors" aria-label="Cancel edit">
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2" style={{ width: 220 }}>
            {[0, 1, 2, 3].map((i) => {
              const src  = previewImages[i];
              const base = product.images[i] ?? null;
              const busy = generating[i];
              return (
                <div
                  key={i}
                  className="relative rounded border border-border bg-card overflow-hidden"
                  style={{ width: 106, height: 106 }}
                >
                  {/* Base image (dimmed) — slots 2+3 only; slots 0+1 replaced by upload */}
                  {base && !src && i >= 2 && (
                    <img src={base} alt={SLOT_LABELS[i]}
                      className="absolute inset-0 w-full h-full object-contain opacity-30" />
                  )}

                  {/* Generated / uploaded preview */}
                  {src && (
                    <img
                      src={src}
                      alt={SLOT_LABELS[i]}
                      className="absolute inset-0 w-full h-full object-contain cursor-zoom-in"
                      onClick={() => setPreviewUrl(src)}
                    />
                  )}

                  {/* Upload button — slots 0+1 when empty */}
                  {i < 2 && !src && !busy && (
                    <button
                      onClick={() => uploadSlotRefs.current[i]?.click()}
                      className="absolute inset-0 flex flex-col items-center justify-center gap-1
                                 text-muted-foreground/40 hover:text-muted-foreground/80 hover:bg-white/5
                                 transition-colors"
                      aria-label={`Upload ${SLOT_LABELS[i]} photo`}
                    >
                      <Upload className="h-4 w-4" />
                      <span className="text-[8px]">Upload</span>
                    </button>
                  )}

                  {/* Spinner */}
                  {busy && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                      <Loader2 className="h-5 w-5 animate-spin text-white" />
                    </div>
                  )}

                  {/* Slot label */}
                  {!busy && (
                    <span className="absolute bottom-1 left-0 right-0 text-center text-[9px] text-muted-foreground/60 pointer-events-none">
                      {SLOT_LABELS[i]}
                    </span>
                  )}

                  {/* No image indicator — slots 2+3 only */}
                  {i >= 2 && !base && !busy && !src && (
                    <div className="absolute inset-0 flex items-center justify-center text-[9px] text-muted-foreground/40">
                      No image
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Hidden file inputs for slot uploads */}
          <input ref={(el) => { uploadSlotRefs.current[0] = el; }} type="file" accept="image/*" className="hidden"
            onChange={(e) => handleSlotUpload(0, e)} />
          <input ref={(el) => { uploadSlotRefs.current[1] = el; }} type="file" accept="image/*" className="hidden"
            onChange={(e) => handleSlotUpload(1, e)} />

          {/* Generate 75° views from uploaded/generated slot 0+1 images */}
          {(previewImages[0] || previewImages[1]) && (
            <button
              onClick={handleGenerateTopViews}
              disabled={generatingTopViews || isApplying}
              className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground
                         hover:bg-secondary hover:text-foreground transition-colors
                         disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
            >
              {generatingTopViews ? (
                <><Loader2 className="h-3 w-3 animate-spin" />Generating top views…</>
              ) : (
                <>Generate 75° views</>
              )}
            </button>
          )}

          {/* Apply button */}
          <button
            onClick={handleApply}
            disabled={!canApply}
            className="rounded-lg border border-primary bg-primary/10 hover:bg-primary/20
                       px-4 py-2 text-xs font-medium text-foreground transition-colors
                       disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isApplying ? (
              <><Loader2 className="h-3.5 w-3.5 animate-spin" />Generating…</>
            ) : (
              <>Apply</>
            )}
          </button>

          {applyError && (
            <p className="text-[11px] text-red-400/90 bg-red-400/10 rounded px-2 py-1.5 leading-tight">
              ⚠ {applyError}
            </p>
          )}
        </div>
      </div>

      {/* ── Saved variants list ── */}
      <div className="flex flex-col gap-2 mt-2">
        <label className="text-xs text-muted-foreground uppercase tracking-widest">
          Saved variants ({savedVariants.length})
        </label>

        {!variantsLoaded ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {/* New variant row — always first */}
            <div
              onClick={cancelLoadedEdit}
              className={`flex items-center gap-3 rounded-lg border bg-card px-3 py-2 cursor-pointer transition-colors ${
                !loadedVariantId
                  ? "border-primary/50 bg-primary/5"
                  : "border-dashed border-border hover:border-primary/40 hover:bg-secondary/40"
              }`}
            >
              <div className="w-10 h-10 rounded border border-dashed border-border flex items-center justify-center flex-shrink-0">
                <Plus className="h-4 w-4 text-muted-foreground" />
              </div>
              <span className="flex-1 text-xs text-muted-foreground">New variant</span>
            </div>

            {savedVariants.length === 0 && (
              <p className="text-xs text-muted-foreground px-1">No variants yet. Click above to start.</p>
            )}

            {savedVariants.map((v) => (
              <div
                key={v.id}
                onClick={() => { if (editingVariantId !== v.id) loadVariantForEdit(v); }}
                className={`flex items-center gap-3 rounded-lg border bg-card px-3 py-2 cursor-pointer transition-colors ${
                  loadedVariantId === v.id
                    ? "border-primary/50 bg-primary/5"
                    : "border-border hover:border-primary/30 hover:bg-secondary/40"
                }`}
              >

                {/* Thumbnail */}
                {v.images[0] ? (
                  <img
                    src={v.images[0]}
                    alt={v.name}
                    className="w-10 h-10 object-contain rounded border border-border flex-shrink-0 cursor-zoom-in"
                    onClick={(e) => { e.stopPropagation(); setPreviewUrl(v.images[0]); }}
                  />
                ) : (
                  <div className="w-10 h-10 rounded border border-border bg-muted flex-shrink-0 flex items-center justify-center">
                    <ImageIcon className="h-4 w-4 text-muted-foreground/50" />
                  </div>
                )}

                {/* Name — normal or inline edit */}
                {editingVariantId === v.id ? (
                  <>
                    <input
                      autoFocus
                      value={editingName}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setEditingName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter")  commitEdit(v);
                        if (e.key === "Escape") cancelEdit();
                      }}
                      className="flex-1 rounded border border-input bg-background px-2 py-0.5 text-xs
                                 text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                    <button onClick={(e) => { e.stopPropagation(); commitEdit(v); }}
                      className="text-primary hover:text-primary/80 transition-colors flex-shrink-0"
                      aria-label="Save name">
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); cancelEdit(); }}
                      className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                      aria-label="Cancel">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </>
                ) : (
                  <>
                    <span className="flex-1 text-xs text-foreground truncate">{v.name}</span>
                    <span className="text-[10px] text-muted-foreground/60 flex-shrink-0">
                      {v.images.length} image{v.images.length !== 1 ? "s" : ""}
                    </span>
                    <button onClick={(e) => { e.stopPropagation(); startEdit(v); }}
                      className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                      aria-label="Rename variant">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); handleDelete(v.id); }}
                      className="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0"
                      aria-label="Delete variant">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Lightbox ── */}
      {previewUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 cursor-zoom-out"
          onClick={() => setPreviewUrl(null)}
        >
          <img
            src={previewUrl}
            alt="Preview"
            className="max-w-full max-h-full rounded-lg shadow-2xl object-contain"
            style={{ maxWidth: "90vw", maxHeight: "90vh" }}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

    </div>
  );
}
