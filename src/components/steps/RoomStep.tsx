import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Camera, Check, ImageIcon, Loader2, Smartphone } from "lucide-react";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { placeInRoom } from "@/lib/gemini";
import { supabase } from "@/lib/supabase";
import Logo from "@/components/Logo";

interface Props {
  product:    { images: string[]; description: string; name: string; id: string; length_cm?: number | null; width_cm?: number | null; height_cm?: number | null };
  merchantId: string;
  onResult:   (resultUrl: string) => void;
  onBack:     () => void;
}

const isMobile =
  typeof navigator !== "undefined" &&
  (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

type Phase = "idle" | "processing" | "error";

export default function RoomStep({ product, merchantId, onResult, onBack }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [cameraReady, setCameraReady] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // QR / phone capture state (desktop only)
  const token = useMemo(() => crypto.randomUUID(), []);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [phoneStatus, setPhoneStatus] = useState<"waiting" | "received">("waiting");

  // Include merchantId + productId so the phone can call Gemini directly
  const captureUrl = useMemo(
    () => `${window.location.origin}/capture/${token}/${merchantId}/${product.id}`,
    [token, merchantId, product.id]
  );
  const isLocalhost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

  // Generate QR code (amber on dark, on-brand)
  useEffect(() => {
    if (isMobile) return;
    QRCode.toDataURL(captureUrl, {
      width: 280,
      margin: 2,
      color: { dark: "#F59E0B", light: "#1c1c1c" },
    })
      .then(setQrDataUrl)
      .catch(console.error);
  }, [captureUrl]);

  // Subscribe to Supabase Realtime for phone photo
  useEffect(() => {
    if (isMobile) return;
    const channel = supabase
      .channel("room_captures:" + token)
      .on(
        "postgres_changes",
        {
          event: "*",  // catch both INSERT (first shot) and UPDATE (retry)
          schema: "public",
          table: "room_captures",
          filter: `token=eq.${token}`,
        },
        (payload) => {
          const row = payload.new as { photo?: string; result: string | null };
          if (row.result) {
            // Direct mode: phone already ran Gemini — just surface the result
            setPhoneStatus("received");
            onResult(row.result);
          } else if (row.photo && !row.result) {
            // Relay mode (legacy): desktop processes the photo
            setPhoneStatus("received");
            processRoomPhoto(row.photo, token);
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Start camera on mobile
  useEffect(() => {
    if (!isMobile) return;
    (async () => {
      try {
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
          });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({ video: true });
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) { video.srcObject = stream; await video.play(); setCameraReady(true); }
      } catch (err: unknown) {
        const name = (err as { name?: string })?.name;
        setErrorMsg(name === "NotAllowedError" ? "Camera access denied." : `Camera error: ${name}`);
        setPhase("error");
      }
    })();
    return () => streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const processRoomPhoto = useCallback(
    async (roomPhoto: string, captureToken?: string) => {
      setPhase("processing");
      try {
        const result = await placeInRoom(product.images, roomPhoto, product.description);

        // Save compressed result back to room_captures so phone can display it
        if (captureToken) {
          compressDataUrl(result, 700, 0.70).then((compressed) => {
            supabase
              .from("room_captures")
              .update({ result: compressed })
              .eq("token", captureToken)
              .then(() => {
                // Auto-clean after 15 minutes
                setTimeout(() => {
                  supabase.from("room_captures").delete().eq("token", captureToken).then(() => {});
                }, 900_000);
              });
          });
        }

        onResult(result);
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : String(err));
        setPhase("error");
      }
    },
    [product, onResult]
  );

  const handleCapture = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
    const roomPhoto = canvas.toDataURL("image/jpeg", 0.92);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    processRoomPhoto(roomPhoto);
  }, [processRoomPhoto]);

  const handleGallery = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = "";
      streamRef.current?.getTracks().forEach((t) => t.stop());
      const reader = new FileReader();
      reader.onload = () => processRoomPhoto(reader.result as string);
      reader.readAsDataURL(file);
    },
    [processRoomPhoto]
  );

  // ── Processing ──────────────────────────────────────────────────────────────
  if (phase === "processing") {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-5 text-foreground px-6 text-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <div>
          <p className="font-serif text-2xl mb-1">Placing the product in your room…</p>
          <p className="text-xs uppercase tracking-widest opacity-50">Usually 30–60 seconds</p>
        </div>
      </div>
    );
  }

  // ── Error ───────────────────────────────────────────────────────────────────
  if (phase === "error") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-5 px-6 text-center">
        <p className="font-serif text-xl text-primary">Something went wrong</p>
        <p className="text-sm text-destructive max-w-xs">{errorMsg}</p>
        <div className="flex gap-3">
          <Button variant="outline" onClick={() => { setPhase("idle"); setErrorMsg(""); }}>
            Try again
          </Button>
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 mr-1" />Back
          </Button>
        </div>
      </div>
    );
  }

  // ── Mobile: live camera ─────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div className="relative w-full bg-black overflow-hidden" style={{ height: "100dvh" }}>
        <video ref={videoRef} playsInline muted className="absolute inset-0 w-full h-full object-cover" />

        {!cameraReady && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white pointer-events-none">
            <Loader2 className="h-8 w-8 animate-spin opacity-70" />
            <span className="text-xs uppercase tracking-widest opacity-60">Starting camera…</span>
          </div>
        )}

        <div className="absolute top-0 left-0 right-0 z-10 px-4 pt-safe-top pt-4 pointer-events-none">
          <div className="pointer-events-auto inline-block">
            <button
              onClick={onBack}
              className="flex items-center gap-1.5 text-xs uppercase tracking-widest text-white/70 hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" />Back
            </button>
          </div>
          <div className="mt-2 inline-block ml-4 bg-black/40 backdrop-blur-sm rounded-full px-3 py-1 pointer-events-auto">
            <span className="text-xs text-white/80">{product.name}</span>
          </div>
        </div>

        {cameraReady && (
          <p className="absolute bottom-32 left-0 right-0 text-center text-[0.65rem] uppercase tracking-widest text-white/50 pointer-events-none">
            Point at your room
          </p>
        )}

        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleGallery} />

        {cameraReady && (
          <div className="absolute bottom-8 left-0 right-0 flex items-center justify-center gap-8 z-10">
            <button
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "w-14 h-14 rounded-full border-2 border-white/60 bg-white/10 backdrop-blur-sm",
                "flex items-center justify-center active:scale-95 transition-transform shadow-lg"
              )}
              aria-label="Choose from gallery"
            >
              <ImageIcon className="h-6 w-6 text-white" />
            </button>
            <button
              onClick={handleCapture}
              className={cn(
                "w-20 h-20 rounded-full border-4 border-white bg-white/20 backdrop-blur-sm",
                "flex items-center justify-center active:scale-95 transition-transform shadow-lg"
              )}
              aria-label="Capture"
            >
              <Camera className="h-8 w-8 text-white" />
            </button>
            <div className="w-14 h-14" />
          </div>
        )}
      </div>
    );
  }

  // ── Desktop: QR code primary, upload secondary ──────────────────────────────
  return (
    <div className="flex flex-col">
      <header className="border-b border-border px-5 py-3 flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        <Logo />
        <StepIndicator current={2} />
      </header>

      <main className="max-w-md mx-auto w-full px-6 py-5 flex flex-col gap-5 items-center text-center">
        <div>
          <h1 className="text-2xl text-primary mb-0.5">Photograph your room</h1>
          <p className="text-sm text-muted-foreground">
            Use your phone — just scan the code below
          </p>
        </div>

        {/* ── QR code (primary) ── */}
        <div className="flex flex-col items-center gap-3">
          {qrDataUrl ? (
            <div className="p-3 rounded-2xl bg-[#1c1c1c] border border-border shadow-lg">
              <img src={qrDataUrl} alt="Scan to open camera on phone" width={248} height={248} />
            </div>
          ) : (
            <div className="w-[272px] h-[272px] rounded-2xl bg-secondary animate-pulse" />
          )}

          <div className="flex flex-col items-center gap-1">
            {phoneStatus === "received" ? (
              <p className="text-sm text-primary flex items-center gap-1.5 font-medium">
                <Check className="h-4 w-4" /> Photo received — processing…
              </p>
            ) : (
              <>
                <p className="text-sm font-medium flex items-center gap-1.5">
                  <Smartphone className="h-4 w-4 text-primary" />
                  Scan with your phone
                </p>
                {isLocalhost ? (
                  <p className="text-xs text-amber-500 max-w-[240px]">
                    ⚠️ Open the app via your <strong>network IP</strong> (e.g.{" "}
                    <code className="font-mono">192.168.x.x:5173</code>) — phones can't reach{" "}
                    <code className="font-mono">localhost</code>
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">Opens the camera directly on your device</p>
                )}
              </>
            )}
          </div>
        </div>

        {/* ── Divider ── */}
        <div className="flex items-center gap-3 w-full">
          <div className="flex-1 h-px bg-border" />
          <span className="text-xs text-muted-foreground">or upload from this device</span>
          <div className="flex-1 h-px bg-border" />
        </div>

        {/* ── File upload (secondary) ── */}
        <button
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            "w-full flex items-center gap-3 rounded-lg border border-border hover:border-primary/40",
            "px-4 py-3 cursor-pointer transition-colors group text-left"
          )}
        >
          <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center flex-shrink-0 group-hover:bg-primary/10 transition-colors">
            <ImageIcon className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">Upload a room photo</p>
            <p className="text-xs text-muted-foreground">JPG or PNG — natural lighting works best</p>
          </div>
        </button>

        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleGallery} />
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

/** Compress a data URL to max dimensions for mobile transfer */
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
