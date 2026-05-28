import { useCallback, useRef, useState } from "react";
import type { ProductVariant } from "@/lib/db";

interface RevolverItem {
  name:   string;
  imageUrl: string | null;  // image_0 (perspective view)
}

interface Props {
  base:          { name: string; imageUrl: string | null };
  variants:      ProductVariant[];
  selectedIndex: number;   // 0 = base, 1..N = variants[N-1]
  onSelect:      (index: number) => void;
}

const SCROLL_THRESHOLD = 40;  // pixels of touch drag to advance one step

export default function VariantRevolver({ base, variants, selectedIndex, onSelect }: Props) {
  const items: RevolverItem[] = [
    { name: base.name,  imageUrl: base.imageUrl },
    ...variants.map((v) => ({ name: v.name, imageUrl: v.images[0] ?? null })),
  ];

  const total = items.length;
  const current = items[selectedIndex] ?? items[0];

  // ── Touch gesture tracking ────────────────────────────────────────────────
  const touchStartY     = useRef<number>(0);
  const accumulatedDrag = useRef<number>(0);

  // ── Spin animation ────────────────────────────────────────────────────────
  const [spinning, setSpinning] = useState(false);
  const spinTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const triggerSpin = useCallback(() => {
    setSpinning(true);
    clearTimeout(spinTimerRef.current);
    spinTimerRef.current = setTimeout(() => setSpinning(false), 280);
  }, []);

  const advance = useCallback(
    (delta: 1 | -1) => {
      const next = (selectedIndex + delta + total) % total;
      onSelect(next);
      triggerSpin();
    },
    [selectedIndex, total, onSelect, triggerSpin],
  );

  // ── Touch handlers ────────────────────────────────────────────────────────
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartY.current     = e.touches[0].clientY;
    accumulatedDrag.current = 0;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    e.preventDefault();  // prevent page scroll while using revolver
    const delta = touchStartY.current - e.touches[0].clientY;
    accumulatedDrag.current += delta;
    touchStartY.current = e.touches[0].clientY;

    if (accumulatedDrag.current > SCROLL_THRESHOLD) {
      accumulatedDrag.current = 0;
      advance(1);
    } else if (accumulatedDrag.current < -SCROLL_THRESHOLD) {
      accumulatedDrag.current = 0;
      advance(-1);
    }
  };

  // ── Mouse wheel ───────────────────────────────────────────────────────────
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    advance(e.deltaY > 0 ? 1 : -1);
  };

  // ── Truncate name ─────────────────────────────────────────────────────────
  const truncate = (s: string, max: number) =>
    s.length > max ? s.slice(0, max - 1) + "…" : s;

  return (
    <div
      className="flex flex-col items-center gap-1 select-none cursor-grab active:cursor-grabbing"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onWheel={handleWheel}
      style={{ touchAction: "none" }}
    >
      {/* Circular icon */}
      <div
        className={`w-14 h-14 rounded-full border-2 border-white/60 bg-white/15 backdrop-blur-md
                    flex items-center justify-center overflow-hidden shadow-lg transition-transform
                    ${spinning ? "rotate-[30deg]" : "rotate-0"}`}
        style={{ transition: "transform 0.28s cubic-bezier(0.34,1.56,0.64,1)" }}
      >
        {current.imageUrl ? (
          <img
            src={current.imageUrl}
            alt={current.name}
            className="w-full h-full object-contain p-1.5 mix-blend-multiply"
            draggable={false}
          />
        ) : (
          <span className="text-white/60 text-lg">◑</span>
        )}

        {/* Dot indicator for current position */}
        <div
          className="absolute bottom-1 left-0 right-0 flex justify-center gap-0.5 pointer-events-none"
        >
          {total <= 6 && items.map((_, i) => (
            <div
              key={i}
              className={`rounded-full transition-colors ${
                i === selectedIndex
                  ? "w-1.5 h-1.5 bg-white"
                  : "w-1 h-1 bg-white/40"
              }`}
            />
          ))}
        </div>
      </div>

      {/* Name label */}
      <span
        className="text-[10px] text-white/80 max-w-[56px] text-center leading-tight pointer-events-none"
        style={{ textShadow: "0 1px 3px rgba(0,0,0,0.7)" }}
      >
        {truncate(current.name, 9)}
      </span>
    </div>
  );
}
