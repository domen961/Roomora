import { supabase } from "./supabase";
import type { Product, FurnitureCategory } from "./products";

// ── Snapshot upload ────────────────────────────────────────────────────────────

async function uploadSnapshot(
  merchantId: string,
  productId: string,
  angle: string,
  imageSource: string,     // data URL  OR  http(s) URL
): Promise<string> {
  let blob: Blob;

  if (imageSource.startsWith("data:")) {
    // Data URL — fetch() handles these natively
    const res = await fetch(imageSource);
    blob = await res.blob();
  } else {
    // External HTTP URL — proxy through /api/scrape to bypass CORS
    const proxyRes = await fetch(
      `/api/scrape?url=${encodeURIComponent(imageSource)}&type=image`,
    );
    if (!proxyRes.ok) throw new Error("Image proxy download failed");
    const { data, mimeType } = await proxyRes.json();
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    blob = new Blob([bytes], { type: mimeType ?? "image/jpeg" });
  }

  const path = `${merchantId}/${productId}/${angle}.jpg`;

  const { error } = await supabase.storage
    .from("product-images")
    .upload(path, blob, { contentType: "image/jpeg", upsert: true });

  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  const { data } = supabase.storage.from("product-images").getPublicUrl(path);
  // Append a version timestamp so CDN-cached old images are never served after an update
  return `${data.publicUrl}?v=${Date.now()}`;
}

// ── Product CRUD ───────────────────────────────────────────────────────────────

export interface DBProduct {
  id:          string;
  merchant_id: string;
  name:        string;
  description: string;
  category:    string | null;
  image_0:     string | null;
  image_1:     string | null;
  image_2:     string | null;   // AI-generated steep-angle diagonal view (~75°)
  image_3:     string | null;   // AI-generated steep-angle front view (~75°)
  thumbnail:   string | null;
  length_cm:   number | null;
  width_cm:    number | null;
  height_cm:   number | null;
  created_at:  string;
}

export interface ProductDimensions {
  length_cm?: number | null;
  width_cm?:  number | null;
  height_cm?: number | null;
}

/** Convert a DB row to the Product shape used by the app */
export function dbRowToProduct(row: DBProduct): Product {
  return {
    id:          row.id,
    name:        row.name,
    description: row.description,
    category:    (row.category as FurnitureCategory) ?? null,
    images:      [row.image_0, row.image_1, row.image_2, row.image_3]
                   .filter((url): url is string => !!url && url !== ""),
    thumbnail:   row.thumbnail ?? "",
    length_cm:   row.length_cm  ?? null,
    width_cm:    row.width_cm   ?? null,
    height_cm:   row.height_cm  ?? null,
  };
}

/** Fetch all products for a merchant */
export async function getProducts(merchantId: string): Promise<Product[]> {
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("merchant_id", merchantId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data as DBProduct[]).map(dbRowToProduct);
}

/** Save a new product — uploads images to Storage, then inserts DB row */
export async function saveProduct(
  merchantId:  string,
  id:          string,
  name:        string,
  description: string,
  images:      string[],         // [image_0, image_1] — data URLs or http URLs
  dimensions?: ProductDimensions,
  category?:   string | null,
): Promise<void> {
  const [url0, url1, url2, url3] = await Promise.all([
    uploadSnapshot(merchantId, id, "perspective",   images[0]),
    uploadSnapshot(merchantId, id, "front",         images[1] ?? images[0]),
    images[2] ? uploadSnapshot(merchantId, id, "topdown",       images[2]) : Promise.resolve(null),
    images[3] ? uploadSnapshot(merchantId, id, "topdown_front", images[3]) : Promise.resolve(null),
  ]);

  const { error } = await supabase.from("products").insert({
    id,
    merchant_id: merchantId,
    name,
    description,
    category:  category ?? null,
    image_0:   url0,
    image_1:   url1,
    image_2:   url2 ?? null,
    image_3:   url3 ?? null,
    thumbnail: null,
    length_cm: dimensions?.length_cm ?? null,
    width_cm:  dimensions?.width_cm  ?? null,
    height_cm: dimensions?.height_cm ?? null,
  });

  if (error) throw new Error(error.message);
}

