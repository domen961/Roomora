import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Check, AlertTriangle } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { updateShopName, getMerchantStats, type MerchantStats } from "@/lib/db";

interface Props {
  user:       User;
  merchantId: string;
}

const TIER_LABELS: Record<string, string> = {
  free:  "Free — 25 Gen Points",
  tier1: "Starter — 500 Gen Points / month",
  tier2: "Pro — 1,000 Gen Points / month",
  tier3: "Unlimited",
};

type Msg = { text: string; ok: boolean };

export default function AccountTab({ user, merchantId }: Props) {
  const navigate = useNavigate();

  // Detect sign-in provider — hide password/email change for OAuth users
  const isEmailUser =
    user.app_metadata?.provider === "email" ||
    (user.identities?.some((id) => id.provider === "email") ?? false);

  // ── Profile ───────────────────────────────────────────────────────────────
  const [shopNameVal,    setShopNameVal]    = useState("");
  const [shopNameSaving, setShopNameSaving] = useState(false);

  // ── Security ──────────────────────────────────────────────────────────────
  const [newPassword,    setNewPassword]    = useState("");
  const [confirmPass,    setConfirmPass]    = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [newEmail,       setNewEmail]       = useState("");
  const [emailSaving,    setEmailSaving]    = useState(false);

  // ── Plan ──────────────────────────────────────────────────────────────────
  const [stats, setStats] = useState<MerchantStats | null>(null);

  // ── Danger zone ───────────────────────────────────────────────────────────
  const [deleteOpen,    setDeleteOpen]    = useState(false);
  const [deleteInput,   setDeleteInput]   = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);

  // ── Feedback ──────────────────────────────────────────────────────────────
  const [msg, setMsg] = useState<Msg | null>(null);

  // Load shop name + stats on mount
  useEffect(() => {
    Promise.resolve(
      supabase.from("merchants").select("shop_name").eq("id", merchantId).single()
    ).then(({ data }) => setShopNameVal(data?.shop_name ?? "")).catch(() => {});

    getMerchantStats(merchantId).then(setStats).catch(() => {});
  }, [merchantId]);

  const flash = (text: string, ok: boolean) => {
    setMsg({ text, ok });
    setTimeout(() => setMsg(null), 4000);
  };

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleShopName = async () => {
    if (!shopNameVal.trim()) return;
    setShopNameSaving(true);
    try {
      await updateShopName(merchantId, shopNameVal.trim());
      flash("Shop name updated", true);
    } catch { flash("Failed to update shop name", false); }
    finally { setShopNameSaving(false); }
  };

  const handlePassword = async () => {
    if (newPassword !== confirmPass) { flash("Passwords don't match", false); return; }
    if (newPassword.length < 6)     { flash("Minimum 6 characters", false); return; }
    setPasswordSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      flash("Password updated", true);
      setNewPassword(""); setConfirmPass("");
    } catch (err: any) { flash(err.message ?? "Failed to update password", false); }
    finally { setPasswordSaving(false); }
  };

  const handleEmail = async () => {
    if (!newEmail.trim()) return;
    setEmailSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ email: newEmail.trim() });
      if (error) throw error;
      flash(`Verification link sent to ${newEmail}`, true);
      setNewEmail("");
    } catch (err: any) { flash(err.message ?? "Failed to update email", false); }
    finally { setEmailSaving(false); }
  };

  const handleSignOutOthers = async () => {
    await supabase.auth.signOut({ scope: "others" });
    flash("Signed out of all other sessions", true);
  };

  const handleDelete = async () => {
    if (deleteInput !== "DELETE") return;
    setDeleteLoading(true);
    try {
      const res = await fetch("/api/delete-account", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ merchantId }),
      });
      if (res.ok) {
        await supabase.auth.signOut();
        navigate("/login");
      } else {
        flash("Account deletion failed — please contact support", false);
        setDeleteLoading(false);
      }
    } catch {
      flash("Account deletion failed — please contact support", false);
      setDeleteLoading(false);
    }
  };

  // ── Shared input class ────────────────────────────────────────────────────
  const input =
    "w-full rounded border border-input bg-background px-3 py-2 text-sm text-foreground " +
    "placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring";

  const saveBtn = (loading: boolean, disabled?: boolean) =>
    `rounded border border-primary bg-primary/10 hover:bg-primary/20 px-4 py-2 text-xs font-medium ` +
    `text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed ` +
    `flex items-center gap-2 flex-shrink-0 ${loading || disabled ? "opacity-40 cursor-not-allowed" : ""}`;

  return (
    <div className="max-w-lg flex flex-col gap-8">

      {/* Global feedback banner */}
      {msg && (
        <div className={`rounded-lg px-4 py-2.5 text-sm flex items-center gap-2 ${
          msg.ok
            ? "bg-primary/10 border border-primary/30 text-foreground"
            : "bg-destructive/10 border border-destructive/30 text-destructive"
        }`}>
          {msg.ok ? <Check className="h-4 w-4 text-primary flex-shrink-0" /> : <AlertTriangle className="h-4 w-4 flex-shrink-0" />}
          {msg.text}
        </div>
      )}

      {/* ── Profile ── */}
      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-medium text-foreground uppercase tracking-widest">Profile</h2>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground">Shop name</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={shopNameVal}
              onChange={(e) => setShopNameVal(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleShopName(); }}
              placeholder="Your shop name"
              className={input}
            />
            <button onClick={handleShopName} disabled={shopNameSaving || !shopNameVal.trim()} className={saveBtn(shopNameSaving)}>
              {shopNameSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground">Email</label>
          <div className="flex items-center gap-3">
            <p className="text-sm text-foreground">{user.email}</p>
            <span className="text-[10px] rounded-full border border-border px-2 py-0.5 text-muted-foreground">
              {isEmailUser ? "Email & Password" : "Google Account"}
            </span>
          </div>
        </div>
      </section>

      <hr className="border-border" />

      {/* ── Security ── */}
      <section className="flex flex-col gap-5">
        <h2 className="text-sm font-medium text-foreground uppercase tracking-widest">Security</h2>

        {isEmailUser ? (
          <>
            {/* Change password */}
            <div className="flex flex-col gap-3">
              <p className="text-xs text-muted-foreground font-medium">Change password</p>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="New password"
                className={input}
              />
              <input
                type="password"
                value={confirmPass}
                onChange={(e) => setConfirmPass(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handlePassword(); }}
                placeholder="Confirm new password"
                className={input}
              />
              <button onClick={handlePassword} disabled={passwordSaving || !newPassword} className={`${saveBtn(passwordSaving)} w-fit`}>
                {passwordSaving ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Updating…</> : "Update password"}
              </button>
            </div>

            {/* Change email */}
            <div className="flex flex-col gap-3">
              <p className="text-xs text-muted-foreground font-medium">Change email</p>
              <div className="flex gap-2">
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleEmail(); }}
                  placeholder="New email address"
                  className={input}
                />
                <button onClick={handleEmail} disabled={emailSaving || !newEmail.trim()} className={saveBtn(emailSaving)}>
                  {emailSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Send link"}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">A verification link will be sent to the new address. Your email doesn't change until you click it.</p>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            You signed in with Google. To change your password or email, visit{" "}
            <a href="https://myaccount.google.com" target="_blank" rel="noopener noreferrer" className="text-foreground underline hover:no-underline">
              myaccount.google.com
            </a>.
          </p>
        )}

        {/* Sign out all devices */}
        <div className="flex flex-col gap-1.5">
          <p className="text-xs text-muted-foreground font-medium">Other sessions</p>
          <button onClick={handleSignOutOthers} className="rounded border border-border bg-card hover:bg-secondary px-4 py-2 text-xs text-foreground transition-colors w-fit">
            Sign out all other devices
          </button>
        </div>
      </section>

      <hr className="border-border" />

      {/* ── Plan & Usage ── */}
      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-medium text-foreground uppercase tracking-widest">Plan & Usage</h2>

        {stats ? (
          <div className="flex flex-col gap-3">
            <div className="rounded-lg border border-border bg-card px-4 py-3 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <p className="text-sm text-foreground font-medium">
                  {TIER_LABELS[stats.tier] ?? stats.tier}
                </p>
                <span className={`text-xs rounded-full px-2.5 py-0.5 font-medium border ${
                  stats.tier === "tier3"
                    ? "border-primary/30 bg-primary/10 text-primary"
                    : "border-border text-muted-foreground"
                }`}>
                  {stats.tier === "tier3" ? "Unlimited" : `${stats.balance} remaining`}
                </span>
              </div>
              <div className="flex gap-4 text-xs text-muted-foreground">
                <span>Used this month: <strong className="text-foreground">{stats.usedThisMonth}</strong></span>
              </div>
            </div>

            <button
              disabled
              className="rounded border border-border px-4 py-2 text-xs text-muted-foreground cursor-not-allowed opacity-50 w-fit"
              title="Paid plans coming soon"
            >
              Upgrade plan — coming soon
            </button>
          </div>
        ) : (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </section>

      <hr className="border-border" />

      {/* ── Danger zone ── */}
      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-medium text-destructive uppercase tracking-widest">Danger zone</h2>

        {!deleteOpen ? (
          <button
            onClick={() => setDeleteOpen(true)}
            className="rounded border border-destructive/40 bg-destructive/5 hover:bg-destructive/10 px-4 py-2 text-xs text-destructive transition-colors w-fit"
          >
            Delete account…
          </button>
        ) : (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 flex flex-col gap-3">
            <p className="text-xs text-destructive font-medium">This is permanent. All your products, variants, and data will be deleted.</p>
            <p className="text-xs text-muted-foreground">Type <strong className="text-foreground font-mono">DELETE</strong> to confirm.</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={deleteInput}
                onChange={(e) => setDeleteInput(e.target.value)}
                placeholder="DELETE"
                className={`${input} max-w-[160px] font-mono`}
              />
              <button
                onClick={handleDelete}
                disabled={deleteInput !== "DELETE" || deleteLoading}
                className="rounded border border-destructive bg-destructive/10 hover:bg-destructive/20 px-4 py-2 text-xs text-destructive font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {deleteLoading ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Deleting…</> : "Delete account"}
              </button>
              <button onClick={() => { setDeleteOpen(false); setDeleteInput(""); }} className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2">
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

    </div>
  );
}
