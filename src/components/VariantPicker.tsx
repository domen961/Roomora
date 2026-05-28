import { useEffect, useRef, useState } from "react";
import { ChevronUp, X, ImageIcon } from "lucide-react";
import type { ProductVariant } from "@/lib/db";

interface Item {
  name:     string;
  imageUrl: string | null;
}

interface Props {
  base:          { name: string; imageUrl: string | null };
  variants:      ProductVariant[];
  selectedIndex: number;   // 0 = base, 1..N = variants[N-1]
  onSelect:      (index: number) => void;
}

export default function VariantPicker({ base, variants, selectedIndex, onSelect }: Props) {
  const [open,    setOpen]    = useState(false);
  const [visible, setVisible] = useState(false);   // drives slide-up animation
  const sheetRef = useRef<HTMLDivElement>(null);

  const items: Item[] = [
    { name: base.name, imageUrl: base.imageUrl },
    ...variants.map((v) => ({ name: v.name, imageUrl: v.images[0] ?? null })),
  ];

  const current = items[selectedIndex] ?? items[0];
  const truncate = (s: string, max: number) => s.length > max ? s.slice(0, max - 1) + "…" : s;

  // ── Sheet open / close animation ─────────────────────────────────────────
  const openSheet = () => {
    setOpen(true);
    requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)));
  };

  const closeSheet = () => {
    setVisible(false);
    setTimeout(() => setOpen(false), 300);
  };

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeSheet(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      {/* ── Collapsed pill ────────────────────────────────────────────────── */}
      <button
        onClick={openSheet}
        className="flex items-center gap-2 bg-white rounded-full pl-1.5 pr-3 py-1.5
                   shadow-lg active:scale-95 transition-transform h-12 max-w-[120px]"
        aria-label="Choose variant"
      >
        {/* Thumbnail */}
        <div className="w-9 h-9 rounded-full overflow-hidden bg-white border border-gray-100
                        flex-shrink-0 flex items-center justify-center">
          {current.imageUrl ? (
            <img
              src={current.imageUrl}
              alt={current.name}
              className="w-full h-full object-contain p-0.5"
              draggable={false}
            />
          ) : (
            <div className="w-full h-full rounded-full bg-gray-100" />
          )}
        </div>

        {/* Name */}
        <span className="text-[11px] font-semibold text-gray-800 truncate leading-tight flex-1 text-left">
          {truncate(current.name, 10)}
        </span>

        {/* Chevron */}
        <ChevronUp className="h-3 w-3 text-gray-400 flex-shrink-0" />
      </button>

      {/* ── Bottom sheet ──────────────────────────────────────────────────── */}
      {open && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 transition-opacity duration-300"
            style={{
              backgroundColor: `rgba(0,0,0,${visible ? 0.55 : 0})`,
              transitionProperty: "background-color",
            }}
            onClick={closeSheet}
          />

          {/* Sheet */}
          <div
            ref={sheetRef}
            className="fixed bottom-0 left-0 right-0 z-50 bg-card rounded-t-2xl shadow-2xl
                       transition-transform duration-300 ease-out"
            style={{ transform: visible ? "translateY(0)" : "translateY(100%)" }}
          >
            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-white/20" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2">
              <span className="text-sm font-medium text-foreground">Choose variant</span>
              <button
                onClick={closeSheet}
                className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Grid */}
            <div
              className="grid grid-cols-3 gap-3 px-4 pb-10 overflow-y-auto"
              style={{ maxHeight: "55vh" }}
            >
              {items.map((item, i) => (
                <button
                  key={i}
                  onClick={() => { onSelect(i); closeSheet(); }}
                  className={`flex flex-col items-center gap-1.5 rounded-xl p-2 transition-colors
                              ${i === selectedIndex
                                ? "ring-2 ring-primary bg-primary/10"
                                : "bg-secondary hover:bg-secondary/80"
                              }`}
                >
                  {/* Square thumbnail — white bg so product images look clean */}
                  <div className="w-full aspect-square rounded-lg overflow-hidden bg-white
                                  flex items-center justify-center">
                    {item.imageUrl ? (
                      <img
                        src={item.imageUrl}
                        alt={item.name}
                        className="w-full h-full object-contain p-1.5"
                      />
                    ) : (
                      <ImageIcon className="h-6 w-6 text-gray-300" />
                    )}
                  </div>

                  {/* Name */}
                  <span className="text-[11px] text-foreground text-center leading-tight
                                   line-clamp-2 w-full">
                    {item.name}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}
