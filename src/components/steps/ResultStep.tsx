import { Download, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  result: string;
  productName: string;
  onReset: () => void;
}

export default function ResultStep({ result, productName, onReset }: Props) {
  const handleDownload = () => {
    const a = document.createElement("a");
    a.href = result;
    a.download = `roomora-${productName.replace(/\s+/g, "-").toLowerCase()}.jpg`;
    a.click();
  };

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-border px-6 py-4 flex items-center justify-between">
        <span className="font-serif text-xl text-primary">Roomora</span>
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
