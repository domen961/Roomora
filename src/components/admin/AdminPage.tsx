import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, LogOut, ArrowLeft, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import Logo from "@/components/Logo";
import HiddenCanvas from "./HiddenCanvas";
import ProductForm from "./ProductForm";
import CatalogGrid from "./CatalogGrid";
import EmbedSetup from "./EmbedSetup";
import { useAuth } from "@/hooks/useAuth";
import { useBabylonViewer } from "@/hooks/useBabylonViewer";
import { getProducts, deleteProduct, getAllMerchants } from "@/lib/db";
import { supabase } from "@/lib/supabase";
import type { Product } from "@/lib/products";

type Tab = "catalog" | "embed";

export default function AdminPage() {
  const navigate  = useNavigate();
  const { user, isSuperadmin, loading } = useAuth();

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!loading && !user) navigate("/login");
  }, [loading, user, navigate]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewer    = useBabylonViewer(canvasRef);

  const [tab,              setTab]              = useState<Tab>("catalog");
  const [showForm,         setShowForm]         = useState(false);
  const [editingProduct,   setEditingProduct]   = useState<Product | null>(null);
  const [selectedProduct,  setSelectedProduct]  = useState<Product | null>(null);
  const [products,         setProducts]         = useState<Product[]>([]);
  const [productsLoading,  setProductsLoading]  = useState(true);
  const [merchants,        setMerchants]        = useState<{ id: string; shop_name: string | null }[]>([]);
  const [activeMerchantId, setActiveMerchantId] = useState<string>("");

  // Determine active merchant (superadmin can switch)
  useEffect(() => {
    if (user && !activeMerchantId) setActiveMerchantId(user.id);
  }, [user, activeMerchantId]);

  // Load merchant list for superadmin
  useEffect(() => {
    if (isSuperadmin) {
      getAllMerchants().then(setMerchants).catch(console.error);
    }
  }, [isSuperadmin]);

  // Load products whenever activeMerchantId changes
  useEffect(() => {
    if (!activeMerchantId) return;
    setProductsLoading(true);
    getProducts(activeMerchantId)
      .then(setProducts)
      .catch(console.error)
      .finally(() => setProductsLoading(false));
  }, [activeMerchantId]);

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this product?")) return;
    await deleteProduct(activeMerchantId, id);
    setProducts((prev) => prev.filter((p) => p.id !== id));
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate("/login");
  };

  if (loading || !user) return null;

  return (
    <>
      <HiddenCanvas ref={canvasRef} />

      <div className="min-h-screen flex flex-col">
        {/* Header */}
        <header className="border-b border-border px-6 py-3 flex items-center gap-4">
          <Logo className="h-7" />
          <span className="text-xs border border-border rounded px-2 py-0.5 text-muted-foreground uppercase tracking-widest">
            Admin
          </span>
          <div className="flex-1" />

          {/* Superadmin merchant switcher */}
          {isSuperadmin && merchants.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Viewing:</span>
              <select
                value={activeMerchantId}
                onChange={(e) => setActiveMerchantId(e.target.value)}
                className="rounded border border-input bg-card text-xs px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {merchants.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.shop_name ?? m.id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </div>
          )}

          <Link to="/" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            ← App
          </Link>
          <button
            onClick={handleSignOut}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <LogOut className="h-3.5 w-3.5" />Sign out
          </button>
        </header>

        {/* Tabs */}
        <div className="border-b border-border px-6 flex gap-0">
          {(["catalog", "embed"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => { setTab(t); setShowForm(false); setEditingProduct(null); setSelectedProduct(null); }}
              className={`px-4 py-3 text-xs uppercase tracking-widest border-b-2 transition-colors capitalize ${
                tab === t
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <main className={`flex-1 mx-auto w-full px-4 py-8 ${selectedProduct && !showForm && !editingProduct ? "max-w-5xl" : "max-w-4xl"}`}>
          {/* Catalog tab */}
          {tab === "catalog" && (
            <div className="flex flex-col gap-6">

              {/* Header */}
              <div className="flex items-center justify-between">
                <h1 className="text-2xl text-foreground">Product catalog</h1>
                {!showForm && !editingProduct && (
                  <Button
                    onClick={() => { setShowForm(true); setSelectedProduct(null); }}
                    size="sm"
                    className="gap-2"
                  >
                    <Plus className="h-4 w-4" />Add product
                  </Button>
                )}
              </div>

              {/* New product form — full width, stacked */}
              {showForm && (
                <div className="rounded-lg border border-border bg-card p-6">
                  <h2 className="text-base font-medium mb-4">New product</h2>
                  <ProductForm
                    viewer={viewer}
                    merchantId={activeMerchantId}
                    onSave={() => {
                      setShowForm(false);
                      getProducts(activeMerchantId).then(setProducts).catch(console.error);
                    }}
                    onCancel={() => setShowForm(false)}
                  />
                </div>
              )}

              {/* Edit form — full width, stacked */}
              {editingProduct && (
                <div className="rounded-lg border border-border bg-card p-6">
                  <h2 className="text-base font-medium mb-4">Edit — {editingProduct.name}</h2>
                  <ProductForm
                    key={editingProduct.id}
                    viewer={viewer}
                    merchantId={activeMerchantId}
                    initialProduct={editingProduct}
                    onSave={() => {
                      setEditingProduct(null);
                      getProducts(activeMerchantId).then(setProducts).catch(console.error);
                    }}
                    onCancel={() => setEditingProduct(null)}
                  />
                </div>
              )}

              {/* Grid + preview panel side by side */}
              <div className="flex gap-6 items-start">

                {/* Catalog grid */}
                <div className="flex-1 min-w-0">
                  {productsLoading ? (
                    <p className="text-sm text-muted-foreground">Loading…</p>
                  ) : (
                    <CatalogGrid
                      products={products}
                      selectedId={selectedProduct?.id}
                      onDelete={(id) => { handleDelete(id); if (selectedProduct?.id === id) setSelectedProduct(null); }}
                      onEdit={(p) => { setShowForm(false); setSelectedProduct(null); setEditingProduct(p); }}
                      onSelect={(p) => { setShowForm(false); setEditingProduct(null); setSelectedProduct(p); }}
                    />
                  )}
                </div>

                {/* Product preview panel */}
                {selectedProduct && !showForm && !editingProduct && (
                  <div className="w-64 flex-shrink-0 rounded-lg border border-border bg-card overflow-hidden sticky top-6">
                    {/* Back button */}
                    <div className="px-3 py-2.5 border-b border-border">
                      <button
                        onClick={() => setSelectedProduct(null)}
                        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <ArrowLeft className="h-3.5 w-3.5" />
                        Go back
                      </button>
                    </div>

                    {/* Image */}
                    {selectedProduct.thumbnail ? (
                      <img
                        src={selectedProduct.thumbnail}
                        alt={selectedProduct.name}
                        className="w-full aspect-[4/3] object-cover"
                      />
                    ) : (
                      <div className="w-full aspect-[4/3] bg-secondary flex items-center justify-center">
                        <span className="text-xs text-muted-foreground px-4 text-center">{selectedProduct.name}</span>
                      </div>
                    )}

                    {/* Info */}
                    <div className="p-4 flex flex-col gap-3">
                      <p className="text-sm font-medium leading-snug">{selectedProduct.name}</p>

                      {selectedProduct.description && (
                        <p className="text-xs text-muted-foreground leading-relaxed line-clamp-4">
                          {selectedProduct.description}
                        </p>
                      )}

                      {(selectedProduct.length_cm || selectedProduct.width_cm || selectedProduct.height_cm) && (
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          {selectedProduct.length_cm && <span>L {selectedProduct.length_cm} cm</span>}
                          {selectedProduct.width_cm  && <span>W {selectedProduct.width_cm} cm</span>}
                          {selectedProduct.height_cm && <span>H {selectedProduct.height_cm} cm</span>}
                        </div>
                      )}

                      {/* Actions */}
                      {!selectedProduct.id.startsWith("sharon_") && (
                        <div className="flex gap-2 pt-1">
                          <Button
                            size="sm"
                            className="flex-1 gap-1.5"
                            onClick={() => { setEditingProduct(selectedProduct); setSelectedProduct(null); }}
                          >
                            <Pencil className="h-3.5 w-3.5" />Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="px-3 hover:border-destructive/50 hover:text-destructive"
                            onClick={() => { handleDelete(selectedProduct.id); setSelectedProduct(null); }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                )}

              </div>
            </div>
          )}

          {/* Embed tab */}
          {tab === "embed" && (
            <EmbedSetup merchantId={activeMerchantId} />
          )}
        </main>
      </div>
    </>
  );
}
