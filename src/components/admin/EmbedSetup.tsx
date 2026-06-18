import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  merchantId: string;
}

function CopyBlock({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs uppercase tracking-widest text-muted-foreground">{label}</p>
      <div className="relative">
        <pre className="rounded-lg bg-card border border-border p-4 text-xs text-foreground overflow-x-auto whitespace-pre-wrap break-all pr-10 font-mono">
          {value}
        </pre>
        <button
          onClick={copy}
          className={cn(
            "absolute top-2 right-2 p-1.5 rounded border transition-colors",
            copied
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:text-foreground hover:border-primary/40"
          )}
          title="Copy"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}

export default function EmbedSetup({ merchantId }: Props) {
  const origin = typeof window !== "undefined" ? window.location.origin : "https://furora.com";

  const scriptTag = `<script src="${origin}/embed.js" data-shop="${merchantId}"></script>`;
  const buttonAttr = `<button data-furora-product="YOUR_PRODUCT_ID">See in your room</button>`;

  return (
    <div className="flex flex-col gap-8 max-w-2xl">
      <div>
        <h2 className="text-xl text-foreground mb-1">Add Furora to your website</h2>
        <p className="text-sm text-muted-foreground">
          Two steps — paste once, then tag products. No developer needed.
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2 mb-2">
          <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold flex-shrink-0">1</span>
          <p className="text-sm font-medium">Paste this script tag once in your website's <code className="text-xs bg-card border border-border rounded px-1 py-0.5">&lt;head&gt;</code></p>
        </div>
        <CopyBlock label="Script tag" value={scriptTag} />
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2 mb-2">
          <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold flex-shrink-0">2</span>
          <p className="text-sm font-medium">Add this attribute to any element on your product pages</p>
        </div>
        <CopyBlock label="Product button (replace YOUR_PRODUCT_ID)" value={buttonAttr} />
        <p className="text-xs text-muted-foreground mt-1">
          Get each product's ID by clicking the <strong>ID</strong> button in the Catalog tab.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 flex flex-col gap-1">
        <p className="text-xs font-medium">How it works</p>
        <p className="text-xs text-muted-foreground">
          When a shopper clicks any element tagged with <code className="bg-secondary rounded px-1">data-furora-product</code>,
          a Furora overlay opens. They take a photo of their room and see your product placed inside it — without leaving your page.
        </p>
      </div>
    </div>
  );
}
