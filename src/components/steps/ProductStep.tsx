import { useRef, useState } from "react";
import { Upload, ImagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { TC_MEBLE_PRODUCTS, type Product } from "@/lib/products";
import Logo from "@/components/Logo";

interface Props {
  onNext: (images: string[], description: string, name: string) => void;
}

export default function ProductStep({ onNext }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [uploadedImages, setUploadedImages] = useState<string[]>([]);
  const [uploadedName, setUploadedName] = useState("");
  const [uploadedDesc, setUploadedDesc] = useState("");
  const [mode, setMode] = useState<"catalog" | "upload">("catalog");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSelectProduct = (product: Product) => {
    setSelected(product.id);
    setMode("catalog");
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).slice(0, 2);
    if (files.length === 0) return;
    e.target.value = "";
    const readers = files.map(
      (file) =>
        new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        })
    );
    Promise.all(readers).then((dataUrls) => {
      setUploadedImages(dataUrls);
      setMode("upload");
      setSelected(null);
    });
  };

  const canProceed =
    (mode === "catalog" && selected !== null) ||
    (mode === "upload" && uploadedImages.length > 0);

  const handleNext = () => {
    if (mode === "catalog" && selected) {
      const product = TC_MEBLE_PRODUCTS.find((p) => p.id === selected)!;
      onNext(product.images, product.description, product.name);
    } else if (mode === "upload" && uploadedImages.length > 0) {
      const name = uploadedName.trim() || "product";
      const desc = uploadedDesc.trim() || name;
      onNext(uploadedImages, desc, name);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-border px-6 py-4 flex items-center justify-between">
        <Logo />
        <StepIndicator current={1} />
      </header>

      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-8 flex flex-col gap-8">
        <div>
          <h1 className="text-3xl text-primary mb-1">Choose a product</h1>
          <p className="text-sm text-muted-foreground">
            Select from the catalog or upload your own product photos.
          </p>
        </div>

        {/* Catalog grid */}
        {TC_MEBLE_PRODUCTS.length > 0 && (
          <section className="flex flex-col gap-3">
            <p className="text-xs uppercase tracking-widest text-muted-foreground">TC Meble — Sharon</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {TC_MEBLE_PRODUCTS.map((product) => (
                <button
                  key={product.id}
                  onClick={() => handleSelectProduct(product)}
                  className={cn(
                    "rounded-lg border bg-card text-left transition-all overflow-hidden",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    selected === product.id && mode === "catalog"
                      ? "border-primary ring-1 ring-primary"
                      : "border-border hover:border-primary/40"
                  )}
                >
                  <div className="aspect-[4/3] bg-secondary flex items-center justify-center overflow-hidden">
                    <img
                      src={product.thumbnail}
                      alt={product.name}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                        (e.target as HTMLImageElement).parentElement!.innerHTML =
                          `<span class="text-xs text-muted-foreground px-2 text-center">${product.name}</span>`;
                      }}
                    />
                  </div>
                  <div className="p-2.5">
                    <p className="text-xs font-medium text-foreground leading-tight">{product.name}</p>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Upload your own */}
        <section className="flex flex-col gap-3">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Or upload your own</p>
          <div
            className={cn(
              "rounded-lg border-2 border-dashed p-6 flex flex-col items-center gap-3 cursor-pointer transition-colors",
              mode === "upload" && uploadedImages.length > 0
                ? "border-primary bg-secondary/30"
                : "border-border hover:border-primary/40"
            )}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploadedImages.length > 0 ? (
              <div className="flex gap-2 flex-wrap justify-center">
                {uploadedImages.map((src, i) => (
                  <img
                    key={i}
                    src={src}
                    alt={`Product ${i + 1}`}
                    className="h-24 rounded-md object-cover border border-border"
                  />
                ))}
              </div>
            ) : (
              <>
                <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center">
                  <ImagePlus className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-foreground">Upload product photos</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Up to 2 images — perspective + front view works best
                  </p>
                </div>
              </>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleFileUpload}
            />
          </div>

          {/* Name + description for custom upload */}
          {mode === "upload" && uploadedImages.length > 0 && (
            <div className="flex flex-col gap-2">
              <input
                type="text"
                placeholder="Product name (e.g. Velvet Armchair)"
                value={uploadedName}
                onChange={(e) => setUploadedName(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <textarea
                placeholder="Describe the product for AI (e.g. 'compact velvet armchair, deep blue, gold legs')"
                value={uploadedDesc}
                onChange={(e) => setUploadedDesc(e.target.value)}
                rows={2}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
              />
            </div>
          )}
        </section>

        <Button
          onClick={handleNext}
          disabled={!canProceed}
          size="lg"
          className="w-full gap-2"
        >
          <Upload className="h-4 w-4" />
          Continue — photograph your room
        </Button>
      </main>
    </div>
  );
}

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-1.5">
      {[1, 2, 3].map((n) => (
        <div
          key={n}
          className={cn(
            "h-1.5 rounded-full transition-all",
            n === current ? "w-6 bg-primary" : n < current ? "w-3 bg-primary/40" : "w-3 bg-border"
          )}
        />
      ))}
    </div>
  );
}
