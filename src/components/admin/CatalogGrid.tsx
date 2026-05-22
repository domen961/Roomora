import { useState } from "react";
import { Trash2, Copy, Check, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Product } from "@/lib/products";

interface Props {
  products: Product[];
  onDelete: (id: string) => void;
  onEdit:   (product: Product) => void;
}

export default function CatalogGrid({ products, onDelete, onEdit }: Props) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyId = (id: string) => {
    navigator.clipboard.writeText(`<button data-roomora-product="${id}">See in your room</button>`);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  if (products.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-12 text-center">
        <p className="text-sm text-muted-foreground">No products yet. Add your first product above.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {products.map((product) => {
        const isOwned = !product.id.startsWith("sharon_");
        return (
          <div
            key={product.id}
            className="rounded-lg border border-border bg-card overflow-hidden flex flex-col"
          >
            {/* Thumbnail */}
            <div className="aspect-[4/3] bg-secondary flex items-center justify-center overflow-hidden">
              {product.thumbnail ? (
                <img
                  src={product.thumbnail}
                  alt={product.name}
                  className="w-full h-full object-cover"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              ) : (
                <span className="text-xs text-muted-foreground px-2 text-center">{product.name}</span>
              )}
            </div>

            {/* Card footer */}
            <div className="p-2.5 flex flex-col gap-2 flex-1">
              <p className="text-xs font-medium leading-tight">{product.name}</p>
              <div className="flex gap-1.5 mt-auto">
                <button
                  onClick={() => copyId(product.id)}
                  title="Copy embed snippet"
                  className={cn(
                    "flex-1 flex items-center justify-center gap-1 rounded text-xs px-2 py-1 transition-colors border",
                    copiedId === product.id
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border hover:border-primary/40 text-muted-foreground hover:text-foreground"
                  )}
                >
                  {copiedId === product.id
                    ? <><Check className="h-3 w-3" />Copied</>
                    : <><Copy className="h-3 w-3" />ID</>
                  }
                </button>

                {isOwned && (
                  <>
                    <button
                      onClick={() => onEdit(product)}
                      title="Edit product"
                      className="flex items-center justify-center rounded border border-border hover:border-primary/50 hover:text-primary px-2 py-1 text-muted-foreground transition-colors"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => onDelete(product.id)}
                      title="Delete product"
                      className="flex items-center justify-center rounded border border-border hover:border-destructive/50 hover:text-destructive px-2 py-1 text-muted-foreground transition-colors"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
