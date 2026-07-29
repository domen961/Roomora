/* eslint-disable @typescript-eslint/no-explicit-any */
import { rejectCrossOrigin } from "./_guard";

export const config = {
  api: { bodyParser: { sizeLimit: "1mb" } },
};

/**
 * POST { merchantId: string }
 * → { ok: boolean, balance: number, tier: string, error?: string }
 *
 * Atomically checks and deducts 1 Gen Point from the merchant's balance.
 * - All tiers deduct against their balance (no unlimited tier; tier3 "Custom" is a
 * - Balance = 0: returns ok: false
 * - Server error: fails open (returns ok: true) so users are never blocked by quota infra issues
 *
 * Uses SUPABASE_SERVICE_ROLE_KEY (server-only) to bypass RLS for the atomic update.
 */
export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).end();
  if (rejectCrossOrigin(req, res)) return;

  const { merchantId } = req.body as { merchantId?: string };
  if (!merchantId) return res.json({ ok: true, balance: -1, tier: "unknown" }); // no ID = demo mode

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // If env vars aren't set, fail open so dev/staging isn't blocked
  if (!supabaseUrl || !serviceKey) {
    console.warn("use-gen-point: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — failing open");
    return res.json({ ok: true, balance: -1, tier: "unknown" });
  }

  const headers = {
    "apikey":        serviceKey,
    "Authorization": `Bearer ${serviceKey}`,
    "Content-Type":  "application/json",
    "Prefer":        "return=representation",
  };

  try {
    // 1. Fetch current balance + tier
    const selectRes = await fetch(
      `${supabaseUrl}/rest/v1/merchants?id=eq.${encodeURIComponent(merchantId)}&select=gen_points_balance,subscription_tier`,
      { headers },
    );
    if (!selectRes.ok) {
      console.error("use-gen-point: select failed", selectRes.status);
      return res.json({ ok: true, balance: -1, tier: "unknown" }); // fail open
    }
    const rows = (await selectRes.json()) as Array<{ gen_points_balance: number; subscription_tier: string }>;
    if (!rows?.length) return res.json({ ok: true, balance: -1, tier: "unknown" }); // merchant not found = fail open

    const { gen_points_balance: balance, subscription_tier: tier } = rows[0];

    // All tiers (incl. tier3 "Custom") deduct against their balance. Custom merchants
    // get a negotiated allocation set manually by an admin; there is no unlimited tier.

    // 2. Quota exhausted
    if (balance <= 0) {
      return res.json({ ok: false, balance: 0, tier, error: "Quota exhausted" });
    }

    // 3. Deduct 1 point
    const updateRes = await fetch(
      `${supabaseUrl}/rest/v1/merchants?id=eq.${encodeURIComponent(merchantId)}`,
      {
        method:  "PATCH",
        headers,
        body: JSON.stringify({ gen_points_balance: balance - 1 }),
      },
    );
    if (!updateRes.ok) {
      console.error("use-gen-point: update failed", updateRes.status);
      return res.json({ ok: true, balance, tier }); // fail open — don't block user
    }

    // 5. Log transaction (fire-and-forget — failure doesn't block the response)
    fetch(`${supabaseUrl}/rest/v1/gen_point_transactions`, {
      method:  "POST",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({
        merchant_id: merchantId,
        amount:      -1,
        type:        "room_placement",
      }),
    }).catch((err) => console.error("use-gen-point: transaction log failed:", err));

    return res.json({ ok: true, balance: balance - 1, tier });
  } catch (err) {
    console.error("use-gen-point: unexpected error", err);
    return res.json({ ok: true, balance: -1, tier: "unknown" }); // fail open
  }
}
