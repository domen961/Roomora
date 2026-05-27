import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Trash2, ImageIcon } from "lucide-react";
import { generateVariant } from "@/lib/gemini";
import { getVariants, saveVariant, deleteVariant, type ProductVariant } from "@/lib/db";
import type { Product } from "@/lib/products";

interface Props {
  product:    Product;
  merchantId: string;
}

type Mode = "color" | "texture";

export default function VariantCreator({ product, merchantId }: Props) {
  // ── Controls ─────────────────────────────────────────────────────────────
  const [mode,         setMode]         = useState<Mode>("color");
  const [colorHex,     setColorHex]     = useState("#8B6F47");
  const [colorDesc,    setColorDesc]    = useState("");
  const [textureUrl,   setTextureUrl]   = useState<string | null>(null);
  const [targetPart,   setTargetPart]   = useState("");
  const [variantName,  setVariantName]  = useState("");

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

  const textureInputRef = useRef<HTMLInputElement>(null);

  // ── Load saved variants on mount ─────────────────────────────────────────
  useEffect(() => {
    getVariants(merchantId, product.id)
      .then(setSavedVariants)
      .catch(console.error)
      .finally(() => setVariantsLoaded(true));
  }, [merchantId, product.id]);

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
        ? { type: "color" as const, value: colorDesc.trim() || colorHex }
        : { type: "texture" as const, dataUrl: textureUrl! };

    if (mode === "texture" && !textureUrl) return;
    if (!targetPart.trim()) return;

    // Reset preview
    setPreviewImages([null, null, null, null]);
    setHasGenerated(false);
    setGenerating([true, true, true, true]);

    try {
      // Call generateVariant — returns array of 4 slots (null where no base image or failed)
      const results = await generateVariant(
        product.images,
        product.category || "furniture",
        targetPart.trim(),
        modification,
      );

      setPreviewImages(results);
      setHasGenerated(true);
    } catch (err) {
      console.error("generateVariant failed:", err);
    } finally {
      setGenerating([false, false, false, false]);
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
                  onChange={(e) => setColorHex(e.target.value)}
                  className="w-10 h-8 rounded border border-border cursor-pointer bg-transparent p-0.5"
                  title="Pick a color"
                />
                <span className="text-xs text-muted-foreground font-mono">{colorHex}</span>
              </div>
              <input
                type="text"
                placeholder="Or describe: warm beige linen, dark walnut…"
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
                {v.images[0] ? (
                  <img
                    src={v.images[0]}
                    alt={v.name}
                    className="w-10 h-10 object-contain rounded border border-border flex-shrink-0
                               cursor-zoom-in"
                    onClick={() => setPreviewUrl(v.images[0])}
                  />
                ) : (
                  <div className="w-10 h-10 rounded border border-border bg-muted flex-shrink-0 flex items-center justify-center">
                    <ImageIcon className="h-4 w-4 text-muted-foreground/50" />
                  </div>
                )}
                <span className="flex-1 text-xs text-foreground truncate">{v.name}</span>
                <span className="text-[10px] text-muted-foreground/60 flex-shrink-0">
                  {v.images.length} image{v.images.length !== 1 ? "s" : ""}
                </span>
                <button
                  onClick={() => handleDelete(v.id)}
                  className="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0"
                  aria-label="Delete variant"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
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
