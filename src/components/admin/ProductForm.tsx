import { useRef, useState } from "react";
import { Loader2, UploadCloud, CheckCircle, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { BabylonViewer } from "@/hooks/useBabylonViewer";
import { saveProduct } from "@/lib/db";

interface Props {
  viewer: BabylonViewer;
  merchantId: string;
  onSave: () => void;
  onCancel: () => void;
}

type Phase = "idle" | "processing" | "ready" | "saving" | "error";

export default function ProductForm({ viewer, merchantId, onSave, onCancel }: Props) {
  const [name,        setName]        = useState("");
  const [description, setDescription] = useState("");
  const [phase,       setPhase]       = useState<Phase>("idle");
  const [errorMsg,    setErrorMsg]    = useState("");
  const [thumbnail,   setThumbnail]   = useState("");
  const snapshotsRef = useRef<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!ext || !["glb", "gltf", "obj"].includes(ext)) {
      setErrorMsg("Unsupported format. Please upload a GLB, GLTF, or OBJ file.");
      setPhase("error");
      return;
    }
    setPhase("processing");
    setErrorMsg("");
    try {
      const snapshots = await viewer.processModel(file);
      snapshotsRef.current = snapshots;
      setThumbnail(snapshots[2]); // side view as preview
      setPhase("ready");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleSave = async () => {
    if (!name.trim() || phase !== "ready") return;
    setPhase("saving");
    try {
      const id = `${name.trim().toLowerCase().replace(/\s+/g, "_")}_${Date.now()}`;
      await saveProduct(merchantId, id, name.trim(), description.trim() || name.trim(), snapshotsRef.current.slice(0, 3));
      onSave();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  };

  return (
    <div className="flex flex-col gap-6 max-w-lg">
      <div className="flex flex-col gap-2">
        <label className="text-xs uppercase tracking-widest text-muted-foreground">Product name</label>
        <input
          type="text"
          placeholder="e.g. Sharon 2-seater Plush"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded-md border border-input bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-xs uppercase tracking-widest text-muted-foreground">AI description</label>
        <textarea
          placeholder="Describe for AI (e.g. 'compact two-seater sofa, plush grey fabric, black metal legs')"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="rounded-md border border-input bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
        />
      </div>

      {/* 3D model drop zone */}
      <div className="flex flex-col gap-2">
        <label className="text-xs uppercase tracking-widest text-muted-foreground">3D model</label>
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => phase === "idle" || phase === "error" || phase === "ready" ? fileInputRef.current?.click() : null}
          className={cn(
            "rounded-lg border-2 border-dashed p-8 flex flex-col items-center gap-3 transition-colors",
            phase === "idle" || phase === "error" ? "border-border hover:border-primary/50 cursor-pointer" : "border-border",
            phase === "ready" && "border-primary/40 bg-primary/5",
          )}
        >
          {phase === "idle" && (
            <>
              <UploadCloud className="h-8 w-8 text-muted-foreground" />
              <div className="text-center">
                <p className="text-sm font-medium">Drop your 3D model here</p>
                <p className="text-xs text-muted-foreground mt-1">GLB, GLTF, or OBJ</p>
              </div>
            </>
          )}
          {phase === "processing" && (
            <>
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Processing 3D model…</p>
              <p className="text-xs text-muted-foreground opacity-60">Generating snapshots from 4 angles</p>
            </>
          )}
          {phase === "ready" && (
            <div className="flex items-center gap-4 w-full">
              <img src={thumbnail} alt="Preview" className="h-20 w-20 rounded-md object-cover border border-border flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <CheckCircle className="h-4 w-4 text-primary flex-shrink-0" />
                  <span className="text-sm font-medium">Model processed</span>
                </div>
                <p className="text-xs text-muted-foreground">4 snapshots generated</p>
                <button
                  onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                  className="text-xs text-muted-foreground underline mt-1 hover:text-foreground"
                >
                  Replace model
                </button>
              </div>
            </div>
          )}
          {phase === "saving" && (
            <>
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Uploading to catalog…</p>
            </>
          )}
          {phase === "error" && (
            <>
              <AlertCircle className="h-8 w-8 text-destructive" />
              <p className="text-sm text-destructive text-center">{errorMsg}</p>
              <p className="text-xs text-muted-foreground">Click to try again</p>
            </>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".glb,.gltf,.obj"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
        />
      </div>

      <div className="flex gap-3">
        <Button
          onClick={handleSave}
          disabled={phase !== "ready" || !name.trim()}
          className="flex-1"
        >
          Save product
        </Button>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
