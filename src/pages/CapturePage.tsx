import { useParams } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { Camera, Check, ImageIcon, Loader2, AlertCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import Logo from "@/components/Logo";

type Phase = "idle" | "sending" | "done" | "error";

export default function CapturePage() {
  const { token } = useParams<{ token: string }>();

  // Camera refs / state
  const videoRef   = useRef<HTMLVideoElement>(null);
  const streamRef  = useRef<MediaStream | null>(null);
  const [cameraReady,  setCameraReady]  = useState(false);
  const [cameraFailed, setCameraFailed] = useState(false);

  // Two separate file inputs:
  //   galleryInputRef  — no `capture` attr  → opens photo library (when camera is live)
  //   fallbackInputRef — capture="environment" → used only when getUserMedia fails
  const galleryInputRef  = useRef<HTMLInputElement>(null);
  const fallbackInputRef = useRef<HTMLInputElement>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");

  // ── Start live camera on mount ────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const stream = await navigator.mediaDevices
          .getUserMedia({
            video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
          })
          .catch(() => navigator.mediaDevices.getUserMedia({ video: true }));

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setCameraReady(true);
        }
      } catch {
        setCameraFailed(true);
      }
    })();
    return () => streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  // ── Capture live frame from video ─────────────────────────────────────────
  const handleCapture = async () => {
    const video = videoRef.current;
    if (!video || !token) return;
    setPhase("sending");
    streamRef.current?.getTracks().forEach((t) => t.stop());

    const maxPx = 1024;
    const scale = Math.min(1, maxPx / Math.max(video.videoWidth || 1280, video.videoHeight || 720));
    const canvas = document.createElement("canvas");
    canvas.width  = Math.round((video.videoWidth  || 1280) * scale);
    canvas.height = Math.round((video.videoHeight || 720)  * scale);
    canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
    const photo = canvas.toDataURL("image/jpeg", 0.85);

    await sendPhoto(photo);
  };

  // ── Pick from gallery / file input ───────────────────────────────────────
  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !token) return;
    e.target.value = "";
    setPhase("sending");
    streamRef.current?.getTracks().forEach((t) => t.stop());

    try {
      const photo = await compressImage(file, 1024, 0.85);
      await sendPhoto(photo);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to process image");
      setPhase("error");
    }
  };

  const sendPhoto = async (photo: string) => {
    try {
      const { error: dbError } = await supabase
        .from("room_captures")
        .upsert({ token, photo });
      if (dbError) throw new Error(dbError.message);
      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send photo");
      setPhase("error");
    }
  };

  // ── Sending ───────────────────────────────────────────────────────────────
  if (phase === "sending") {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-6 px-6 text-center">
        <Logo />
        <Loader2 className="h-14 w-14 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Sending to your computer…</p>
      </div>
    );
  }

  // ── Done ──────────────────────────────────────────────────────────────────
  if (phase === "done") {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-8 px-6 text-center">
        <Logo />
        <div className="w-24 h-24 rounded-full bg-primary/10 border-2 border-primary/30 flex items-center justify-center">
          <Check className="h-12 w-12 text-primary" />
        </div>
        <div>
          <p className="text-xl text-primary mb-2">Photo sent!</p>
          <p className="text-sm text-muted-foreground">Return to your computer to see the result</p>
        </div>
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (phase === "error") {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-6 px-6 text-center">
        <Logo />
        <AlertCircle className="h-12 w-12 text-destructive" />
        <p className="text-sm text-destructive">{error}</p>
        <button
          onClick={() => { setPhase("idle"); setError(""); }}
          className="text-xs text-muted-foreground hover:text-foreground underline"
        >
          Try again
        </button>
      </div>
    );
  }

  // ── Fallback: camera denied → plain dark screen with file input ───────────
  if (cameraFailed) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-10 px-6 text-center">
        <Logo />
        <div>
          <h1 className="text-2xl font-light text-primary mb-2">Photograph your room</h1>
          <p className="text-sm text-muted-foreground max-w-xs">
            Point at the spot where you'd like to place the furniture
          </p>
        </div>
        <button
          onClick={() => fallbackInputRef.current?.click()}
          className="w-32 h-32 rounded-full bg-primary/10 border-2 border-primary/40 hover:bg-primary/20 flex items-center justify-center transition-colors active:scale-95"
        >
          <Camera className="h-14 w-14 text-primary" />
        </button>
        <input
          ref={fallbackInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handleFile}
        />
        <p className="text-xs text-muted-foreground">Natural lighting gives the best results</p>
      </div>
    );
  }

  // ── Primary: live camera background ──────────────────────────────────────
  return (
    <div className="relative w-full bg-black overflow-hidden" style={{ height: "100dvh" }}>
      {/* Live camera feed */}
      <video
        ref={videoRef}
        playsInline
        muted
        className="absolute inset-0 w-full h-full object-cover"
      />

      {/* Readable overlay */}
      <div className="absolute inset-0 bg-black/40 pointer-events-none" />

      {/* Loading while camera warms up */}
      {!cameraReady && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-white/60" />
        </div>
      )}

      {/* UI overlay — only shown when camera is live */}
      {cameraReady && (
        <div className="absolute inset-0 flex flex-col items-center justify-between py-12 px-6 text-center">
          {/* Top: logo + title */}
          <div className="flex flex-col items-center gap-4">
            <Logo />
            <div>
              <h1 className="text-2xl font-light text-primary" style={{ textShadow: "0 1px 4px rgba(0,0,0,0.6)" }}>
                Photograph your room
              </h1>
              <p className="text-sm text-white/70 mt-1 max-w-xs">
                Point at the spot where you'd like to place the furniture
              </p>
            </div>
          </div>

          {/* Bottom: gallery + shutter (mirrors RoomStep mobile layout) */}
          <div className="flex flex-col items-center gap-4">
            <div className="flex items-center justify-center gap-8">
              {/* Gallery — opens photo library (no capture attr) */}
              <button
                onClick={() => galleryInputRef.current?.click()}
                className="w-14 h-14 rounded-full border-2 border-white/60 bg-white/10 backdrop-blur-sm flex items-center justify-center active:scale-95 transition-transform shadow-lg"
                aria-label="Choose from gallery"
              >
                <ImageIcon className="h-6 w-6 text-white" />
              </button>

              {/* Shutter — captures live frame */}
              <button
                onClick={handleCapture}
                className="w-20 h-20 rounded-full border-4 border-white bg-white/20 backdrop-blur-sm flex items-center justify-center active:scale-95 transition-transform shadow-lg"
                aria-label="Take photo"
              >
                <Camera className="h-9 w-9 text-white" />
              </button>

              {/* Spacer keeps shutter centred */}
              <div className="w-14 h-14" />
            </div>
            <p className="text-xs text-white/50">Natural lighting gives the best results</p>
          </div>
        </div>
      )}

      {/* Hidden file input — gallery only, no camera re-launch */}
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFile}
      />
    </div>
  );
}

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
