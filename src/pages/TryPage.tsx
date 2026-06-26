import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import RoomStep from "@/components/steps/RoomStep";
import ResultStep from "@/components/steps/ResultStep";
import { getProducts } from "@/lib/db";
import type { Product } from "@/lib/products";

type Phase = "loading" | "room" | "result" | "error";

export default function TryPage() {
  const { shopId, productId } = useParams<{ shopId: string; productId: string }>();

  const [phase,         setPhase]         = useState<Phase>("loading");
  const [product,       setProduct]       = useState<{ id: string; images: string[]; description: string; name: string; category: string | null; length_cm: number | null; width_cm: number | null; height_cm: number | null } | null>(null);
  const [result,        setResult]        = useState<string | null>(null);
  const [error,         setError]         = useState("");
  const [lastRoomPhoto, setLastRoomPhoto] = useState<string>("");
  const [regenerating,  setRegenerating]  = useState(false);

  // Auto-resize the embed iframe by reporting content height to parent window
  useEffect(() => {
    if (window.parent === window) return;
    const send = () =>
      window.parent.postMessage(
        { type: "furora:resize", height: document.documentElement.scrollHeight },
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
        setProduct({ id: found.id, images: found.images, description: found.description, name: found.name, category: found.category, length_cm: found.length_cm, width_cm: found.width_cm, height_cm: found.height_cm });
        setPhase("room");
      })
      .catch((err: Error) => { setError(err.message); setPhase("error"); });
  }, [shopId, productId]);

  const handleClose = () => {
    // Send close message to the embed parent page
    if (window.parent !== window) {
      window.parent.postMessage("furora:close", "*");
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
    return (
      <RoomStep
        product={product}
        merchantId={shopId!}
        onPhotoReady={(photo) => setLastRoomPhoto(photo)}
        autoProcessPhoto={regenerating ? lastRoomPhoto : undefined}
        onResult={(r) => { setRegenerating(false); setResult(r); setPhase("result"); }}
        onBack={handleClose}
      />
    );
  }

  return null;
}