/** Update an existing product — re-uploads only images that aren't already in Storage */
export async function updateProduct(
  merchantId:  string,
  productId:   string,
  name:        string,
  description: string,
  images:      string[],
  dimensions?: ProductDimensions,
  category?:   string | null,
): Promise<void> {
  // Only reuse the existing Supabase URL if the source is a data URL that
  // was never changed (indicated by it being the exact stored URL, sans query string).
  // Any new image (data URL or different http URL) always triggers a fresh upload.
  const storagePath = `/product-images/${merchantId}/${productId}/`;
  const uploadOrReuse = (src: string, angle: string) =>
    src.startsWith("data:") || !src.includes(storagePath)
      ? uploadSnapshot(merchantId, productId, angle, src)
      : Promise.resolve(src);  // unchanged — exact same Supabase URL, skip re-upload

  const [url0, url1, url2, url3] = await Promise.all([
    uploadOrReuse(images[0], "perspective"),
    uploadOrReuse(images[1] ?? images[0], "front"),
    images[2] ? uploadOrReuse(images[2], "topdown")       : Promise.resolve(null),
    images[3] ? uploadOrReuse(images[3], "topdown_front") : Promise.resolve(null),
  ]);

  const { error } = await supabase.from("products").update({
    name,
    description,
    category:  category ?? null,
    image_0:   url0,
    image_1:   url1,
    image_2:   url2 ?? null,
    image_3:   url3 ?? null,
    thumbnail: null,
    length_cm: dimensions?.length_cm ?? null,
    width_cm:  dimensions?.width_cm  ?? null,
    height_cm: dimensions?.height_cm ?? null,
  }).eq("id", productId).eq("merchant_id", merchantId);

  if (error) throw new Error(error.message);
}

/** Delete a product and its storage files */
export async function deleteProduct(
  merchantId: string,
  productId:  string,
): Promise<void> {
  await supabase.storage.from("product-images").remove([
    `${merchantId}/${productId}/perspective.jpg`,
    `${merchantId}/${productId}/front.jpg`,
    `${merchantId}/${productId}/topdown.jpg`,
    `${merchantId}/${productId}/topdown_front.jpg`,
  ]);

  const { error } = await supabase
    .from("products")
    .delete()
    .eq("id", productId)
    .eq("merchant_id", merchantId);

  if (error) throw new Error(error.message);
}

// ── Product Variant CRUD ───────────────────────────────────────────────────────

/** Serialised form of a PartRow stored in the DB (textures as storage URLs, not data URLs) */
export interface StoredPartConfig {
  id:              string;
  targetPart:      string;
  mode:            "color" | "texture";
  colorHex:        string;
  colorDesc:       string;
  hexAutoResolved: boolean;
  textureUrl:      string | null;  // Supabase storage URL or null
}

export interface ProductVariant {
  id:          string;
  product_id:  string;
  name:        string;
  images:      string[];   // [image_0..image_3] filtered non-null
  partConfig?: StoredPartConfig[];
}

async function uploadVariantSnapshot(
  merchantId: string,
  productId:  string,
  variantId:  string,
  angle:      string,
  imageSource: string,
): Promise<string> {
  let blob: Blob;

  if (imageSource.startsWith("data:")) {
    const res = await fetch(imageSource);
    blob = await res.blob();
  } else {
    const proxyRes = await fetch(
      `/api/scrape?url=${encodeURIComponent(imageSource)}&type=image`,
    );
    if (!proxyRes.ok) throw new Error("Image proxy download failed");
    const { data, mimeType } = await proxyRes.json();
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    blob = new Blob([bytes], { type: mimeType ?? "image/jpeg" });
  }

  const path = `${merchantId}/${productId}/variants/${variantId}/${angle}.jpg`;

  const { error } = await supabase.storage
    .from("product-images")
    .upload(path, blob, { contentType: "image/jpeg", upsert: true });

  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  const { data } = supabase.storage.from("product-images").getPublicUrl(path);
  return `${data.publicUrl}?v=${Date.now()}`;
}

