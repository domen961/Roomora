import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, Pencil, Trash2, ImageIcon, X } from "lucide-react";
import { generateVariant } from "@/lib/gemini";
import { getVariants, saveVariant, deleteVariant, renameVariant, type ProductVariant } from "@/lib/db";
import type { Product } from "@/lib/products";

interface Props {
  product:    Product;
  merchantId: string;
}

type Mode = "color" | "texture";

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
  // ── Controls ─────────────────────────────────────────────────────────────
  const [mode,             setMode]             = useState<Mode>("color");
  const [colorHex,         setColorHex]         = useState("#8B6F47");
  const [colorDesc,        setColorDesc]        = useState("");
  const [hexAutoResolved,  setHexAutoResolved]  = useState(false);
  const [textureUrl,       setTextureUrl]       = useState<string | null>(null);
  const [targetPart,       setTargetPart]       = useState("");
  const [variantName,      setVariantName]      = useState("");

  // ── Preview (4 slots) ────────────────────────────────────────────────────
  const [previewImages, setPreviewImages] = useState<(string | null)[]>([null, null, null, null]);
  const [generating,    setGenerating]    = useState<boolean[]>([false, false, false, false]);
  const [hasGenerated,  setHasGenerated]  = useState(false);

  // ── Saving ───────────────────────────────────────────────────────────────
  const [saving,         setSaving]         = useState(false);
  const [savedVariants,  setSavedVariants]  = useState<ProductVariant[]>([]);
  const [variantsLoaded, setVariantsLoaded] = useState(false);

  // ── Lightbox ─────────────────────────────────────────────────────────────
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // ── URL scan ──────────────────────────────────────────────────────────────
  const [scanUrl,      setScanUrl]      = useState("");
  const [scanning,     setScanning]     = useState(false);
  const [scannedChips, setScannedChips] = useState<{ name: string; hexColor: string }[]>([]);
  const [scanError,    setScanError]    = useState("");

  // ── Inline rename ─────────────────────────────────────────────────────────
  const [editingVariantId, setEditingVariantId] = useState<string | null>(null);
  const [editingName,      setEditingName]      = useState("");

  const textureInputRef = useRef<HTMLInputElement>(null);

  // ── Load saved variants on mount ─────────────────────────────────────────
  useEffect(() => {
    getVariants(merchantId, product.id)
      .then(setSavedVariants)
      .catch(console.error)
      .finally(() => setVariantsLoaded(true));
  }, [merchantId, product.id]);

  // ── Auto-resolve color description → hex ────────────────────────────────────
  // Debounced: 400 ms after the user stops typing, look up the description in
  // MATERIAL_COLORS and update the color picker if a match is found. This ensures
  // a solid swatch is always sent to Gemini (visual anchor beats text-only prompts).
  useEffect(() => {
    if (!colorDesc.trim()) { setHexAutoResolved(false); return; }
    const timer = setTimeout(() => {
      const resolved = resolveColorDescription(colorDesc);
      if (resolved) {
        setColorHex(resolved);
        setHexAutoResolved(true);
      } else {
        setHexAutoResolved(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [colorDesc]);

  // ── Handle texture file pick ──────────────────────────────────────────────
  const handleTextureFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const reader = new FileReader();
    reader.onload = () => setTextureUrl(reader.result as string);
    reader.readAsDataURL(file);
  };

  // ── Apply variant generation ──────────────────────────────────────────────
  const handleApply = useCallback(async () => {
    if (product.images.length === 0) return;

    const modification =
      mode === "color"
        ? { type: "color" as const, hexColor: colorHex, description: colorDesc.trim() || undefined }
        : { type: "texture" as const, dataUrl: textureUrl! };

    if (mode === "texture" && !textureUrl) return;
    if (!targetPart.trim()) return;

    // Reset preview — mark all slots with a base image as "generating"
    const hasBases = product.images.slice(0, 4).map((img) => !!img);
    setPreviewImages([null, null, null, null]);
    setHasGenerated(false);
    setGenerating(hasBases as [boolean, boolean, boolean, boolean]);

    // Track how many slots have settled so we know when all are done
    let settledCount = 0;
    const totalSlots = hasBases.filter(Boolean).length;

    try {
      await generateVariant(
        product.images,
        product.category || "furniture",
        targetPart.trim(),
        modification,
        // onSlotReady: update each slot as it resolves (progressive reveal)
        (index, dataUrl) => {
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
    } finally {
      setGenerating([false, false, false, false]);
      setHasGenerated(true);
    }
  }, [mode, colorHex, colorDesc, textureUrl, targetPart, product]);

  // ── Save variant ──────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!variantName.trim()) return;
    setSaving(true);
    try {
      const id = crypto.randomUUID();
      await saveVariant(merchantId, product.id, id, variantName.trim(), previewImages);
      const updated = await getVariants(merchantId, product.id);
      setSavedVariants(updated);
      // Reset after save
      setPreviewImages([null, null, null, null]);
      setHasGenerated(false);
      setVariantName("");
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
    setColorDesc(chip.name);
    setColorHex(chip.hexColor);
    setHexAutoResolved(true);
    setScannedChips([]);
    setScanUrl("");
    setScanError("");
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
  const canApply       = !isApplying && targetPart.trim().length > 0 && product.images.length > 0
                         && (mode === "color" || !!textureUrl);
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
                className="flex items-center gap-1.5 rounded-full border border-border bg-card
                           px-2.5 py-1 text-[11px] text-foreground hover:bg-secondary transition-colors"
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

      {/* ── Mode toggle ── */}
      <div className="flex rounded-lg border border-border overflow-hidden w-fit text-xs">
        {(["color", "texture"] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`px-4 py-1.5 capitalize transition-colors ${
              mode === m
                ? "bg-primary text-primary-foreground"
                : "bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:gap-8">
        {/* ── Left: controls ── */}
        <div className="flex flex-col gap-3 flex-1 min-w-0">

          {mode === "color" ? (
            <div className="flex flex-col gap-2">
              <label className="text-xs text-muted-foreground uppercase tracking-widest">Color</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={colorHex}
                  onChange={(e) => { setColorHex(e.target.value); setHexAutoResolved(false); }}
                  className="w-10 h-8 rounded border border-border cursor-pointer bg-transparent p-0.5"
                  title="Pick a color"
                />
                <span className="text-xs text-muted-foreground font-mono">{colorHex}</span>
                {hexAutoResolved && (
                  <span className="text-[10px] text-primary/80 font-medium">✓ matched</span>
                )}
              </div>
              <input
                type="text"
                placeholder="Describe: dark walnut, sage green, warm beige…"
                value={colorDesc}
                onChange={(e) => setColorDesc(e.target.value)}
                className="w-full rounded border border-input bg-card px-3 py-1.5 text-xs text-foreground
                           placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <label className="text-xs text-muted-foreground uppercase tracking-widest">Texture reference</label>
              {textureUrl ? (
                <div className="relative w-20 h-20 rounded border border-border overflow-hidden group cursor-pointer"
                  onClick={() => setPreviewUrl(textureUrl)}>
                  <img src={textureUrl} alt="Texture" className="w-full h-full object-cover" />
                  <button
                    onClick={(e) => { e.stopPropagation(); setTextureUrl(null); }}
                    className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center
                               transition-opacity text-white text-xs"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => textureInputRef.current?.click()}
                  className="w-20 h-20 rounded border-2 border-dashed border-border hover:border-primary/50
                             flex flex-col items-center justify-center gap-1 transition-colors text-muted-foreground
                             hover:text-foreground"
                >
                  <ImageIcon className="h-5 w-5" />
                  <span className="text-xs">Upload</span>
                </button>
              )}
              <input ref={textureInputRef} type="file" accept="image/*"
                className="hidden" onChange={handleTextureFile} />
            </div>
          )}

          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground uppercase tracking-widest">
              Which part to change
            </label>
            <input
              type="text"
              placeholder="e.g. the seat cushion, the tabletop, the legs"
              value={targetPart}
              onChange={(e) => setTargetPart(e.target.value)}
              className="w-full rounded border border-input bg-card px-3 py-1.5 text-xs text-foreground
                         placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground uppercase tracking-widest">
              Variant name
            </label>
            <input
              type="text"
              placeholder="e.g. Sand, Dark Oak, Bouclé White…"
              value={variantName}
              onChange={(e) => setVariantName(e.target.value)}
              className="w-full rounded border border-input bg-card px-3 py-1.5 text-xs text-foreground
                         placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

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
        </div>

        {/* ── Right: 2×2 preview ── */}
        <div className="flex flex-col gap-3">
          <label className="text-xs text-muted-foreground uppercase tracking-widest">Preview</label>
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
                  {/* Base image (dimmed) */}
                  {base && !src && (
                    <img src={base} alt={SLOT_LABELS[i]}
                      className="absolute inset-0 w-full h-full object-contain opacity-30" />
                  )}

                  {/* Generated preview */}
                  {src && (
                    <img
                      src={src}
                      alt={SLOT_LABELS[i]}
                      className="absolute inset-0 w-full h-full object-contain cursor-zoom-in"
                      onClick={() => setPreviewUrl(src)}
                    />
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

                  {/* No base image indicator */}
                  {!base && !busy && !src && (
                    <div className="absolute inset-0 flex items-center justify-center text-[9px] text-muted-foreground/40">
                      No image
                    </div>
                  )}
                </div>
              );
            })}
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
              ) : (
                <>Save as variant</>
              )}
            </button>
          )}
          {hasGenerated && anyGenerated && !variantName.trim() && (
            <p className="text-[11px] text-amber-500/80">Enter a variant name above to save.</p>
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
        ) : savedVariants.length === 0 ? (
          <p className="text-xs text-muted-foreground">No variants yet.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {savedVariants.map((v) => (
              <div key={v.id}
                className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2">

                {/* Thumbnail */}
                {v.images[0] ? (
                  <img
                    src={v.images[0]}
                    alt={v.name}
                    className="w-10 h-10 object-contain rounded border border-border flex-shrink-0 cursor-zoom-in"
                    onClick={() => setPreviewUrl(v.images[0])}
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
                      onChange={(e) => setEditingName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter")  commitEdit(v);
                        if (e.key === "Escape") cancelEdit();
                      }}
                      className="flex-1 rounded border border-input bg-background px-2 py-0.5 text-xs
                                 text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                    <button onClick={() => commitEdit(v)}
                      className="text-primary hover:text-primary/80 transition-colors flex-shrink-0"
                      aria-label="Save name">
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={cancelEdit}
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
                    <button onClick={() => startEdit(v)}
                      className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                      aria-label="Rename variant">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => handleDelete(v.id)}
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
