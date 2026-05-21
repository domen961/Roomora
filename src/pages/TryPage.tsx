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

  const [phase,   setPhase]   = useState<Phase>("loading");
  const [product, setProduct] = useState<{ images: string[]; description: string; name: string } | null>(null);
  const [result,  setResult]  = useState<string | null>(null);
  const [error,   setError]   = useState("");

  useEffect(() => {
    if (!shopId || !productId) { setError("Invalid link."); setPhase("error"); return; }

    getProducts(shopId)
      .then((products: Product[]) => {
        const found = products.find((p) => p.id === productId);
        if (!found) { setError("Product not found."); setPhase("error"); return; }
        setProduct({ images: found.images, description: found.description, name: found.name });
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
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-6 text-center">
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
        onReset={handleClose}
      />
    );
  }

  if (phase === "room" && product) {
    return (
      <RoomStep
        product={product}
        onResult={(r) => { setResult(r); setPhase("result"); }}
        onBack={handleClose}
      />
    );
  }

  return null;
}