/** Fetch all variants for a product */
export async function getVariants(
  merchantId: string,
  productId:  string,
): Promise<ProductVariant[]> {
  const { data, error } = await supabase
    .from("product_variants")
    .select("*")
    .eq("merchant_id", merchantId)
    .eq("product_id",  productId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []).map((row: Record<string, unknown>) => {
    let partConfig: StoredPartConfig[] | undefined;
    try {
      if (typeof row.part_config === "string" && row.part_config) {
        partConfig = JSON.parse(row.part_config);
      }
    } catch { /* ignore malformed JSON */ }
    return {
      id:         row.id         as string,
      product_id: row.product_id as string,
      name:       row.name       as string,
      images:     [row.image_0, row.image_1, row.image_2, row.image_3]
                    .filter((url): url is string => typeof url === "string" && url !== ""),
      partConfig,
    };
  });
}

/** Save a new variant — uploads up to 4 images to variants/ sub-path, inserts row */
export async function saveVariant(
  merchantId: string,
  productId:  string,
  variantId:  string,
  name:       string,
  images:     (string | null)[],       // up to 4 slots; null = slot was not generated
  partConfig?: StoredPartConfig[],     // optional: the part-row configuration to restore on next edit
): Promise<void> {
  const ANGLES = ["perspective", "front", "topdown", "topdown_front"] as const;
  const urls = await Promise.all(
    ANGLES.map((angle, i) => {
      const img = images[i] ?? null;
      return img
        ? uploadVariantSnapshot(merchantId, productId, variantId, angle, img)
        : Promise.resolve(null);
    }),
  );

  // For texture parts whose textureUrl is still a data URL, upload to storage
  // so the config can be persisted without exceeding column size limits.
  let storedConfig: StoredPartConfig[] | null = null;
  if (partConfig && partConfig.length > 0) {
    storedConfig = await Promise.all(
      partConfig.map(async (p, idx) => {
        if (p.mode === "texture" && p.textureUrl?.startsWith("data:")) {
          try {
            const storageUrl = await uploadVariantSnapshot(
              merchantId, productId, variantId, `texture_${idx}`, p.textureUrl,
            );
            return { ...p, textureUrl: storageUrl };
          } catch {
            return { ...p, textureUrl: null }; // graceful: lose the texture ref rather than throw
          }
        }
        return p;
      }),
    );
  }

  const { error } = await supabase.from("product_variants").insert({
    id:          variantId,
    product_id:  productId,
    merchant_id: merchantId,
    name,
    image_0:     urls[0] ?? null,
    image_1:     urls[1] ?? null,
    image_2:     urls[2] ?? null,
    image_3:     urls[3] ?? null,
    part_config: storedConfig ? JSON.stringify(storedConfig) : null,
  });

  if (error) throw new Error(error.message);
}

/** Delete a variant and its storage files */
export async function deleteVariant(
  merchantId: string,
  productId:  string,
  variantId:  string,
): Promise<void> {
  const ANGLES = ["perspective", "front", "topdown", "topdown_front"];
  await supabase.storage.from("product-images").remove(
    ANGLES.map((a) => `${merchantId}/${productId}/variants/${variantId}/${a}.jpg`),
  );

  const { error } = await supabase
    .from("product_variants")
    .delete()
    .eq("id",          variantId)
    .eq("product_id",  productId)
    .eq("merchant_id", merchantId);

  if (error) throw new Error(error.message);
}

/** Rename a saved variant */
export async function renameVariant(
  merchantId: string,
  productId:  string,
  variantId:  string,
  name:       string,
): Promise<void> {
  const { error } = await supabase
    .from("product_variants")
    .update({ name })
    .eq("id",          variantId)
    .eq("product_id",  productId)
    .eq("merchant_id", merchantId);
  if (error) throw new Error(error.message);
}

