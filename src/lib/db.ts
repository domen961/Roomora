import { supabase } from "./supabase";
import type { Product } from "./products";

// ── Snapshot upload ────────────────────────────────────────────────────────────

async function uploadSnapshot(
  merchantId: string,
  productId: string,
  angle: string,
  dataUrl: string,
): Promise<string> {
  // Convert base64 data URL to Blob
  const res  = await fetch(dataUrl);
  const blob = await res.blob();

  const path = `${merchantId}/${productId}/${angle}.jpg`;

  const { error } = await supabase.storage
    .from("product-images")
    .upload(path, blob, { contentType: "image/jpeg", upsert: true });

  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  const { data } = supabase.storage.from("product-images").getPublicUrl(path);
  return data.publicUrl;
}

// ── Product CRUD ───────────────────────────────────────────────────────────────

export interface DBProduct {
  id: string;
  merchant_id: string;
  name: string;
  description: string;
  image_0: string | null;
  image_1: string | null;
  thumbnail: string | null;
  created_at: string;
}

/** Convert a DB row to the Product shape used by the app */
export function dbRowToProduct(row: DBProduct): Product {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    images: [row.image_0 ?? "", row.image_1 ?? ""].filter(Boolean),
    thumbnail: row.thumbnail ?? "",
  };
}

/** Fetch all products for a merchant (or all products for superadmin) */
export async function getProducts(merchantId: string): Promise<Product[]> {
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("merchant_id", merchantId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data as DBProduct[]).map(dbRowToProduct);
}

/** Save a new product — uploads snapshots to Storage first, then inserts row */
export async function saveProduct(
  merchantId: string,
  id: string,
  name: string,
  description: string,
  snapshots: string[], // [perspective, front, side]
): Promise<void> {
  const [url0, url1, urlThumb] = await Promise.all([
    uploadSnapshot(merchantId, id, "perspective", snapshots[0]),
    uploadSnapshot(merchantId, id, "front",       snapshots[1]),
    uploadSnapshot(merchantId, id, "side",         snapshots[2]),
  ]);

  const { error } = await supabase.from("products").insert({
    id,
    merchant_id: merchantId,
    name,
    description,
    image_0:   url0,
    image_1:   url1,
    thumbnail: urlThumb,
  });

  if (error) throw new Error(error.message);
}

/** Delete a product and its storage files */
export async function deleteProduct(
  merchantId: string,
  productId: string,
): Promise<void> {
  await supabase.storage.from("product-images").remove([
    `${merchantId}/${productId}/perspective.jpg`,
    `${merchantId}/${productId}/front.jpg`,
    `${merchantId}/${productId}/side.jpg`,
  ]);

  const { error } = await supabase
    .from("products")
    .delete()
    .eq("id", productId)
    .eq("merchant_id", merchantId);

  if (error) throw new Error(error.message);
}

/** Fetch all merchants — only works for superadmin (RLS) */
export async function getAllMerchants(): Promise<{ id: string; shop_name: string | null }[]> {
  const { data, error } = await supabase
    .from("merchants")
    .select("id, shop_name")
    .order("created_at");

  if (error) throw new Error(error.message);
  return data ?? [];
}
