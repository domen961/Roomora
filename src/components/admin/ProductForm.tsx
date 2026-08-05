import { useRef, useState } from "react";
import {
  Loader2, CheckCircle, X, ImagePlus, Link, Plus, Sparkles, ArrowLeftRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { saveProduct, updateProduct } from "@/lib/db";
import type { Product, FurnitureCategory } from "@/lib/products";
import { FURNITURE_CATEGORIES } from "@/lib/products";
import { extractProductData, extractProductDataFromHtml } from "@/lib/gemini";

interface Props {
  merchantId:      string;
  initialProduct?: Product;
  onSave:          () => void;
  onCancel:        () => void;
}

export default function ProductForm({ merchantId, initialProduct, onSave, onCancel }: Props) {
  const isEditing = !!initialProduct;

  const [name,        setName]        = useState(initialProduct?.name        ?? "");
  const [description, setDescription] = useState(initialProduct?.description ?? "");
  const [category,    setCategory]    = useState<FurnitureCategory | "">(initialProduct?.category ?? "");
  const [lengthCm,    setLengthCm]    = useState(initialProduct?.length_cm   != null ? String(initialProduct.length_cm) : "");
  const [widthCm,     setWidthCm]     = useState(initialProduct?.width_cm    != null ? String(initialProduct.width_cm)  : "");
  const [heightCm,    setHeightCm]    = useState(initialProduct?.height_cm   != null ? String(initialProduct.height_cm) : "");

  // URL import
  const [importUrl,       setImportUrl]       = useState("");
  const [importing,       setImporting]       = useState(false);
  const [importError,     setImportError]     = useState("");
  const [extractedImages, setExtractedImages] = useState<string[]>([]);
  const [addingImageIdx,  setAddingImageIdx]  = useState<number | null>(null);
  // Paste-HTML fallback (for Cloudflare-protected sites the server can't fetch)
  const [showPaste,       setShowPaste]       = useState(false);
  const [pastedHtml,      setPastedHtml]      = useState("");
  const [parsingHtml,     setParsingHtml]     = useState(false);
  // Add a product photo from a pasted image URL
  const [manualImageUrl,   setManualImageUrl]   = useState("");
  const [addingManualUrl,  setAddingManualUrl]  = useState(false);
  const [manualImageError, setManualImageError] = useState("");

  // Photos — pre-filled with the first 2 images only (index 2+ are AI top views)
  const [photos,    setPhotos]    = useState<string[]>(
    (initialProduct?.images ?? []).slice(0, 2).filter(Boolean),
  );
  const [photoDrag,   setPhotoDrag]   = useState(false);
  const [previewUrl,  setPreviewUrl]  = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  // Save
  const [saving,    setSaving]    = useState(false);
  const [saveError, setSaveError] = useState("");

  const canSave = name.trim().length > 0 && photos.length > 0;
  const isBusy  = importing || parsingHtml || saving || addingImageIdx !== null;

  // ── URL import ──────────────────────────────────────────────────────────────
  const applyExtracted = (extracted: Awaited<ReturnType<typeof extractProductData>>) => {
    if (extracted.name)        setName(extracted.name);
    if (extracted.description) setDescription(extracted.description);
    if (extracted.category)    setCategory(extracted.category as FurnitureCategory);
    if (extracted.length_cm)   setLengthCm(String(extracted.length_cm));
    if (extracted.width_cm)    setWidthCm(String(extracted.width_cm));
    if (extracted.height_cm)   setHeightCm(String(extracted.height_cm));
    if (extracted.imageUrls.length) setExtractedImages(extracted.imageUrls);
  };

  const isEmptyExtract = (d: Awaited<ReturnType<typeof extractProductData>>) =>
    !d.name && !d.description && !d.length_cm && !d.width_cm && !d.height_cm && d.imageUrls.length === 0;

  const handleImport = async () => {
    if (!importUrl.trim() || importing) return;
    setImporting(true);
    setImportError("");
    setExtractedImages([]);
    try {
      const data = await extractProductData(importUrl.trim());
      if (isEmptyExtract(data)) {
        // Reached the page but got nothing usable — almost always anti-bot protection
        // (Cloudflare) returning a challenge page instead of the product. Offer the fallback.
        setImportError("Couldn't read this page automatically — it's likely protected by anti-bot security. Paste the page source below, or fill in the details by hand.");
        setShowPaste(true);
        return;
      }
      applyExtracted(data);
      setShowPaste(false);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
      setShowPaste(true);   // offer the paste-HTML fallback on any import failure
    } finally {
      setImporting(false);
    }
  };

  // Fallback: merchant pastes the page source their own browser loaded past Cloudflare;
  // we parse it locally with the same extractor. importUrl (already typed) resolves relative
  // image URLs. Note: image *bytes* behind Cloudflare may still fail — merchant can upload.
  const handlePasteExtract = async () => {
    if (!pastedHtml.trim() || parsingHtml) return;
    setParsingHtml(true);
    setImportError("");
    setExtractedImages([]);
    try {
      const base = importUrl.trim() || "https://example.com";
      const data = await extractProductDataFromHtml(pastedHtml.slice(0, 500_000), base);
      if (isEmptyExtract(data)) {
        setImportError("Couldn't find product details in the pasted source. Make sure you copied the whole page (Ctrl+U → Ctrl+A → Ctrl+C), or fill in the details by hand.");
        return;
      }
      applyExtracted(data);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setParsingHtml(false);
    }
  };

  const handleAddExtractedImage = async (url: string, idx: number) => {
    if (photos.length >= 2 || addingImageIdx !== null) return;
    setAddingImageIdx(idx);
    try {
      const proxyRes = await fetch(`/api/scrape?url=${encodeURIComponent(url)}&type=image`);
      if (proxyRes.ok) {
        const { data, mimeType } = await proxyRes.json();
        setPhotos((prev) => [...prev, `data:${mimeType};base64,${data}`].slice(0, 2));
      } else {
        setPhotos((prev) => [...prev, url].slice(0, 2));
      }
    } catch {
      setPhotos((prev) => [...prev, url].slice(0, 2));
    } finally {
      setAddingImageIdx(null);
    }
  };

  // Add a product photo from a pasted image URL (right-click a photo → Copy Image Address).
  // Fetches the raw bytes via the proxy and stores them at full quality — identical to an
  // uploaded file. If the host blocks the fetch, we surface an error and let the merchant
  // upload, rather than storing a fragile raw-URL reference that could break the save.
  const handleAddImageByUrl = async () => {
    const url = manualImageUrl.trim();
    if (!url || photos.length >= 2 || addingManualUrl) return;
    setAddingManualUrl(true);
    setManualImageError("");
    try {
      const proxyRes = await fetch(`/api/scrape?url=${encodeURIComponent(url)}&type=image`);
      if (!proxyRes.ok) {
        setManualImageError("Couldn't fetch that image — the host may be blocking it. Download it and upload instead.");
        return;
      }
      const { data, mimeType } = await proxyRes.json();
      if (!mimeType || !mimeType.startsWith("image/")) {
        setManualImageError("That link isn't a direct image. Right-click the photo itself → Copy Image Address.");
        return;
      }
      setPhotos((prev) => [...prev, `data:${mimeType};base64,${data}`].slice(0, 2));
      setManualImageUrl("");
    } catch {
      setManualImageError("Couldn't fetch that image. Download it and upload instead.");
    } finally {
      setAddingManualUrl(false);
    }
  };

  // ── Photo helpers ───────────────────────────────────────────────────────────
  const addPhotoFiles = (files: File[]) => {
    const slots = 2 - photos.length;
    if (slots <= 0) return;
    files.slice(0, slots).forEach((file) => {
      if (!file.type.startsWith("image/")) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        setPhotos((prev) => [...prev, e.target?.result as string].slice(0, 2));
      };
      reader.readAsDataURL(file);
    });
  };

  const handlePhotoDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setPhotoDrag(false);
    addPhotoFiles(Array.from(e.dataTransfer.files));
  };

  // Swap the perspective / front slots. gpt-image-2 synthesises the needed viewing angle at
  // placement time, so no extra "top view" images are generated or stored.
  const handleSwapPhotos = () => {
    if (photos.length !== 2) return;
    setPhotos([photos[1], photos[0]]);
  };

  // ── Save ────────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!canSave || isBusy) return;
    setSaving(true);
    setSaveError("");
    try {
      const baseImages  = photos.filter(Boolean);
      const finalImages = baseImages.slice(0, 2);

      const dims = {
        length_cm: lengthCm ? parseFloat(lengthCm) : null,
        width_cm:  widthCm  ? parseFloat(widthCm)  : null,
        height_cm: heightCm ? parseFloat(heightCm) : null,
      };

      const cat = category || null;

      if (isEditing && initialProduct) {
        await updateProduct(
          merchantId,
          initialProduct.id,
          name.trim(),
          description.trim() || name.trim(),
          finalImages,
          dims,
          cat,
        );
      } else {
        const slug = name.trim().toLowerCase()
          .replace(/[ąà]/g, "a").replace(/ć/g, "c").replace(/[ęè]/g, "e")
          .replace(/ł/g, "l").replace(/ń/g, "n").replace(/[óò]/g, "o")
          .replace(/ś/g, "s").replace(/[źż]/g, "z")
          .normalize("NFD").replace(/[̀-ͯ]/g, "")
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_+|_+$/g, "");
        const id = `${slug}_${Date.now()}`;
        await saveProduct(
          merchantId, id,
          name.trim(),
          description.trim() || name.trim(),
          finalImages,
          dims,
          cat,
        );
      }
      onSave();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  return (
    <>
    <div className="flex flex-col gap-6 max-w-lg">

      {/* ── URL import ── */}
      <div className="flex flex-col gap-2">
        <label className="text-xs uppercase tracking-widest text-muted-foreground">
          Import from product page
        </label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Link className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="url"
              placeholder="https://yourshop.com/product/..."
              value={importUrl}
              onChange={(e) => setImportUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleImport()}
              disabled={importing}
              className="w-full rounded-md border border-input bg-card pl-8 pr-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleImport}
            disabled={!importUrl.trim() || importing}
            className="gap-1.5 shrink-0"
          >
            {importing
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Importing…</>
              : <><Sparkles className="h-3.5 w-3.5" />Import</>
            }
          </Button>
        </div>
        {importError && (
          <p className="text-xs text-destructive">{importError}</p>
        )}

        {showPaste && (
          <div className="flex flex-col gap-2 rounded-md border border-input bg-card/50 p-3 mt-1">
            <p className="text-xs text-muted-foreground leading-relaxed">
              Blocked by the site's anti-bot protection. You can still import it:
              open the product page in your browser, view its source
              (<span className="font-medium">Ctrl+U</span>, or right-click →{" "}
              <span className="font-medium">View Page Source</span>), select all
              (<span className="font-medium">Ctrl+A</span>), copy, and paste it below.
            </p>
            <textarea
              value={pastedHtml}
              onChange={(e) => setPastedHtml(e.target.value)}
              placeholder="Paste the product page source here…"
              rows={4}
              disabled={parsingHtml}
              className="w-full rounded-md border border-input bg-card px-3 py-2 text-xs font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
            />
            <Button
              size="sm"
              onClick={handlePasteExtract}
              disabled={!pastedHtml.trim() || parsingHtml}
              className="gap-1.5 self-start"
            >
              {parsingHtml
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Reading…</>
                : <><Sparkles className="h-3.5 w-3.5" />Extract from pasted page</>}
            </Button>
            <p className="text-[11px] text-muted-foreground/70">
              Note: product images hosted behind the same protection may still need to be
              uploaded by hand — name, description and dimensions will fill in automatically.
            </p>
          </div>
        )}

        {extractedImages.length > 0 && (
          <div className="flex flex-col gap-2 mt-1">
            <p className="text-xs text-muted-foreground">
              {extractedImages.length} photos found — click to add ({photos.length}/2 selected):
            </p>
            <div className="flex flex-wrap gap-2">
              {extractedImages.map((url, i) => {
                const isSelected = photos.includes(url) ||
                  photos.some(p => p.includes(url.split("/").pop()?.split("?")[0] ?? "___"));
                return (
                  <button
                    key={i}
                    onClick={() => !isSelected && handleAddExtractedImage(url, i)}
                    disabled={isSelected || (photos.length >= 2 && !isSelected) || addingImageIdx !== null}
                    title={isSelected ? "Already added" : "Click to add"}
                    className={cn(
                      "relative rounded-md overflow-hidden border-2 transition-all",
                      isSelected
                        ? "border-primary/70 opacity-50 cursor-default"
                        : photos.length >= 2
                          ? "border-border opacity-30 cursor-not-allowed"
                          : "border-border hover:border-primary/60 cursor-pointer",
                    )}
                  >
                    <img
                      src={url}
                      alt=""
                      className="h-20 w-20 object-cover"
                      onError={(e) => { (e.target as HTMLImageElement).style.opacity = "0.2"; }}
                    />
                    {addingImageIdx === i && (
                      <div className="absolute inset-0 bg-background/70 flex items-center justify-center">
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      </div>
                    )}
                    {!isSelected && addingImageIdx !== i && photos.length < 2 && (
                      <div className="absolute inset-0 bg-primary/10 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center">
                        <Plus className="h-5 w-5 text-primary" />
                      </div>
                    )}
                    {isSelected && (
                      <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                        <CheckCircle className="h-5 w-5 text-primary" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="h-px bg-border" />

      {/* ── Name ── */}
      <div className="flex flex-col gap-2">
        <label className="text-xs uppercase tracking-widest text-muted-foreground">Product name</label>
        <input
          type="text"
          placeholder="e.g. Singapur Expandable Table"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded-md border border-input bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {/* ── Category ── */}
      <div className="flex flex-col gap-2">
        <label className="text-xs uppercase tracking-widest text-muted-foreground">
          Furniture category
        </label>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as FurnitureCategory | "")}
          className="rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">— select a category —</option>
          {FURNITURE_CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>
              {cat.charAt(0).toUpperCase() + cat.slice(1)}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground/70">
          Used by AI to recognise and clear the correct furniture type from your room photo.
        </p>
      </div>

      {/* ── Description ── */}
      <div className="flex flex-col gap-2">
        <label className="text-xs uppercase tracking-widest text-muted-foreground">Materials &amp; finish</label>
        <textarea
          placeholder="e.g. 'Sintered stone top with a high-gloss Calacatta Black finish; fluted MDF base in matte caramel lacquer.'"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="rounded-md border border-input bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
        />
      </div>

      {/* ── Dimensions ── */}
      <div className="flex flex-col gap-2">
        <label className="text-xs uppercase tracking-widest text-muted-foreground">
          Dimensions (cm) — length &amp; width drive AI scale accuracy
        </label>
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "Length", value: lengthCm, set: setLengthCm, key: "length" },
            { label: "Width",  value: widthCm,  set: setWidthCm,  key: "width"  },
            { label: "Height", value: heightCm, set: setHeightCm, key: "height" },
          ].map(({ label, value, set, key }) => {
            const scaleCritical = key !== "height";          // length & width drive footprint
            const missing       = scaleCritical && !value;
            return (
              <div key={label} className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">
                  {label}{scaleCritical && <span className="text-amber-500/80"> *</span>}
                </span>
                <input
                  type="number"
                  min="0"
                  placeholder="—"
                  value={value}
                  onChange={(e) => set(e.target.value)}
                  className={`rounded-md border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring [appearance:textfield] ${
                    missing ? "border-amber-500/50" : "border-input"
                  }`}
                />
              </div>
            );
          })}
        </div>
        {(!lengthCm || !widthCm) && (
          <p className="text-xs text-amber-500/90">
            ⚠ Add <span className="font-medium">length &amp; width</span> — they decide how big the item
            looks in the customer&apos;s room. Without them the size is only estimated and may render too small.
          </p>
        )}
      </div>

      {/* ── Product photos ── */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label className="text-xs uppercase tracking-widest text-muted-foreground">
            Product photos
          </label>
          <span className="text-xs text-muted-foreground/60">
            {photos.length}/2 — perspective · front
          </span>
        </div>

        {photos.length > 0 ? (
          <div className="flex gap-3">
            {photos.map((src, i) => (
              <div key={i} className="relative group">
                <img
                  src={src}
                  alt={`Photo ${i + 1}`}
                  onClick={() => setPreviewUrl(src)}
                  className="h-24 w-24 rounded-md object-cover border border-border cursor-zoom-in"
                />
                <span className="absolute bottom-1 left-1 text-[10px] bg-background/80 text-muted-foreground px-1.5 py-0.5 rounded">
                  {i === 0 ? "Perspective" : "Front"}
                </span>
                <button
                  onClick={() => setPhotos((prev) => prev.filter((_, j) => j !== i))}
                  className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-destructive text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
            {photos.length < 2 && (
              <button
                onClick={() => photoInputRef.current?.click()}
                className="h-24 w-24 rounded-md border-2 border-dashed border-border hover:border-primary/50 flex flex-col items-center justify-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
              >
                <ImagePlus className="h-5 w-5" />
                <span className="text-xs">Add</span>
              </button>
            )}
          </div>
        ) : (
          <div
            onDrop={handlePhotoDrop}
            onDragOver={(e) => { e.preventDefault(); setPhotoDrag(true); }}
            onDragLeave={() => setPhotoDrag(false)}
            onClick={() => photoInputRef.current?.click()}
            className={cn(
              "rounded-lg border-2 border-dashed p-8 flex flex-col items-center gap-3 cursor-pointer transition-colors",
              photoDrag
                ? "border-primary/60 bg-primary/5"
                : "border-border hover:border-primary/50",
            )}
          >
            <ImagePlus className="h-8 w-8 text-muted-foreground" />
            <div className="text-center">
              <p className="text-sm font-medium">Drop product photos here</p>
              <p className="text-xs text-muted-foreground mt-1">JPG, PNG, WEBP — up to 2 images</p>
            </div>
          </div>
        )}

        {photos.length === 2 && (
          <div className="flex w-[204px] justify-center">
            <button
              type="button"
              onClick={handleSwapPhotos}
              title="Swap perspective / front"
              className="flex items-center gap-1.5 h-8 px-4 rounded-full bg-primary text-primary-foreground text-xs font-semibold shadow-sm hover:bg-primary/90 active:scale-95 transition disabled:opacity-60"
            >
              <ArrowLeftRight className="h-3.5 w-3.5" />
              Swap
            </button>
          </div>
        )}

        <input
          ref={photoInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) addPhotoFiles(Array.from(e.target.files));
            e.target.value = "";
          }}
        />

        {photos.length < 2 && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Link className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <input
                  type="url"
                  placeholder="…or paste an image URL (right-click photo → Copy Image Address)"
                  value={manualImageUrl}
                  onChange={(e) => { setManualImageUrl(e.target.value); setManualImageError(""); }}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddImageByUrl(); } }}
                  disabled={addingManualUrl}
                  className="w-full rounded-md border border-input bg-card pl-8 pr-3 py-2 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
                />
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={handleAddImageByUrl}
                disabled={!manualImageUrl.trim() || addingManualUrl}
                className="gap-1.5 shrink-0"
              >
                {addingManualUrl
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Adding…</>
                  : <><Plus className="h-3.5 w-3.5" />Add</>}
              </Button>
            </div>
            {manualImageError && <p className="text-xs text-destructive">{manualImageError}</p>}
          </div>
        )}
      </div>

      {saveError && <p className="text-xs text-destructive">{saveError}</p>}

      {/* ── Actions ── */}
      <div className="flex gap-3">
        <Button
          onClick={handleSave}
          disabled={!canSave || isBusy}
          className="flex-1 gap-2"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {saving ? "Saving…" : "Save product"}
        </Button>
        <Button variant="outline" onClick={onCancel} disabled={isBusy}>
          Cancel
        </Button>
      </div>

    </div>

    {/* ── Image lightbox ── */}
    {previewUrl && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
        onClick={() => setPreviewUrl(null)}
        onKeyDown={(e) => e.key === "Escape" && setPreviewUrl(null)}
        tabIndex={-1}
      >
        <img
          src={previewUrl}
          alt="Preview"
          className="max-w-full max-h-full rounded-lg shadow-2xl object-contain"
          style={{ maxWidth: "min(90vw, 900px)", maxHeight: "90vh" }}
          onClick={(e) => e.stopPropagation()}
        />
        <button
          onClick={() => setPreviewUrl(null)}
          className="absolute top-4 right-4 h-9 w-9 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
    )}
    </>
  );
}
