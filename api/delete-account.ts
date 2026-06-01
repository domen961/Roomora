/* eslint-disable @typescript-eslint/no-explicit-any */

export const config = {
  api: { bodyParser: { sizeLimit: "1mb" } },
};

/**
 * POST { merchantId: string }
 * Deletes the merchant's auth user (which cascades to merchants, products,
 * product_variants via ON DELETE CASCADE) and removes their storage files.
 * Uses SUPABASE_SERVICE_ROLE_KEY — never callable from the browser directly.
 */
export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).end();

  const { merchantId } = req.body as { merchantId?: string };
  if (!merchantId) return res.status(400).json({ error: "Missing merchantId" });

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    console.error("delete-account: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return res.status(500).json({ error: "Server misconfigured" });
  }

  const headers = {
    "apikey":        serviceKey,
    "Authorization": `Bearer ${serviceKey}`,
    "Content-Type":  "application/json",
  };

  try {
    // 1. List and delete all storage files for this merchant
    const listRes = await fetch(
      `${supabaseUrl}/storage/v1/object/list/product-images/${merchantId}`,
      { method: "POST", headers, body: JSON.stringify({ limit: 1000, prefix: "" }) },
    );
    if (listRes.ok) {
      const files = await listRes.json() as { name: string }[];
      if (files?.length) {
        await fetch(`${supabaseUrl}/storage/v1/object`, {
          method: "DELETE",
          headers,
          body: JSON.stringify({
            prefixes: files.map((f) => `product-images/${merchantId}/${f.name}`),
          }),
        });
      }
    }

    // 2. Delete the auth user — cascades to merchants / products / variants
    const deleteRes = await fetch(
      `${supabaseUrl}/auth/v1/admin/users/${merchantId}`,
      { method: "DELETE", headers },
    );

    if (!deleteRes.ok) {
      const err = await deleteRes.text();
      console.error("delete-account: auth delete failed", deleteRes.status, err);
      return res.status(500).json({ error: "Failed to delete account" });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("delete-account: unexpected error", err);
    return res.status(500).json({ error: "Server error" });
  }
}
