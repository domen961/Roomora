import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, LogOut } from "lucide-react";
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
              onClick={() => { setTab(t); setShowForm(false); setEditingProduct(null); }}
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

        <main className={`flex-1 mx-auto w-full px-4 py-8 ${showForm || editingProduct ? "max-w-6xl" : "max-w-4xl"}`}>
          {/* Catalog tab */}
          {tab === "catalog" && (
            <div className="flex flex-col gap-6">
              {/* Header */}
              <div className="flex items-center justify-between">
                <h1 className="text-2xl text-foreground">Product catalog</h1>
                {!showForm && !editingProduct && (
                  <Button onClick={() => setShowForm(true)} size="sm" className="gap-2">
                    <Plus className="h-4 w-4" />Add product
                  </Button>
                )}
              </div>

              {/* Two-column layout when a form panel is open */}
              <div className="flex gap-6 items-start">

                {/* Left: catalog grid */}
                <div className="flex-1 min-w-0">
                  {productsLoading ? (
                    <p className="text-sm text-muted-foreground">Loading…</p>
                  ) : (
                    <CatalogGrid
                      products={products}
                      onDelete={handleDelete}
                      onEdit={(p) => { setShowForm(false); setEditingProduct(p); }}
                    />
                  )}
                </div>

                {/* Right: form panel (new or edit) */}
                {(showForm || editingProduct) && (
                  <div className="w-[440px] flex-shrink-0 rounded-lg border border-border bg-card p-6 overflow-y-auto max-h-[calc(100vh-10rem)] sticky top-6">
                    <h2 className="text-base font-medium mb-5">
                      {editingProduct ? `Edit — ${editingProduct.name}` : "New product"}
                    </h2>

                    {showForm && (
                      <ProductForm
                        viewer={viewer}
                        merchantId={activeMerchantId}
                        onSave={() => {
                          setShowForm(false);
                          getProducts(activeMerchantId).then(setProducts).catch(console.error);
                        }}
                        onCancel={() => setShowForm(false)}
                      />
                    )}

                    {editingProduct && (
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
                    )}
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
