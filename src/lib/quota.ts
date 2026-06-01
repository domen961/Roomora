/**
 * Client-side helper for Gen Point quota enforcement.
 *
 * Calls the server-side /api/use-gen-point endpoint before each room placement.
 * Fails open on any network or server error so a quota infrastructure problem
 * never blocks a legitimate user from generating a result.
 */
export interface QuotaResult {
  ok:      boolean;
  balance: number;   // -1 = unlimited / unknown
  tier:    string;
  error?:  string;
}

export async function consumeGenPoint(merchantId: string | undefined): Promise<QuotaResult> {
  // No merchantId = demo / embed mode without a merchant context — allow freely
  if (!merchantId) return { ok: true, balance: -1, tier: "demo" };

  try {
    const res = await fetch("/api/use-gen-point", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ merchantId }),
    });
    if (!res.ok) return { ok: true, balance: -1, tier: "unknown" }; // fail open
    return res.json() as Promise<QuotaResult>;
  } catch {
    return { ok: true, balance: -1, tier: "unknown" }; // fail open on network error
  }
}
