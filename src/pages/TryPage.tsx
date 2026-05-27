import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import RoomStep from "@/components/steps/RoomStep";
import ResultStep from "@/components/steps/ResultStep";
import { getProducts, getVariants, type ProductVariant } from "@/lib/db";
import type { Product } from "@/lib/products";

type Phase = "loading" | "room" | "result" | "error";

export default function TryPage() {
  const { shopId, productId } = useParams<{ shopId: string; productId: string }>();

  const [phase,         setPhase]         = useState<Phase>("loading");
  const [product,       setProduct]       = useState<{ id: string; images: string[]; description: string; name: string; length_cm: number | null; width_cm: number | null; height_cm: number | null } | null>(null);
  const [variants,      setVariants]      = useState<ProductVariant[]>([]);
  const [variantIndex,  setVariantIndex]  = useState(0);   // 0 = base product
  const [result,        setResult]        = useState<string | null>(null);
  const [error,         setError]         = useState("");
  const [lastRoomPhoto, setLastRoomPhoto] = useState<string>("");
  const [regenerating,  setRegenerating]  = useState(false);

  // Auto-resize the embed iframe by reporting content height to parent window
  useEffect(() => {
    if (window.parent === window) return;
    const send = () =>
      window.parent.postMessage(
        { type: "roomora:resize", height: document.documentElement.scrollHeight },
        "*",
      );
    const ro = new ResizeObserver(send);
    ro.observe(document.documentElement);
    send();
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!shopId || !productId) { setError("Invalid link."); setPhase("error"); return; }

    getProducts(shopId)
      .then((products: Product[]) => {
        const found = products.find((p) => p.id === productId);
        if (!found) {
          const msg = products.length === 0
            ? "No products found for this shop. Make sure the product is saved in the admin panel and that the Supabase 'public_read_products' RLS policy is enabled."
            : `Product "${productId}" not found. Available IDs: ${products.map((p) => p.id).join(", ")}`;
          setError(msg);
          setPhase("error");
          return;
        }
        setProduct({ id: found.id, images: found.images, description: found.description, name: found.name, length_cm: found.length_cm, width_cm: found.width_cm, height_cm: found.height_cm });
        // Load variants alongside product
        getVariants(shopId!, found.id)
          .then(setVariants)
          .catch(console.error);
        setPhase("room");
      })
      .catch((err: Error) => { setError(err.message); setPhase("error"); });
  }, [shopId, productId]);

  const handleClose = () => {
    // Send close message to the embed parent page
    if (window.parent !== window) {
      window.parent.postMessage("roomora:close", "*");
    } else {
      window.history.back();
    }
  };

  if (phase === "loading") {
    return (
      <div className="h-64 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="h-64 flex flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="font-serif text-xl text-primary">Oops</p>
        <p className="text-sm text-muted-foreground max-w-xs">{error}</p>
        <button onClick={handleClose} className="text-xs text-muted-foreground underline">Close</button>
      </div>
    );
  }

  if (phase === "result" && result && product) {
    return (
      <ResultStep
        result={result}
        productName={product.name}
        onReset={() => { setResult(null); setLastRoomPhoto(""); setRegenerating(false); setPhase("room"); }}
        onRegenerate={lastRoomPhoto ? () => { setResult(null); setRegenerating(true); setPhase("room"); } : undefined}
      />
    );
  }

  if (phase === "room" && product) {
    const activeImages = variantIndex === 0
      ? product.images
      : (variants[variantIndex - 1]?.images ?? product.images);

    return (
      <div className="relative">
        <RoomStep
          product={product}
          merchantId={shopId!}
          onPhotoReady={(photo) => setLastRoomPhoto(photo)}
          autoProcessPhoto={regenerating ? lastRoomPhoto : undefined}
          onResult={(r) => { setRegenerating(false); setResult(r); setPhase("result"); }}
          onBack={handleClose}
          productImagesOverride={variantIndex !== 0 ? activeImages : undefined}
        />

        {/* Variant thumbnail strip — shown only when variants exist */}
        {variants.length > 0 && (
          <div className="absolute bottom-28 left-0 right-0 flex justify-center pointer-events-none z-10">
            <div className="flex gap-2 bg-black/60 backdrop-blur-sm rounded-full px-3 py-2 pointer-events-auto">
              {/* Base */}
              <button
                onClick={() => setVariantIndex(0)}
                className={`relative w-10 h-10 rounded-full overflow-hidden border-2 transition-all flex-shrink-0 ${
                  variantIndex === 0 ? "border-white" : "border-white/30"
                }`}
              >
                {product.images[0] ? (
                  <img src={product.images[0]} alt="Base" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-white/10" />
                )}
              </button>

              {/* Variants */}
              {variants.map((v, i) => (
                <button
                  key={v.id}
                  onClick={() => setVariantIndex(i + 1)}
                  className={`relative w-10 h-10 rounded-full overflow-hidden border-2 transition-all flex-shrink-0 ${
                    variantIndex === i + 1 ? "border-white" : "border-white/30"
                  }`}
                  title={v.name}
                >
                  {v.images[0] ? (
                    <img src={v.images[0]} alt={v.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-white/20 flex items-center justify-center">
                      <span className="text-[8px] text-white/60">{v.name.slice(0, 2)}</span>
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return null;
}
