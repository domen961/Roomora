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

export interface ProductVariant {
  id:         string;
  product_id: string;
  name:       string;
  images:     string[];   // [image_0..image_3] filtered non-null
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
  return (data ?? []).map((row: Record<string, unknown>) => ({
    id:         row.id         as string,
    product_id: row.product_id as string,
    name:       row.name       as string,
    images:     [row.image_0, row.image_1, row.image_2, row.image_3]
                  .filter((url): url is string => typeof url === "string" && url !== ""),
  }));
}

/** Save a new variant — uploads up to 4 images to variants/ sub-path, inserts row */
export async function saveVariant(
  merchantId: string,
  productId:  string,
  variantId:  string,
  name:       string,
  images:     (string | null)[],   // up to 4 slots; null = slot was not generated
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

  const { error } = await supabase.from("product_variants").insert({
    id:          variantId,
    product_id:  productId,
    merchant_id: merchantId,
    name,
    image_0:     urls[0] ?? null,
    image_1:     urls[1] ?? null,
    image_2:     urls[2] ?? null,
    image_3:     urls[3] ?? null,
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

/** Fetch all merchants — superadmin only (RLS enforced) */
export async function getAllMerchants(): Promise<{ id: string; shop_name: string | null }[]> {
  const { data, error } = await supabase
    .from("merchants")
    .select("id, shop_name")
    .order("created_at");

  if (error) throw new Error(error.message);
  return data ?? [];
}
