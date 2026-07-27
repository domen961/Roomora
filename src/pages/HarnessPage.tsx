import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getProducts } from "@/lib/db";
import type { Product } from "@/lib/products";
import { placeInRoom } from "@/lib/gemini";

/**
 * Internal batch test harness (/harness). Runs the real placeInRoom pipeline over a bundled
 * set of room photos (public/furora-inputs) N times each for a chosen product, so we can
 * eyeball scale/erase/placement across many rooms and see run-to-run variance in one sheet.
 * Not linked anywhere in the UI — internal tooling.
 */

const DEFAULT_SHOP = "64559a6e-d4aa-45f0-bee0-0421210f8d8a"; // TC Meble

interface RoomManifest { file: string; src: string; w: number; h: number }

interface Cell {
  room: string;         // room-XX.jpg
  src: string;          // original filename
  run: number;          // 1..N
  status: "pending" | "running" | "done" | "error";
  result?: string;      // output data URL
  error?: string;
  ms?: number;
  logs: string[];
}

async function urlToDataUrl(url: string): Promise<string> {
  const res = await fetch(url);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
}

export default function HarnessPage() {
  const [params] = useSearchParams();
  const shopId = params.get("shop") || DEFAULT_SHOP;

  const [rooms, setRooms] = useState<RoomManifest[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [productId, setProductId] = useState<string>("");
  const [runs, setRuns] = useState(3);
  const [cells, setCells] = useState<Cell[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const cancelRef = useRef(false);

  // Load room manifest + product catalog
  useEffect(() => {
    (async () => {
      try {
        const mres = await fetch("/furora-inputs/manifest.json");
        const manifest: RoomManifest[] = await mres.json();
        setRooms(manifest);
      } catch { setLoadErr("Could not load /furora-inputs/manifest.json"); }
      try {
        const prods = await getProducts(shopId);
        setProducts(prods);
        if (prods.length) setProductId(prods[0].id);
      } catch { setLoadErr((e) => e ?? `Could not load products for shop ${shopId}`); }
    })();
  }, [shopId]);

  const product = useMemo(() => products.find((p) => p.id === productId) ?? null, [products, productId]);

  const runAll = async () => {
    if (!product || !rooms.length) return;
    cancelRef.current = false;
    setRunning(true);

    // Pre-build the empty grid so results fill in place.
    const initial: Cell[] = [];
    for (const room of rooms)
      for (let r = 1; r <= runs; r++)
        initial.push({ room: room.file, src: room.src, run: r, status: "pending", logs: [] });
    setCells(initial);
    setProgress({ done: 0, total: initial.length });

    // Capture [Furora] / claude-* console output into the active cell.
    const origLog = console.log, origWarn = console.warn;
    let buffer: string[] = [];
    const cap = (orig: (...a: unknown[]) => void) => (...a: unknown[]) => {
      const line = a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ");
      if (/\[Furora\]|claude-/.test(line)) buffer.push(line);
      orig(...a);
    };
    console.log = cap(origLog); console.warn = cap(origWarn);

    let done = 0;
    try {
      for (let i = 0; i < initial.length; i++) {
        if (cancelRef.current) break;
        const cell = initial[i];
        setCells((prev) => prev.map((c, idx) => idx === i ? { ...c, status: "running" } : c));
        buffer = [];
        const t0 = performance.now();
        try {
          const roomDataUrl = await urlToDataUrl(`/furora-inputs/${cell.room}`);
          const out = await placeInRoom(
            product.images,
            roomDataUrl,
            product.name,
            product.description,
            { length_cm: product.length_cm ?? undefined, width_cm: product.width_cm ?? undefined, height_cm: product.height_cm ?? undefined },
            product.category,
          );
          const ms = Math.round(performance.now() - t0);
          const logs = [...buffer];
          setCells((prev) => prev.map((c, idx) => idx === i ? { ...c, status: "done", result: out, ms, logs } : c));
        } catch (err) {
          const logs = [...buffer];
          setCells((prev) => prev.map((c, idx) => idx === i ? { ...c, status: "error", error: err instanceof Error ? err.message : String(err), logs } : c));
        }
        done++;
        setProgress({ done, total: initial.length });
      }
    } finally {
      console.log = origLog; console.warn = origWarn;
      setRunning(false);
    }
  };

  const stop = () => { cancelRef.current = true; };

  const download = (cell: Cell) => {
    if (!cell.result) return;
    const a = document.createElement("a");
    a.href = cell.result;
    a.download = `${product?.name?.replace(/\s+/g, "-").slice(0, 30) || "out"}_${cell.room.replace(".jpg", "")}_run${cell.run}.jpg`;
    a.click();
  };

  const downloadAll = async () => {
    for (const c of cells.filter((c) => c.result)) { download(c); await new Promise((r) => setTimeout(r, 250)); }
  };

  // Group cells by room for the grid
  const byRoom = useMemo(() => {
    const map = new Map<string, Cell[]>();
    for (const c of cells) { if (!map.has(c.room)) map.set(c.room, []); map.get(c.room)!.push(c); }
    return [...map.entries()];
  }, [cells]);

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 p-6">
      <div className="max-w-[1400px] mx-auto">
        <h1 className="text-xl font-semibold mb-1">Furora — batch harness</h1>
        <p className="text-sm text-neutral-400 mb-4">
          Shop <code className="text-neutral-300">{shopId}</code> · {rooms.length} rooms · runs the real pipeline. Override shop with <code>?shop=UUID</code>.
        </p>
        {loadErr && <div className="mb-4 rounded bg-red-950 border border-red-800 px-3 py-2 text-sm text-red-300">{loadErr}</div>}

        <div className="flex flex-wrap items-end gap-4 mb-6 rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <label className="flex flex-col text-xs gap-1">
            <span className="text-neutral-400">Product</span>
            <select value={productId} onChange={(e) => setProductId(e.target.value)} disabled={running}
              className="bg-neutral-800 border border-neutral-700 rounded px-2 py-1.5 text-sm min-w-[280px]">
              {products.map((p) => <option key={p.id} value={p.id}>{p.name} {p.category ? `· ${p.category}` : ""}</option>)}
            </select>
          </label>
          <label className="flex flex-col text-xs gap-1">
            <span className="text-neutral-400">Runs / room</span>
            <input type="number" min={1} max={8} value={runs} disabled={running}
              onChange={(e) => setRuns(Math.max(1, Math.min(8, Number(e.target.value) || 1)))}
              className="bg-neutral-800 border border-neutral-700 rounded px-2 py-1.5 text-sm w-20" />
          </label>
          {!running
            ? <button onClick={runAll} disabled={!product || !rooms.length}
                className="bg-amber-500 hover:bg-amber-400 text-black font-medium rounded px-4 py-2 text-sm disabled:opacity-40">
                Run all ({rooms.length * runs})
              </button>
            : <button onClick={stop} className="bg-red-600 hover:bg-red-500 rounded px-4 py-2 text-sm">Stop</button>}
          {cells.some((c) => c.result) && !running &&
            <button onClick={downloadAll} className="bg-neutral-700 hover:bg-neutral-600 rounded px-4 py-2 text-sm">Download all</button>}
          {progress.total > 0 &&
            <div className="text-sm text-neutral-400 ml-auto">
              {progress.done}/{progress.total} {running && <span className="animate-pulse">· running…</span>}
            </div>}
        </div>

        {product && (
          <div className="flex gap-2 mb-6 items-center">
            <span className="text-xs text-neutral-500">Product refs:</span>
            {product.images.slice(0, 2).map((src: string, i: number) => <img key={i} src={src} className="h-16 rounded border border-neutral-800" />)}
            <span className="text-xs text-neutral-500">
              {product.length_cm || product.width_cm || product.height_cm
                ? `dims: ${product.length_cm ?? "?"}×${product.width_cm ?? "?"}×${product.height_cm ?? "?"}cm`
                : "no dims set"}
            </span>
          </div>
        )}

        <div className="space-y-6">
          {byRoom.map(([room, roomCells]) => (
            <div key={room} className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-48">
                  <div className="text-xs text-neutral-400 mb-1">{room}</div>
                  <img src={`/furora-inputs/${room}`} className="w-48 rounded border border-neutral-700" />
                  <div className="text-[10px] text-neutral-600 mt-1 truncate">{roomCells[0]?.src}</div>
                </div>
                <div className="flex flex-wrap gap-3">
                  {roomCells.map((c) => (
                    <div key={c.run} className="w-48">
                      <div className="text-[11px] text-neutral-500 mb-1 flex justify-between">
                        <span>run {c.run}</span>
                        {c.ms && <span>{(c.ms / 1000).toFixed(1)}s</span>}
                      </div>
                      <div className="relative w-48 h-48 rounded border border-neutral-700 bg-neutral-800 flex items-center justify-center overflow-hidden">
                        {c.status === "pending" && <span className="text-xs text-neutral-600">—</span>}
                        {c.status === "running" && <span className="text-xs text-amber-400 animate-pulse">running…</span>}
                        {c.status === "error" && <span className="text-[10px] text-red-400 p-2 text-center">{c.error}</span>}
                        {c.result && <img src={c.result} onClick={() => download(c)} className="w-full h-full object-cover cursor-pointer" title="click to download" />}
                      </div>
                      {c.logs.length > 0 && (
                        <details className="mt-1">
                          <summary className="text-[10px] text-neutral-500 cursor-pointer">logs ({c.logs.length})</summary>
                          <pre className="text-[9px] text-neutral-400 whitespace-pre-wrap mt-1 max-h-40 overflow-auto">{c.logs.join("\n")}</pre>
                        </details>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
