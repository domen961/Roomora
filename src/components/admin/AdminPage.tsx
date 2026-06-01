import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, LogOut, ArrowLeft, Loader2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import Logo from "@/components/Logo";
import ProductForm from "./ProductForm";
import VariantCreator from "./VariantCreator";
import CatalogGrid from "./CatalogGrid";
import EmbedSetup from "./EmbedSetup";
import { useAuth } from "@/hooks/useAuth";
import {
  getProducts, deleteProduct, getAllMerchants,
  getMerchantStats, grantGenPoints, setMerchantTier, updateShopName,
  type MerchantStats,
} from "@/lib/db";
import { supabase } from "@/lib/supabase";
import type { Product } from "@/lib/products";

type Tab  = "catalog" | "embed" | "stats";
type View = "catalog" | "add" | "edit";

const TIER_LABELS: Record<string, string> = {
  free:  "Free",
  tier1: "Tier 1",
  tier2: "Tier 2",
  tier3: "Unlimited",
};
const TIER_OPTIONS = ["free", "tier1", "tier2", "tier3"] as const;

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
  const [merchants,        setMerchants]        = useState<{ id: string; shop_name: string | null; gen_points_balance: number; subscription_tier: string }[]>([]);
  const [activeMerchantId, setActiveMerchantId] = useState<string>("");

  // Current merchant's balance for the header chip
  const [balance,   setBalance]   = useState<number | null>(null);
  const [tier,      setTier]      = useState<string>("free");

  // Shop name setup (for Google OAuth users who skipped the registration form)
  const [shopName,        setShopName]        = useState<string | null>(null);
  const [shopNameInput,   setShopNameInput]   = useState("");
  const [shopNameSaving,  setShopNameSaving]  = useState(false);

  // Stats tab state
  const [selectedMerchantId,    setSelectedMerchantId]    = useState<string | null>(null);
  const [selectedMerchantStats, setSelectedMerchantStats] = useState<MerchantStats | null>(null);
  const [statsLoading,          setStatsLoading]          = useState(false);
  const [grantAmount,           setGrantAmount]           = useState("100");
  const [grantNote,             setGrantNote]             = useState("");
  const [grantLoading,          setGrantLoading]          = useState(false);
  const [grantDone,             setGrantDone]             = useState(false);
  const [tierChanging,          setTierChanging]          = useState(false);

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
    // Fetch balance + shop name
    getMerchantStats(activeMerchantId)
      .then((s) => { setBalance(s.balance); setTier(s.tier); })
      .catch(() => {});
    supabase.from("merchants").select("shop_name").eq("id", activeMerchantId).single()
      .then(({ data }) => { setShopName(data?.shop_name ?? null); })
      .catch(() => {});
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

  // ── Shop name setup ──────────────────────────────────────────────────────
  const handleSaveShopName = async () => {
    if (!shopNameInput.trim() || !activeMerchantId) return;
    setShopNameSaving(true);
    try {
      await updateShopName(activeMerchantId, shopNameInput.trim());
      setShopName(shopNameInput.trim());
      setShopNameInput("");
      if (isSuperadmin) getAllMerchants().then(setMerchants).catch(console.error);
    } catch (err) { console.error(err); }
    finally { setShopNameSaving(false); }
  };

  // ── Stats tab helpers ────────────────────────────────────────────────────
  const loadMerchantDetail = async (merchantId: string) => {
    setSelectedMerchantId(merchantId);
    setSelectedMerchantStats(null);
    setStatsLoading(true);
    setGrantDone(false);
    try {
      const stats = await getMerchantStats(merchantId);
      setSelectedMerchantStats(stats);
    } catch (err) {
      console.error(err);
    } finally {
      setStatsLoading(false);
    }
  };

  const handleGrant = async () => {
    if (!selectedMerchantId) return;
    const amount = parseInt(grantAmount, 10);
    if (!amount || amount < 1) return;
    setGrantLoading(true);
    try {
      await grantGenPoints(selectedMerchantId, amount, grantNote);
      setGrantDone(true);
      setGrantNote("");
      // Refresh stats + merchant list
      const [stats, all] = await Promise.all([
        getMerchantStats(selectedMerchantId),
        getAllMerchants(),
      ]);
      setSelectedMerchantStats(stats);
      setMerchants(all);
    } catch (err) { console.error(err); }
    finally { setGrantLoading(false); }
  };

  const handleTierChange = async (newTier: string) => {
    if (!selectedMerchantId) return;
    setTierChanging(true);
    try {
      await setMerchantTier(selectedMerchantId, newTier);
      const [stats, all] = await Promise.all([
        getMerchantStats(selectedMerchantId),
        getAllMerchants(),
      ]);
      setSelectedMerchantStats(stats);
      setMerchants(all);
    } catch (err) { console.error(err); }
    finally { setTierChanging(false); }
  };

  if (loading || !user) return null;

  const inForm = view === "add" || view === "edit";
  const currentMerchant = merchants.find((m) => m.id === (selectedMerchantId ?? ""));

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

          {/* Gen Points balance chip */}
          {balance !== null && (
            <span className={`text-xs rounded-full px-2.5 py-1 font-medium border ${
              tier === "tier3"
                ? "border-primary/30 bg-primary/10 text-primary"
                : balance <= 5
                ? "border-destructive/30 bg-destructive/10 text-destructive"
                : "border-border bg-card text-muted-foreground"
            }`}>
              {tier === "tier3" ? "∞ Unlimited" : `${balance} pts`}
            </span>
          )}

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
            {(["catalog", "embed", ...(isSuperadmin ? ["stats"] : [])] as Tab[]).map((t) => (
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

        {/* ── Shop name setup banner — shown when merchant has no shop name yet ── */}
        {!isSuperadmin && shopName === null && (
          <div className="border-b border-primary/20 bg-primary/5 px-6 py-3 flex items-center gap-3 flex-wrap">
            <p className="text-xs text-foreground font-medium flex-shrink-0">
              👋 What's your shop name?
            </p>
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <input
                type="text"
                placeholder="e.g. TC Meble, Studio Sofa…"
                value={shopNameInput}
                onChange={(e) => setShopNameInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSaveShopName(); }}
                className="flex-1 min-w-0 rounded border border-input bg-background px-3 py-1.5
                           text-xs text-foreground placeholder:text-muted-foreground
                           focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <button
                onClick={handleSaveShopName}
                disabled={shopNameSaving || !shopNameInput.trim()}
                className="rounded border border-primary bg-primary/10 hover:bg-primary/20 px-3 py-1.5
                           text-xs font-medium text-foreground transition-colors
                           disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 flex-shrink-0"
              >
                {shopNameSaving ? <><Loader2 className="h-3 w-3 animate-spin" />Saving…</> : "Save"}
              </button>
            </div>
          </div>
        )}

        {/* ── Main ── */}
        <main className={`flex-1 mx-auto w-full px-4 py-8 ${inForm && view === "edit" ? "max-w-6xl" : "max-w-4xl"}`}>

          {/* ── FORM VIEW ── */}
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
                <div className="rounded-lg border border-border bg-card p-6 lg:max-w-lg w-full">
                  <h2 className="text-base font-medium mb-5">
                    {view === "edit" && editingProduct ? `Edit — ${editingProduct.name}` : "New product"}
                  </h2>
                  <ProductForm
                    key={editingProduct?.id ?? "new"}
                    merchantId={activeMerchantId}
                    initialProduct={view === "edit" ? editingProduct ?? undefined : undefined}
                    onSave={backToCatalog}
                    onCancel={backToCatalog}
                  />
                </div>

                {view === "edit" && editingProduct && (
                  <div className="rounded-lg border border-border bg-card p-6 flex-1 min-w-0">
                    <VariantCreator product={editingProduct} merchantId={activeMerchantId} />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── CATALOG TAB ── */}
          {!inForm && tab === "catalog" && (
            <div className="flex flex-col gap-6">
              <div className="flex items-center justify-between">
                <h1 className="text-2xl text-foreground">Product catalog</h1>
                <Button onClick={() => { setEditingProduct(null); setView("add"); }} size="sm" className="gap-2">
                  <Plus className="h-4 w-4" />Add product
                </Button>
              </div>
              {productsLoading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : (
                <CatalogGrid products={products} onDelete={handleDelete} onEdit={(p) => { setEditingProduct(p); setView("edit"); }} />
              )}
            </div>
          )}

          {/* ── EMBED TAB ── */}
          {!inForm && tab === "embed" && (
            <EmbedSetup merchantId={activeMerchantId} />
          )}

          {/* ── STATS TAB (superadmin only) ── */}
          {!inForm && tab === "stats" && isSuperadmin && (
            <div className="flex flex-col gap-6">
              <h1 className="text-2xl text-foreground">Usage statistics</h1>

              <div className="flex gap-6 flex-col lg:flex-row">
                {/* Merchant list */}
                <div className="flex-1 min-w-0">
                  <div className="rounded-lg border border-border overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border bg-secondary/30">
                          <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Shop</th>
                          <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Tier</th>
                          <th className="text-right px-4 py-2.5 text-muted-foreground font-medium">Balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {merchants.map((m) => (
                          <tr
                            key={m.id}
                            onClick={() => loadMerchantDetail(m.id)}
                            className={`border-b border-border last:border-0 cursor-pointer transition-colors ${
                              selectedMerchantId === m.id ? "bg-primary/10" : "hover:bg-secondary/30"
                            }`}
                          >
                            <td className="px-4 py-2.5 text-foreground">{m.shop_name ?? m.id.slice(0, 8)}</td>
                            <td className="px-4 py-2.5 text-muted-foreground">{TIER_LABELS[m.subscription_tier] ?? m.subscription_tier}</td>
                            <td className="px-4 py-2.5 text-right">
                              {m.subscription_tier === "tier3"
                                ? <span className="text-primary">∞</span>
                                : m.gen_points_balance}
                            </td>
                          </tr>
                        ))}
                        {merchants.length === 0 && (
                          <tr><td colSpan={3} className="px-4 py-6 text-center text-muted-foreground">No merchants yet</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Merchant detail panel */}
                {selectedMerchantId && (
                  <div className="w-full lg:w-72 flex flex-col gap-4">
                    <div className="rounded-lg border border-border bg-card p-4 flex flex-col gap-3">
                      <p className="text-xs font-medium text-foreground">
                        {currentMerchant?.shop_name ?? selectedMerchantId.slice(0, 12)}
                      </p>
                      {statsLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      ) : selectedMerchantStats && (
                        <>
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div className="rounded border border-border p-2">
                              <p className="text-muted-foreground">Balance</p>
                              <p className="text-foreground font-semibold text-sm mt-0.5">
                                {selectedMerchantStats.tier === "tier3" ? "∞" : selectedMerchantStats.balance}
                              </p>
                            </div>
                            <div className="rounded border border-border p-2">
                              <p className="text-muted-foreground">Used (month)</p>
                              <p className="text-foreground font-semibold text-sm mt-0.5">{selectedMerchantStats.usedThisMonth}</p>
                            </div>
                          </div>

                          {/* Change tier */}
                          <div className="flex flex-col gap-1">
                            <label className="text-[10px] text-muted-foreground uppercase tracking-widest">Subscription tier</label>
                            <div className="flex items-center gap-2">
                              <select
                                value={selectedMerchantStats.tier}
                                onChange={(e) => handleTierChange(e.target.value)}
                                disabled={tierChanging}
                                className="flex-1 rounded border border-input bg-background text-xs px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                              >
                                {TIER_OPTIONS.map((t) => (
                                  <option key={t} value={t}>{TIER_LABELS[t]}</option>
                                ))}
                              </select>
                              {tierChanging && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground flex-shrink-0" />}
                            </div>
                          </div>

                          {/* Grant points */}
                          <div className="flex flex-col gap-1.5">
                            <label className="text-[10px] text-muted-foreground uppercase tracking-widest">Grant points</label>
                            <div className="flex gap-2">
                              <input
                                type="number"
                                min="1"
                                value={grantAmount}
                                onChange={(e) => { setGrantAmount(e.target.value); setGrantDone(false); }}
                                className="w-20 rounded border border-input bg-background text-xs px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring"
                              />
                              <input
                                type="text"
                                placeholder="Note (optional)"
                                value={grantNote}
                                onChange={(e) => setGrantNote(e.target.value)}
                                className="flex-1 rounded border border-input bg-background text-xs px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring"
                              />
                            </div>
                            <button
                              onClick={handleGrant}
                              disabled={grantLoading}
                              className="rounded border border-primary bg-primary/10 hover:bg-primary/20 px-3 py-1.5 text-xs font-medium text-foreground transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
                            >
                              {grantLoading ? (
                                <><Loader2 className="h-3 w-3 animate-spin" />Granting…</>
                              ) : grantDone ? (
                                <><Check className="h-3 w-3 text-primary" />Granted</>
                              ) : (
                                "Grant points"
                              )}
                            </button>
                          </div>

                          {/* Transaction log */}
                          {selectedMerchantStats.transactions.length > 0 && (
                            <div className="flex flex-col gap-1">
                              <p className="text-[10px] text-muted-foreground uppercase tracking-widest">Recent transactions</p>
                              <div className="max-h-48 overflow-y-auto flex flex-col gap-0.5">
                                {selectedMerchantStats.transactions.slice(0, 30).map((tx) => (
                                  <div key={tx.id} className="flex items-center gap-2 text-[10px] py-0.5">
                                    <span className={`font-mono font-semibold w-8 text-right flex-shrink-0 ${tx.amount < 0 ? "text-destructive/70" : "text-primary"}`}>
                                      {tx.amount > 0 ? "+" : ""}{tx.amount}
                                    </span>
                                    <span className="text-muted-foreground flex-1 truncate">{tx.type}</span>
                                    <span className="text-muted-foreground/50 flex-shrink-0">
                                      {new Date(tx.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

        </main>
      </div>
    </>
  );
}