/** Fetch all merchants — superadmin only (RLS enforced) */
export async function getAllMerchants(): Promise<{ id: string; shop_name: string | null; gen_points_balance: number; subscription_tier: string }[]> {
  const { data, error } = await supabase
    .from("merchants")
    .select("id, shop_name, gen_points_balance, subscription_tier")
    .order("created_at");

  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id:                  row.id         as string,
    shop_name:           row.shop_name  as string | null,
    gen_points_balance:  (row.gen_points_balance as number) ?? 0,
    subscription_tier:   (row.subscription_tier  as string) ?? "free",
  }));
}

// ── Gen Points ──────────────────────────────────────────────────────────────

export interface GenPointTransaction {
  id:         string;
  amount:     number;
  type:       string;
  note:       string | null;
  created_at: string;
}

export interface MerchantStats {
  balance:          number;
  tier:             string;
  usedThisMonth:    number;
  transactions:     GenPointTransaction[];
}

/** Fetch Gen Point balance, tier, and transaction history for a merchant */
export async function getMerchantStats(merchantId: string): Promise<MerchantStats> {
  const [merchantRes, txRes] = await Promise.all([
    supabase
      .from("merchants")
      .select("gen_points_balance, subscription_tier")
      .eq("id", merchantId)
      .single(),
    supabase
      .from("gen_point_transactions")
      .select("id, amount, type, note, created_at")
      .eq("merchant_id", merchantId)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  if (merchantRes.error) throw new Error(merchantRes.error.message);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const transactions = (txRes.data ?? []) as GenPointTransaction[];
  const usedThisMonth = transactions
    .filter((t) => t.amount < 0 && t.created_at >= monthStart)
    .reduce((sum, t) => sum + Math.abs(t.amount), 0);

  return {
    balance:       (merchantRes.data.gen_points_balance as number) ?? 0,
    tier:          (merchantRes.data.subscription_tier  as string) ?? "free",
    usedThisMonth,
    transactions,
  };
}

/** Grant Gen Points to a merchant — superadmin action */
export async function grantGenPoints(merchantId: string, amount: number, note: string): Promise<void> {
  const { data: merchant, error: fetchErr } = await supabase
    .from("merchants")
    .select("gen_points_balance")
    .eq("id", merchantId)
    .single();
  if (fetchErr) throw new Error(fetchErr.message);

  const newBalance = ((merchant.gen_points_balance as number) ?? 0) + amount;
  const { error: updateErr } = await supabase
    .from("merchants")
    .update({ gen_points_balance: newBalance })
    .eq("id", merchantId);
  if (updateErr) throw new Error(updateErr.message);

  const { error: txErr } = await supabase.from("gen_point_transactions").insert({
    merchant_id: merchantId,
    amount,
    type: "admin_grant",
    note: note || null,
  });
  if (txErr) throw new Error(txErr.message);
}

const TIER_DEFAULTS: Record<string, number> = {
  free:  25,
  tier1: 500,
  tier2: 1000,
  tier3: 999999, // effectively unlimited — checked by tier name, not balance
};

/** Change a merchant's subscription tier and reset their balance — superadmin action */
export async function setMerchantTier(merchantId: string, tier: string): Promise<void> {
  const newBalance = TIER_DEFAULTS[tier] ?? 25;
  const { error: updateErr } = await supabase
    .from("merchants")
    .update({ subscription_tier: tier, gen_points_balance: newBalance })
    .eq("id", merchantId);
  if (updateErr) throw new Error(updateErr.message);

  const { error: txErr } = await supabase.from("gen_point_transactions").insert({
    merchant_id: merchantId,
    amount:      newBalance,
    type:        "subscription_credit",
    note:        `Tier changed to ${tier}`,
  });
  if (txErr) throw new Error(txErr.message);
}
