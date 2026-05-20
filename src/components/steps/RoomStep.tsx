import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Camera, ImageIcon, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { placeInRoom } from "@/lib/gemini";

interface Props {
  product: { images: string[]; description: string; name: string };
  onResult: (resultUrl: string) => void;
  onBack: () => void;
}

const isMobile =
  typeof navigator !== "undefined" &&
  (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

type Phase = "idle" | "processing" | "error";

export default function RoomStep({ product, onResult, onBack }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [cameraReady, setCameraReady] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

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
    async (roomPhoto: string) => {
      setPhase("processing");
      try {
        const result = await placeInRoom(product.images, roomPhoto, product.description);
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
      <div className="min-h-screen bg-primary flex flex-col items-center justify-center gap-5 text-primary-foreground px-6 text-center">
        <Loader2 className="h-10 w-10 animate-spin opacity-70" />
        <div>
          <p className="font-serif text-2xl mb-1">Placing in your room…</p>
          <p className="text-xs uppercase tracking-widest opacity-50">Gemini AI is working</p>
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

  // ── Desktop: upload ─────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-border px-6 py-4 flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        <span className="font-serif text-xl text-primary">Roomora</span>
        <StepIndicator current={2} />
      </header>

      <main className="flex-1 max-w-lg mx-auto w-full px-4 py-12 flex flex-col gap-8 items-center text-center">
        <div>
          <h1 className="text-3xl text-primary mb-1">Photograph your room</h1>
          <p className="text-sm text-muted-foreground">
            Upload a photo of the room where you'd like to place <strong>{product.name}</strong>.
          </p>
        </div>

        <button
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            "w-full rounded-xl border-2 border-dashed border-border hover:border-primary/40",
            "p-12 flex flex-col items-center gap-4 cursor-pointer transition-colors group"
          )}
        >
          <div className="w-14 h-14 rounded-full bg-secondary flex items-center justify-center group-hover:bg-primary/10 transition-colors">
            <Camera className="h-7 w-7 text-muted-foreground group-hover:text-primary transition-colors" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">Upload a room photo</p>
            <p className="text-xs text-muted-foreground mt-1">JPG or PNG — natural lighting works best</p>
          </div>
        </button>

        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleGallery} />

        <p className="text-xs text-muted-foreground">
          On mobile? Open Roomora on your phone for live camera capture.
        </p>
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
