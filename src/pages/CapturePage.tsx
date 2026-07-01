import { useParams } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { Camera, Download, ImageIcon, Loader2, AlertCircle, RefreshCw, RotateCcw, Share2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { getProducts, getVariants, type ProductVariant } from "@/lib/db";
import { placeInRoom } from "@/lib/gemini";
import { consumeGenPoint } from "@/lib/quota";
import Logo from "@/components/Logo";
import VariantPicker from "@/components/VariantPicker";
import type { Product } from "@/lib/products";

type Phase = "idle" | "generating" | "result" | "error";

export default function CapturePage() {
  const { token, merchantId, productId } = useParams<{
    token: string;
    merchantId?: string;
    productId?: string;
  }>();

  const isDirectMode = !!(merchantId && productId);

  // Product (loaded when in direct mode)
  const [product,       setProduct]       = useState<Product | null>(null);
  const [variants,      setVariants]      = useState<ProductVariant[]>([]);
  const [variantIndex,  setVariantIndex]  = useState(0);   // 0 = base product

  useEffect(() => {
    if (!isDirectMode || !merchantId || !productId) return;
    getProducts(merchantId)
      .then((list) => {
        const p = list.find((p) => p.id === productId);
        if (p) {
          setProduct(p);
          // Load variants alongside product
          getVariants(merchantId, productId)
            .then(setVariants)
            .catch(console.error);
        }
      })
      .catch(console.error);
  }, [isDirectMode, merchantId, productId]);

  // Camera
  const videoRef   = useRef<HTMLVideoElement>(null);
  const streamRef  = useRef<MediaStream | null>(null);
  const [cameraReady,  setCameraReady]  = useState(false);
  const [cameraFailed, setCameraFailed] = useState(false);
  const [cameraKey,    setCameraKey]    = useState(0);

  const galleryInputRef  = useRef<HTMLInputElement>(null);
  const fallbackInputRef = useRef<HTMLInputElement>(null);

  const [phase,       setPhase]       = useState<Phase>("idle");
  const [error,       setError]       = useState("");
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [lastPhoto,   setLastPhoto]   = useState<string>("");
  const regenCountRef = useRef(0);   // regenerations of the current photo (1st is free)

  // ── Camera startup ────────────────────────────────────────────────────────
  useEffect(() => {
    if (cameraFailed) return;
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices
          .getUserMedia({
            video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
          })
          .catch(() => navigator.mediaDevices.getUserMedia({ video: true }));

        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setCameraReady(true);
        }
      } catch {
        if (!cancelled) setCameraFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setCameraReady(false);
    };
  }, [cameraKey, cameraFailed]);

  // ── Process a photo (direct mode: call Gemini right here on the phone) ─────
  const processPhoto = async (photo: string, isRegen = false) => {
    if (!token) return;
    setLastPhoto(photo);   // store for regenerate
    setPhase("generating");

    // First regeneration of a photo is free; the initial generation and any later
    // regenerations consume a Gen Point. A new photo resets the free-regen allowance.
    let charge = true;
    if (isRegen) {
      regenCountRef.current += 1;
      if (regenCountRef.current === 1) charge = false;  // first regen free
    } else {
      regenCountRef.current = 0;
    }

    try {
      if (isDirectMode && product) {
        // ── DIRECT MODE: phone runs Gemini itself ────────────────────────────
        // Check Gen Point quota before calling Gemini
        if (charge) {
          const quota = await consumeGenPoint(merchantId);
          if (!quota.ok) {
            setPhase("error");
            setError("This store has used all its Gen Points for this period.");
            return;
          }
        }

        // Use the selected variant's images, or the base product images if index 0
        const activeImages = variantIndex === 0
          ? product.images
          : (variants[variantIndex - 1]?.images ?? product.images);

        const result = await placeInRoom(
          activeImages,
          photo,
          product.name,
          product.description,
          {
            length_cm: product.length_cm ?? undefined,
            width_cm:  product.width_cm  ?? undefined,
            height_cm: product.height_cm ?? undefined,
          },
          product.category,
        );
        setResultImage(result);
        setPhase("result");

        // Save compressed result to Supabase so desktop can pick it up too
        compressDataUrl(result, 700, 0.70).then((compressed) => {
          supabase.from("room_captures")
            .upsert({ token, result: compressed })
            .then(() => {
              setTimeout(() => {
                supabase.from("room_captures").delete().eq("token", token).then(() => {});
              }, 900_000);
            });
        });

      } else {
        // ── RELAY MODE (legacy): upload photo, wait for desktop ──────────────
        const { error: dbError } = await supabase
          .from("room_captures")
          .upsert({ token, photo, result: null });
        if (dbError) throw new Error(dbError.message);
        // result will arrive via the Realtime subscription below
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate");
      setPhase("error");
    }
  };

  // ── Relay mode: subscribe for result coming back from desktop ─────────────
  useEffect(() => {
    if (!token || isDirectMode) return;
    const channel = supabase
      .channel("capture_result:" + token)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "room_captures", filter: `token=eq.${token}` },
        (payload) => {
          const result = (payload.new as { result: string | null }).result;
          if (result) { setResultImage(result); setPhase("result"); }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [token, isDirectMode]);

  // ── Capture live frame ────────────────────────────────────────────────────
  const handleCapture = async () => {
    const video = videoRef.current;
    if (!video || !token) return;

    // Draw the frame BEFORE stopping the stream — stopping first can blank the video
    const maxPx = 1280;
    const scale = Math.min(1, maxPx / Math.max(video.videoWidth || 1280, video.videoHeight || 720));
    const canvas = document.createElement("canvas");
    canvas.width  = Math.round((video.videoWidth  || 1280) * scale);
    canvas.height = Math.round((video.videoHeight || 720)  * scale);
    canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
    const photo = canvas.toDataURL("image/jpeg", 0.92);

    streamRef.current?.getTracks().forEach((t) => t.stop());
    await processPhoto(photo);
  };

  // ── Pick from gallery ─────────────────────────────────────────────────────
  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !token) return;
    e.target.value = "";
    streamRef.current?.getTracks().forEach((t) => t.stop());
    try {
      const photo = await compressImage(file, 1024, 0.85);
      await processPhoto(photo);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to process image");
      setPhase("error");
    }
  };

  // ── Retry ────────────────────────────────────────────────────────────────
  const handleRetry = () => {
    setResultImage(null);
    setPhase("idle");
    setCameraKey((k) => k + 1);
  };

  // ─────────────────────────────────────────────────────────────────────────
  // RESULT SCREEN
  // ─────────────────────────────────────────────────────────────────────────
  if (phase === "result" && resultImage) {
    const filename = `furora-${product?.name?.replace(/\s+/g, "-").toLowerCase() ?? "result"}.jpg`;
    const handleShare = async () => {
      try {
        const res  = await fetch(resultImage);
        const blob = await res.blob();
        const file = new File([blob], filename, { type: "image/jpeg" });
        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], title: product?.name ? `${product.name} in your room` : "Your room" });
        } else {
          const a = document.createElement("a"); a.href = resultImage; a.download = filename; a.click();
        }
      } catch { /* cancelled */ }
    };
    return (
      <div className="relative w-full bg-background overflow-hidden" style={{ height: "100dvh" }}>
        <img src={resultImage} alt="Your room with the furniture"
          className="absolute inset-0 w-full h-full object-contain" />
        <div className="absolute bottom-0 left-0 right-0 h-48 bg-gradient-to-t from-black/80 to-transparent pointer-events-none" />
        <div className="absolute top-8 left-0 right-0 flex items-center justify-between px-6">
          <div className="w-10" />
          <div className="pointer-events-none"><Logo /></div>
          <button onClick={handleShare}
            className="w-10 h-10 rounded-full bg-white/20 backdrop-blur-sm border border-white/30
                       flex items-center justify-center active:scale-95 transition-transform shadow-lg"
            aria-label="Share">
            <Share2 className="h-5 w-5 text-white" />
          </button>
        </div>
        <div className="absolute bottom-10 left-0 right-0 flex flex-col items-center gap-3 px-6">
          <p className="text-white/80 text-sm font-light">Here's your room ✨</p>
          {/* Primary actions: Retry + Download */}
          <div className="flex gap-3 w-full max-w-xs">
            <button onClick={handleRetry}
              className="flex-1 flex items-center justify-center gap-2 rounded-xl border-2 border-white/40 bg-white/10 backdrop-blur-sm py-3 text-sm font-medium text-white active:scale-95 transition-transform">
              <RotateCcw className="h-4 w-4" />Retry
            </button>
            <button
              onClick={() => {
                const a = document.createElement("a");
                a.href = resultImage;
                a.download = `furora-${product?.name?.replace(/\s+/g, "-").toLowerCase() ?? "result"}.jpg`;
                a.click();
              }}
              className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-black active:scale-95 transition-transform">
              <Download className="h-4 w-4" />Download
            </button>
          </div>
          {/* Regenerate — separated with hint */}
          {lastPhoto && (
            <div className="flex flex-col items-center gap-1.5 w-full max-w-xs">
              <p className="text-white/45 text-xs">Result looks unrealistic? Try again with a new generation.</p>
              <button onClick={() => processPhoto(lastPhoto, true)}
                className="w-full flex items-center justify-center gap-2 rounded-xl border border-white/25 bg-white/5 backdrop-blur-sm py-2.5 text-sm font-medium text-white/70 active:scale-95 transition-transform">
                <RefreshCw className="h-4 w-4" />Regenerate
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GENERATING SCREEN
  // ─────────────────────────────────────────────────────────────────────────
  if (phase === "generating") {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-6 px-6 text-center">
        <Logo />
        <Loader2 className="h-14 w-14 animate-spin text-primary" />
        <div>
          <p className="text-base font-medium text-foreground">
            {isDirectMode ? "Placing the product in your room…" : "Sending photo…"}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            {isDirectMode ? "Usually 20–30 seconds" : "Uploading to server"}
          </p>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ERROR SCREEN
  // ─────────────────────────────────────────────────────────────────────────
  if (phase === "error") {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-6 px-6 text-center">
        <Logo />
        <AlertCircle className="h-12 w-12 text-destructive" />
        <p className="text-sm text-destructive max-w-xs">{error}</p>
        <button
          onClick={() => { setPhase("idle"); setError(""); setCameraKey((k) => k + 1); }}
          className="text-xs text-muted-foreground hover:text-foreground underline"
        >
          Try again
        </button>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // FALLBACK: camera denied
  // ─────────────────────────────────────────────────────────────────────────
  if (cameraFailed) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-10 px-6 text-center">
        <Logo />
        <div>
          <h1 className="text-2xl font-light text-primary mb-2">Photograph your room</h1>
          <p className="text-sm text-muted-foreground max-w-xs">
            Point where you'd like the furniture. Any existing piece of the same type is replaced automatically — no need to clear the room first.
          </p>
        </div>
        <button
          onClick={() => fallbackInputRef.current?.click()}
          className="w-32 h-32 rounded-full bg-primary/10 border-2 border-primary/40 hover:bg-primary/20 flex items-center justify-center transition-colors active:scale-95"
        >
          <Camera className="h-14 w-14 text-primary" />
        </button>
        <input ref={fallbackInputRef} type="file" accept="image/*" capture="environment"
          className="hidden" onChange={handleFile} />
        <p className="text-xs text-muted-foreground">Natural lighting gives the best results</p>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PRIMARY: live camera
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="relative w-full bg-black overflow-hidden" style={{ height: "100dvh" }}>
      <video ref={videoRef} playsInline muted
        className="absolute inset-0 w-full h-full object-cover" />

      {/* Top gradient for text readability */}
      <div
        className="absolute top-0 left-0 right-0 pointer-events-none"
        style={{ height: "55%", background: "linear-gradient(to bottom, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.45) 45%, rgba(0,0,0,0) 100%)" }}
      />

      {!cameraReady && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-white/60" />
        </div>
      )}

      {cameraReady && (
        <div className="absolute inset-0 flex flex-col items-center justify-between py-12 px-6 text-center">
          <div className="flex flex-col items-center gap-4">
            <Logo />
            <div>
              <h1 className="text-2xl font-light text-primary"
                style={{ textShadow: "0 1px 4px rgba(0,0,0,0.6)" }}>
                Photograph your room
              </h1>
              <p className="text-sm text-white/70 mt-1 max-w-xs">
                Point where you'd like the furniture. Any existing piece of the same type is replaced automatically — no need to clear the room first.
              </p>
            </div>
          </div>

          <div className="flex flex-col items-center gap-4">
            <div className="flex items-center justify-center gap-8">
              <button onClick={() => galleryInputRef.current?.click()}
                className="w-14 h-14 rounded-full border-2 border-white/60 bg-white/10 backdrop-blur-sm flex items-center justify-center active:scale-95 transition-transform shadow-lg"
                aria-label="Choose from gallery">
                <ImageIcon className="h-6 w-6 text-white" />
              </button>
              <button onClick={handleCapture}
                className="w-20 h-20 rounded-full border-4 border-white bg-white/20 backdrop-blur-sm flex items-center justify-center active:scale-95 transition-transform shadow-lg"
                aria-label="Take photo">
                <Camera className="h-9 w-9 text-white" />
              </button>
              {variants.length > 0 ? (
                <VariantPicker
                  base={{ name: product?.name ?? "", imageUrl: product?.images[0] ?? null }}
                  variants={variants}
                  selectedIndex={variantIndex}
                  onSelect={setVariantIndex}
                />
              ) : (
                <div className="w-14 h-14" />
              )}
            </div>
            <p className="text-xs text-white/50">Natural lighting gives the best results</p>
          </div>
        </div>
      )}

      <input ref={galleryInputRef} type="file" accept="image/*"
        className="hidden" onChange={handleFile} />
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function compressImage(file: File, maxPx: number, quality: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width  = Math.round(img.width  * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = url;
  });
}

function compressDataUrl(dataUrl: string, maxPx: number, quality: number): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width  = Math.round(img.width  * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}
