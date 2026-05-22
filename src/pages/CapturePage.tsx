import { useParams } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { Camera, Check, ImageIcon, Loader2, AlertCircle, RotateCcw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import Logo from "@/components/Logo";

type Phase = "idle" | "sending" | "waiting_result" | "result" | "error";

export default function CapturePage() {
  const { token } = useParams<{ token: string }>();

  // Camera
  const videoRef   = useRef<HTMLVideoElement>(null);
  const streamRef  = useRef<MediaStream | null>(null);
  const [cameraReady,  setCameraReady]  = useState(false);
  const [cameraFailed, setCameraFailed] = useState(false);
  const [cameraKey,    setCameraKey]    = useState(0); // increment to restart camera

  // Two file inputs: gallery (no capture) + fallback (capture=environment)
  const galleryInputRef  = useRef<HTMLInputElement>(null);
  const fallbackInputRef = useRef<HTMLInputElement>(null);

  const [phase,       setPhase]       = useState<Phase>("idle");
  const [error,       setError]       = useState("");
  const [resultImage, setResultImage] = useState<string | null>(null);

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

  // ── Subscribe to result coming back from desktop ──────────────────────────
  useEffect(() => {
    if (!token) return;
    const channel = supabase
      .channel("capture_result:" + token)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "room_captures",
          filter: `token=eq.${token}`,
        },
        (payload) => {
          const result = (payload.new as { result: string | null }).result;
          if (result) {
            setResultImage(result);
            setPhase("result");
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [token]);

  // ── Capture live frame ────────────────────────────────────────────────────
  const handleCapture = async () => {
    const video = videoRef.current;
    if (!video || !token) return;
    streamRef.current?.getTracks().forEach((t) => t.stop());

    const maxPx = 1024;
    const scale = Math.min(1, maxPx / Math.max(video.videoWidth || 1280, video.videoHeight || 720));
    const canvas = document.createElement("canvas");
    canvas.width  = Math.round((video.videoWidth  || 1280) * scale);
    canvas.height = Math.round((video.videoHeight || 720)  * scale);
    canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
    await sendPhoto(canvas.toDataURL("image/jpeg", 0.85));
  };

  // ── Pick from gallery ─────────────────────────────────────────────────────
  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !token) return;
    e.target.value = "";
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
    setPhase("sending");
    try {
      // upsert clears any old result so the desktop re-processes on retry
      const { error: dbError } = await supabase
        .from("room_captures")
        .upsert({ token, photo, result: null });
      if (dbError) throw new Error(dbError.message);
      setPhase("waiting_result");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send photo");
      setPhase("error");
    }
  };

  // ── Retry: restart camera + clear result ─────────────────────────────────
  const handleRetry = () => {
    setResultImage(null);
    setPhase("idle");
    setCameraKey((k) => k + 1); // triggers camera useEffect to restart
  };

  // ─────────────────────────────────────────────────────────────────────────
  // RESULT SCREEN
  // ─────────────────────────────────────────────────────────────────────────
  if (phase === "result" && resultImage) {
    return (
      <div className="relative w-full bg-black overflow-hidden" style={{ height: "100dvh" }}>
        {/* Full-screen result image */}
        <img
          src={resultImage}
          alt="Your room with the furniture"
          className="absolute inset-0 w-full h-full object-cover"
        />

        {/* Gradient overlay at bottom */}
        <div className="absolute bottom-0 left-0 right-0 h-48 bg-gradient-to-t from-black/80 to-transparent pointer-events-none" />

        {/* Logo at top */}
        <div className="absolute top-8 left-0 right-0 flex justify-center pointer-events-none">
          <Logo />
        </div>

        {/* Bottom controls */}
        <div className="absolute bottom-10 left-0 right-0 flex flex-col items-center gap-4 px-6">
          <p className="text-white/80 text-sm font-light">Here's your room ✨</p>
          <div className="flex gap-3 w-full max-w-xs">
            <button
              onClick={handleRetry}
              className="flex-1 flex items-center justify-center gap-2 rounded-xl border-2 border-white/40 bg-white/10 backdrop-blur-sm py-3 text-sm font-medium text-white active:scale-95 transition-transform"
            >
              <RotateCcw className="h-4 w-4" />
              Retry
            </button>
            <button
              onClick={() => setPhase("idle")}
              className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-black active:scale-95 transition-transform"
            >
              <Check className="h-4 w-4" />
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SENDING / WAITING SCREENS (dark overlay, camera stopped)
  // ─────────────────────────────────────────────────────────────────────────
  if (phase === "sending" || phase === "waiting_result") {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-6 px-6 text-center">
        <Logo />
        <Loader2 className="h-14 w-14 animate-spin text-primary" />
        <div>
          <p className="text-base font-medium text-foreground">
            {phase === "sending" ? "Sending photo…" : "Generating your room…"}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            {phase === "sending" ? "Uploading to server" : "This usually takes 20–40 seconds"}
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
  // FALLBACK: camera denied → plain dark screen with file input
  // ─────────────────────────────────────────────────────────────────────────
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

  // ─────────────────────────────────────────────────────────────────────────
  // PRIMARY: live camera background
  // ─────────────────────────────────────────────────────────────────────────
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

      {/* Loading spinner while camera warms up */}
      {!cameraReady && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-white/60" />
        </div>
      )}

      {/* UI overlay */}
      {cameraReady && (
        <div className="absolute inset-0 flex flex-col items-center justify-between py-12 px-6 text-center">
          {/* Top: logo + title */}
          <div className="flex flex-col items-center gap-4">
            <Logo />
            <div>
              <h1
                className="text-2xl font-light text-primary"
                style={{ textShadow: "0 1px 4px rgba(0,0,0,0.6)" }}
              >
                Photograph your room
              </h1>
              <p className="text-sm text-white/70 mt-1 max-w-xs">
                Point at the spot where you'd like to place the furniture
              </p>
            </div>
          </div>

          {/* Bottom: gallery + shutter */}
          <div className="flex flex-col items-center gap-4">
            <div className="flex items-center justify-center gap-8">
              {/* Gallery — opens photo library */}
              <button
                onClick={() => galleryInputRef.current?.click()}
                className="w-14 h-14 rounded-full border-2 border-white/60 bg-white/10 backdrop-blur-sm flex items-center justify-center active:scale-95 transition-transform shadow-lg"
                aria-label="Choose from gallery"
              >
                <ImageIcon className="h-6 w-6 text-white" />
              </button>

              {/* Shutter */}
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

      {/* Hidden gallery input (no capture attr → opens library) */}
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
