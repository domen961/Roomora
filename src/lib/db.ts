import { supabase } from "./supabase";
import type { Product } from "./products";

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
  return data.publicUrl;
}

// ── Product CRUD ───────────────────────────────────────────────────────────────

export interface DBProduct {
  id:          string;
  merchant_id: string;
  name:        string;
  description: string;
  image_0:     string | null;
  image_1:     string | null;
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
    images:      [row.image_0 ?? "", row.image_1 ?? ""].filter(Boolean),
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
  images:      string[],         // [image_0, image_1, thumbnail] — data URLs or http URLs
  dimensions?: ProductDimensions,
): Promise<void> {
  const [url0, url1, urlThumb] = await Promise.all([
    uploadSnapshot(merchantId, id, "perspective", images[0]),
    uploadSnapshot(merchantId, id, "front",       images[1] ?? images[0]),
    uploadSnapshot(merchantId, id, "side",        images[2] ?? images[0]),
  ]);

  const { error } = await supabase.from("products").insert({
    id,
    merchant_id: merchantId,
    name,
    description,
    image_0:   url0,
    image_1:   url1,
    thumbnail: urlThumb,
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
): Promise<void> {
  // If the URL already points to this product's storage folder, reuse it as-is
  const uploadOrReuse = (src: string, angle: string) =>
    src.includes(`/product-images/${merchantId}/${productId}/`)
      ? Promise.resolve(src)
      : uploadSnapshot(merchantId, productId, angle, src);

  const [url0, url1, urlThumb] = await Promise.all([
    uploadOrReuse(images[0], "perspective"),
    uploadOrReuse(images[1] ?? images[0], "front"),
    uploadOrReuse(images[2] ?? images[0], "side"),
  ]);

  const { error } = await supabase.from("products").update({
    name,
    description,
    image_0:   url0,
    image_1:   url1,
    thumbnail: urlThumb,
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
    `${merchantId}/${productId}/side.jpg`,
  ]);

  const { error } = await supabase
    .from("products")
    .delete()
    .eq("id", productId)
    .eq("merchant_id", merchantId);

  if (error) throw new Error(error.message);
}

/** Fetch all merchants — superadmin only (RLS enforced) */
export async function getAllMerchants(): Promise<{ id: string; shop_name: string | null }[]> {
  const { data, error } = await supabase
    .from("merchants")
    .select("id, shop_name")
    .order("created_at");

  if (error) throw new Error(error.message);
  return data ?? [];
}
