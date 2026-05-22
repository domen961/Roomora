import { useRef, useState } from "react";
import {
  Loader2, UploadCloud, CheckCircle, AlertCircle,
  X, ImagePlus, Link, Plus, Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { BabylonViewer } from "@/hooks/useBabylonViewer";
import { saveProduct, updateProduct } from "@/lib/db";
import type { Product } from "@/lib/products";
import { extractProductData } from "@/lib/gemini";

interface Props {
  viewer:          BabylonViewer;
  merchantId:      string;
  initialProduct?: Product;   // when provided, form is in edit mode
  onSave:          () => void;
  onCancel:        () => void;
}

type Phase3D = "idle" | "processing" | "ready" | "error";

export default function ProductForm({ viewer, merchantId, initialProduct, onSave, onCancel }: Props) {
  const isEditing = !!initialProduct;

  // Core fields — pre-filled from initialProduct when editing
  const [name,        setName]        = useState(initialProduct?.name        ?? "");
  const [description, setDescription] = useState(initialProduct?.description ?? "");
  const [lengthCm,    setLengthCm]    = useState(initialProduct?.length_cm   != null ? String(initialProduct.length_cm) : "");
  const [widthCm,     setWidthCm]     = useState(initialProduct?.width_cm    != null ? String(initialProduct.width_cm)  : "");
  const [heightCm,    setHeightCm]    = useState(initialProduct?.height_cm   != null ? String(initialProduct.height_cm) : "");

  // URL import
  const [importUrl,       setImportUrl]       = useState("");
  const [importing,       setImporting]       = useState(false);
  const [importError,     setImportError]     = useState("");
  const [extractedImages, setExtractedImages] = useState<string[]>([]);
  const [addingImageIdx,  setAddingImageIdx]  = useState<number | null>(null);

  // Photos (primary) — pre-filled with existing Supabase URLs when editing
  const [photos,    setPhotos]    = useState<string[]>(initialProduct?.images.filter(Boolean) ?? []);
  const [photoDrag, setPhotoDrag] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  // 3D model (optional)
  const [phase3D,  setPhase3D]  = useState<Phase3D>("idle");
  const [error3D,  setError3D]  = useState("");
  const [thumb3D,  setThumb3D]  = useState("");
  const snapshots3DRef = useRef<string[]>([]);
  const modelInputRef  = useRef<HTMLInputElement>(null);

  // Save
  const [saving,    setSaving]    = useState(false);
  const [saveError, setSaveError] = useState("");

  const canSave   = name.trim().length > 0 && (photos.length > 0 || phase3D === "ready");
  const isBusy    = importing || saving || addingImageIdx !== null;

  // ── URL import ──────────────────────────────────────────────────────────────
  const handleImport = async () => {
    if (!importUrl.trim() || importing) return;
    setImporting(true);
    setImportError("");
    setExtractedImages([]);
    try {
      const extracted = await extractProductData(importUrl.trim());
      if (extracted.name)        setName(extracted.name);
      if (extracted.description) setDescription(extracted.description);
      if (extracted.length_cm)   setLengthCm(String(extracted.length_cm));
      if (extracted.width_cm)    setWidthCm(String(extracted.width_cm));
      if (extracted.height_cm)   setHeightCm(String(extracted.height_cm));
      if (extracted.imageUrls.length) setExtractedImages(extracted.imageUrls);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  };

  // Proxy-download an extracted image URL and add to photos as data URL
  const handleAddExtractedImage = async (url: string, idx: number) => {
    if (photos.length >= 3 || addingImageIdx !== null) return;
    setAddingImageIdx(idx);
    try {
      const proxyRes = await fetch(`/api/scrape?url=${encodeURIComponent(url)}&type=image`);
      if (proxyRes.ok) {
        const { data, mimeType } = await proxyRes.json();
        setPhotos((prev) => [...prev, `data:${mimeType};base64,${data}`].slice(0, 3));
      } else {
        setPhotos((prev) => [...prev, url].slice(0, 3));
      }
    } catch {
      setPhotos((prev) => [...prev, url].slice(0, 3));
    } finally {
      setAddingImageIdx(null);
    }
  };

  // ── Photo helpers ───────────────────────────────────────────────────────────
  const addPhotoFiles = (files: File[]) => {
    const slots = 3 - photos.length;
    if (slots <= 0) return;
    files.slice(0, slots).forEach((file) => {
      if (!file.type.startsWith("image/")) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        setPhotos((prev) => [...prev, e.target?.result as string].slice(0, 3));
      };
      reader.readAsDataURL(file);
    });
  };

  const handlePhotoDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setPhotoDrag(false);
    addPhotoFiles(Array.from(e.dataTransfer.files));
  };

  // ── 3D model helpers ────────────────────────────────────────────────────────
  const handle3DFile = async (file: File) => {
    if (!viewer.isReady) {
      setError3D("3D engine unavailable in this browser — use product photos instead.");
      setPhase3D("error");
      return;
    }
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!ext || !["glb", "gltf", "obj"].includes(ext)) {
      setError3D("Unsupported format. Use GLB, GLTF, or OBJ.");
      setPhase3D("error");
      return;
    }
    setPhase3D("processing");
    setError3D("");
    try {
      const snaps = await viewer.processModel(file);
      snapshots3DRef.current = snaps;
      setThumb3D(snaps[2]);
      setPhase3D("ready");
    } catch (err) {
      setError3D(err instanceof Error ? err.message : String(err));
      setPhase3D("error");
    }
  };

  const handle3DDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handle3DFile(file);
  };

  // ── Save ────────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!canSave || isBusy) return;
    setSaving(true);
    setSaveError("");
    try {
      const s = snapshots3DRef.current;

      // Photos always win over 3D snapshots
      const finalImages = [
        photos[0] ?? s[0],
        photos[1] ?? s[1] ?? photos[0] ?? s[0],
        photos[2] ?? s[2] ?? photos[0] ?? s[0],
      ].filter(Boolean) as string[];

      const dims = {
        length_cm: lengthCm ? parseFloat(lengthCm) : null,
        width_cm:  widthCm  ? parseFloat(widthCm)  : null,
        height_cm: heightCm ? parseFloat(heightCm) : null,
      };

      if (isEditing && initialProduct) {
        // Update — keeps the same product ID
        await updateProduct(
          merchantId,
          initialProduct.id,
          name.trim(),
          description.trim() || name.trim(),
          finalImages,
          dims,
        );
      } else {
        // Create — generate a new ID from name slug + timestamp
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
        );
      }
      onSave();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  return (
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

        {/* Extracted images */}
        {extractedImages.length > 0 && (
          <div className="flex flex-col gap-2 mt-1">
            <p className="text-xs text-muted-foreground">
              {extractedImages.length} photos found — click to add ({photos.length}/3 selected):
            </p>
            <div className="flex flex-wrap gap-2">
              {extractedImages.map((url, i) => {
                const isSelected = photos.includes(url) ||
                  photos.some(p => p.includes(url.split("/").pop()?.split("?")[0] ?? "___"));
                return (
                  <button
                    key={i}
                    onClick={() => !isSelected && handleAddExtractedImage(url, i)}
                    disabled={isSelected || (photos.length >= 3 && !isSelected) || addingImageIdx !== null}
                    title={isSelected ? "Already added" : "Click to add"}
                    className={cn(
                      "relative rounded-md overflow-hidden border-2 transition-all",
                      isSelected
                        ? "border-primary/70 opacity-50 cursor-default"
                        : photos.length >= 3
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
                    {!isSelected && addingImageIdx !== i && photos.length < 3 && (
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

      {/* ── Description ── */}
      <div className="flex flex-col gap-2">
        <label className="text-xs uppercase tracking-widest text-muted-foreground">AI description</label>
        <textarea
          placeholder="e.g. 'extendable dining table, sintered stone top in Calacatta Black, fluted MDF legs in matte black finish'"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="rounded-md border border-input bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
        />
      </div>

      {/* ── Dimensions ── */}
      <div className="flex flex-col gap-2">
        <label className="text-xs uppercase tracking-widest text-muted-foreground">
          Dimensions (cm) — used for scale in AI render
        </label>
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "Length", value: lengthCm, set: setLengthCm },
            { label: "Width",  value: widthCm,  set: setWidthCm  },
            { label: "Height", value: heightCm, set: setHeightCm },
          ].map(({ label, value, set }) => (
            <div key={label} className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">{label}</span>
              <input
                type="number"
                min="0"
                placeholder="—"
                value={value}
                onChange={(e) => set(e.target.value)}
                className="rounded-md border border-input bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring [appearance:textfield]"
              />
            </div>
          ))}
        </div>
      </div>

      {/* ── Product photos ── */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label className="text-xs uppercase tracking-widest text-muted-foreground">
            Product photos
          </label>
          <span className="text-xs text-muted-foreground/60">
            {photos.length}/3 — perspective · front · material close-up
          </span>
        </div>

        {photos.length > 0 ? (
          <div className="flex gap-3">
            {photos.map((src, i) => (
              <div key={i} className="relative group">
                <img
                  src={src}
                  alt={`Photo ${i + 1}`}
                  className="h-24 w-24 rounded-md object-cover border border-border"
                />
                <span className="absolute bottom-1 left-1 text-[10px] bg-background/80 text-muted-foreground px-1.5 py-0.5 rounded">
                  {i === 0 ? "Primary" : i === 1 ? "Secondary" : "Close-up"}
                </span>
                <button
                  onClick={() => setPhotos((prev) => prev.filter((_, j) => j !== i))}
                  className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-destructive text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
            {photos.length < 3 && (
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
              <p className="text-xs text-muted-foreground mt-1">JPG, PNG, WEBP — up to 3 images</p>
            </div>
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
      </div>

      {/* ── 3D model (optional) ── */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label className="text-xs uppercase tracking-widest text-muted-foreground">3D model</label>
          <span className="text-xs text-muted-foreground/60">Optional — generates extra angle views</span>
        </div>

        <div
          onDrop={handle3DDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() =>
            (phase3D === "idle" || phase3D === "error" || phase3D === "ready")
              ? modelInputRef.current?.click()
              : null
          }
          className={cn(
            "rounded-lg border-2 border-dashed p-5 flex flex-col items-center gap-3 transition-colors",
            phase3D === "idle" || phase3D === "error"
              ? "border-border hover:border-primary/50 cursor-pointer"
              : "border-border",
            phase3D === "ready" && "border-primary/40 bg-primary/5",
          )}
        >
          {phase3D === "idle" && (
            <>
              <UploadCloud className="h-7 w-7 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Drop GLB, GLTF, or OBJ</p>
            </>
          )}
          {phase3D === "processing" && (
            <>
              <Loader2 className="h-7 w-7 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Processing 3D model…</p>
              <p className="text-xs text-muted-foreground opacity-60">Generating snapshots from 4 angles</p>
            </>
          )}
          {phase3D === "ready" && (
            <div className="flex items-center gap-4 w-full">
              <img src={thumb3D} alt="3D preview" className="h-14 w-14 rounded-md object-cover border border-border flex-shrink-0" />
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <CheckCircle className="h-4 w-4 text-primary flex-shrink-0" />
                  <span className="text-sm font-medium">Model processed — 4 snapshots ready</span>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); modelInputRef.current?.click(); }}
                  className="text-xs text-muted-foreground underline hover:text-foreground"
                >
                  Replace model
                </button>
              </div>
            </div>
          )}
          {phase3D === "error" && (
            <>
              <AlertCircle className="h-7 w-7 text-destructive" />
              <p className="text-sm text-destructive text-center">{error3D}</p>
              <p className="text-xs text-muted-foreground">Click to try again</p>
            </>
          )}
        </div>

        <input
          ref={modelInputRef}
          type="file"
          accept=".glb,.gltf,.obj"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handle3DFile(f);
            e.target.value = "";
          }}
        />
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
          {saving ? "Saving…" : isEditing ? "Update product" : "Save product"}
        </Button>
        <Button variant="outline" onClick={onCancel} disabled={isBusy}>
          Cancel
        </Button>
      </div>

    </div>
  );
}
