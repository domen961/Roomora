import { useParams } from "react-router-dom";
import { useRef, useState } from "react";
import { Camera, Check, Loader2, AlertCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import Logo from "@/components/Logo";

type Phase = "idle" | "sending" | "done" | "error";

export default function CapturePage() {
  const { token } = useParams<{ token: string }>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !token) return;
    e.target.value = "";
    setPhase("sending");

    try {
      const photo = await compressImage(file, 1024, 0.72);
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

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-10 px-6 text-center">
      <Logo />

      {phase === "idle" && (
        <>
          <div>
            <h1 className="text-2xl font-light text-primary mb-2">Photograph your room</h1>
            <p className="text-sm text-muted-foreground max-w-xs">
              Point at the spot where you'd like to place the furniture
            </p>
          </div>

          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-32 h-32 rounded-full bg-primary/10 border-2 border-primary/40 hover:bg-primary/20 flex items-center justify-center transition-colors active:scale-95"
          >
            <Camera className="h-14 w-14 text-primary" />
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleFile}
          />

          <p className="text-xs text-muted-foreground">Natural lighting gives the best results</p>
        </>
      )}

      {phase === "sending" && (
        <>
          <Loader2 className="h-14 w-14 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Sending to your computer…</p>
        </>
      )}

      {phase === "done" && (
        <>
          <div className="w-24 h-24 rounded-full bg-primary/10 border-2 border-primary/30 flex items-center justify-center">
            <Check className="h-12 w-12 text-primary" />
          </div>
          <div>
            <p className="text-xl text-primary mb-2">Photo sent!</p>
            <p className="text-sm text-muted-foreground">
              Return to your computer to see the result
            </p>
          </div>
        </>
      )}

      {phase === "error" && (
        <>
          <AlertCircle className="h-12 w-12 text-destructive" />
          <div className="flex flex-col items-center gap-3">
            <p className="text-sm text-destructive">{error}</p>
            <button
              onClick={() => { setPhase("idle"); setError(""); }}
              className="text-xs text-muted-foreground hover:text-foreground underline"
            >
              Try again
            </button>
          </div>
        </>
      )}
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
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = url;
  });
}
