import { Download, RotateCcw } from "lucide-react";
import Logo from "@/components/Logo";
import { Button } from "@/components/ui/button";

interface Props {
  result: string;
  productName: string;
  onReset: () => void;
}

const isMobile =
  typeof navigator !== "undefined" &&
  (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

export default function ResultStep({ result, productName, onReset }: Props) {
  const handleDownload = () => {
    const a = document.createElement("a");
    a.href = result;
    a.download = `roomora-${productName.replace(/\s+/g, "-").toLowerCase()}.jpg`;
    a.click();
  };

  // ── Mobile: full-screen overlay (matches CapturePage result) ────────────────
  if (isMobile) {
    return (
      <div className="relative w-full bg-black overflow-hidden" style={{ height: "100dvh" }}>
        <img src={result} alt={`${productName} placed in room`}
          className="absolute inset-0 w-full h-full object-contain" />
        <div className="absolute bottom-0 left-0 right-0 h-48 bg-gradient-to-t from-black/80 to-transparent pointer-events-none" />
        <div className="absolute top-8 left-0 right-0 flex justify-center pointer-events-none">
          <Logo />
        </div>
        <div className="absolute bottom-10 left-0 right-0 flex flex-col items-center gap-4 px-6">
          <p className="text-white/80 text-sm font-light">Here's your room ✨</p>
          <div className="flex gap-3 w-full max-w-xs">
            <button onClick={onReset}
              className="flex-1 flex items-center justify-center gap-2 rounded-xl border-2 border-white/40 bg-white/10 backdrop-blur-sm py-3 text-sm font-medium text-white active:scale-95 transition-transform">
              <RotateCcw className="h-4 w-4" />Retry
            </button>
            <button onClick={handleDownload}
              className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-black active:scale-95 transition-transform">
              <Download className="h-4 w-4" />Download
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Desktop: structured layout ──────────────────────────────────────────────
  return (
    <div className="flex flex-col">
      <header className="border-b border-border px-6 py-4 flex items-center justify-between">
        <Logo />
        <div className="flex items-center gap-1.5">
          {[1, 2, 3].map((n) => (
            <div key={n} className="h-1.5 w-3 rounded-full bg-primary/40" />
          ))}
        </div>
      </header>

      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-8 flex flex-col gap-6">
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1">Result</p>
          <h1 className="text-3xl text-primary">{productName} in your room</h1>
        </div>

        <img
          src={result}
          alt={`${productName} placed in room`}
          className="w-full rounded-xl border border-border object-contain shadow-[var(--shadow-md)]"
        />

        <div className="flex gap-3">
          <Button onClick={handleDownload} size="lg" className="flex-1 gap-2">
            <Download className="h-4 w-4" />
            Download
          </Button>
          <Button variant="outline" size="lg" onClick={onReset} className="gap-2">
            <RotateCcw className="h-4 w-4" />
            Try another
          </Button>
        </div>

        <p className="text-xs text-muted-foreground text-center">
          Powered by <span className="font-medium text-foreground">Roomora</span> &amp; Gemini AI
        </p>
      </main>
    </div>
  );
}
