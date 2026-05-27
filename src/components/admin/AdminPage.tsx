import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, LogOut, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import Logo from "@/components/Logo";
import ProductForm from "./ProductForm";
import VariantCreator from "./VariantCreator";
import CatalogGrid from "./CatalogGrid";
import EmbedSetup from "./EmbedSetup";
import { useAuth } from "@/hooks/useAuth";
import { getProducts, deleteProduct, getAllMerchants } from "@/lib/db";
import { supabase } from "@/lib/supabase";
import type { Product } from "@/lib/products";

type Tab  = "catalog" | "embed";
type View = "catalog" | "add" | "edit";

export default function AdminPage() {
  const navigate  = useNavigate();
  const { user, isSuperadmin, loading } = useAuth();

  useEffect(() => {
    if (!loading && !user) navigate("/login");
  }, [loading, user, navigate]);

  const [tab,              setTab]              = useState<Tab>("catalog");
  const [view,             setView]             = useState<View>("catalog");
  const [editingProduct,   setEditingProduct]   = useState<Product | null>(null);
  const [products,         setProducts]         = useState<Product[]>([]);
  const [productsLoading,  setProductsLoading]  = useState(true);
  const [merchants,        setMerchants]        = useState<{ id: string; shop_name: string | null }[]>([]);
  const [activeMerchantId, setActiveMerchantId] = useState<string>("");

  useEffect(() => {
    if (user && !activeMerchantId) setActiveMerchantId(user.id);
  }, [user, activeMerchantId]);

  useEffect(() => {
    if (isSuperadmin) {
      getAllMerchants().then(setMerchants).catch(console.error);
    }
  }, [isSuperadmin]);

  useEffect(() => {
    if (!activeMerchantId) return;
    setProductsLoading(true);
    getProducts(activeMerchantId)
      .then(setProducts)
      .catch(console.error)
      .finally(() => setProductsLoading(false));
  }, [activeMerchantId]);

  const reloadProducts = () =>
    getProducts(activeMerchantId).then(setProducts).catch(console.error);

  const backToCatalog = () => {
    setView("catalog");
    setEditingProduct(null);
    reloadProducts();
  };

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

  const inForm = view === "add" || view === "edit";

  return (
    <>
      <div className="min-h-screen flex flex-col">

        {/* ── Header ── */}
        <header className="border-b border-border px-6 py-3 flex items-center gap-4">
          <Logo className="h-7" />
          <span className="text-xs border border-border rounded px-2 py-0.5 text-muted-foreground uppercase tracking-widest">
            Admin
          </span>
          <div className="flex-1" />

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

        {/* ── Tabs (hidden while in form view) ── */}
        {!inForm && (
          <div className="border-b border-border px-6 flex gap-0">
            {(["catalog", "embed"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => { setTab(t); setView("catalog"); setEditingProduct(null); }}
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
        )}

        {/* ── Main ── */}
        <main className={`flex-1 mx-auto w-full px-4 py-8 ${inForm && view === "edit" ? "max-w-6xl" : "max-w-4xl"}`}>

          {/* ── FORM VIEW (add or edit) — catalog completely hidden ── */}
          {inForm && (
            <div className="flex flex-col gap-6">
              <div className="flex items-center gap-3">
                <button
                  onClick={backToCatalog}
                  className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to catalog
                </button>
              </div>

              <div className={`flex gap-6 ${view === "edit" ? "flex-col lg:flex-row" : "flex-col"}`}>
                {/* Product form */}
                <div className="rounded-lg border border-border bg-card p-6 lg:max-w-lg w-full">
                  <h2 className="text-base font-medium mb-5">
                    {view === "edit" && editingProduct
                      ? `Edit — ${editingProduct.name}`
                      : "New product"}
                  </h2>
                  <ProductForm
                    key={editingProduct?.id ?? "new"}
                    merchantId={activeMerchantId}
                    initialProduct={view === "edit" ? editingProduct ?? undefined : undefined}
                    onSave={backToCatalog}
                    onCancel={backToCatalog}
                  />
                </div>

                {/* Variant Creator — only shown when editing an existing product */}
                {view === "edit" && editingProduct && (
                  <div className="rounded-lg border border-border bg-card p-6 flex-1 min-w-0">
                    <VariantCreator
                      product={editingProduct}
                      merchantId={activeMerchantId}
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── CATALOG VIEW ── */}
          {!inForm && tab === "catalog" && (
            <div className="flex flex-col gap-6">
              <div className="flex items-center justify-between">
                <h1 className="text-2xl text-foreground">Product catalog</h1>
                <Button
                  onClick={() => { setEditingProduct(null); setView("add"); }}
                  size="sm"
                  className="gap-2"
                >
                  <Plus className="h-4 w-4" />Add product
                </Button>
              </div>

              {productsLoading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : (
                <CatalogGrid
                  products={products}
                  onDelete={handleDelete}
                  onEdit={(p) => { setEditingProduct(p); setView("edit"); }}
                />
              )}
            </div>
          )}

          {/* ── EMBED TAB ── */}
          {!inForm && tab === "embed" && (
            <EmbedSetup merchantId={activeMerchantId} />
          )}

        </main>
      </div>
    </>
  );
}
