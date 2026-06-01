import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import Logo from "@/components/Logo";
import { supabase } from "@/lib/supabase";

type Mode = "login" | "register";

export default function LoginPage() {
  const navigate  = useNavigate();
  const [mode,     setMode]     = useState<Mode>("login");
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [shopName, setShopName] = useState("");
  const [loading,  setLoading]  = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error,    setError]    = useState("");
  const [verifyBanner, setVerifyBanner] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendSent, setResendSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setVerifyBanner(false);
    setLoading(true);

    try {
      if (mode === "register") {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (data.user) {
          // Insert merchant row (ignore duplicate — user may be re-registering)
          await supabase.from("merchants").upsert({
            id:        data.user.id,
            shop_name: shopName.trim() || null,
          }, { onConflict: "id", ignoreDuplicates: true });

          // If email is not yet confirmed, show verification banner instead of navigating
          if (!data.user.email_confirmed_at) {
            setVerifyBanner(true);
            return;
          }
        }
        navigate("/admin");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          if (error.message.toLowerCase().includes("email not confirmed")) {
            setVerifyBanner(true);
            return;
          }
          throw error;
        }
        navigate("/admin");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true);
    setError("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options:  { redirectTo: `${window.location.origin}/admin` },
    });
    if (error) {
      setError(error.message);
      setGoogleLoading(false);
    }
    // On success Supabase redirects — no need to navigate() manually
  };

  const handleResendVerification = async () => {
    setResending(true);
    await supabase.auth.resend({ type: "signup", email });
    setResending(false);
    setResendSent(true);
  };

  const switchMode = (m: Mode) => { setMode(m); setError(""); setVerifyBanner(false); setResendSent(false); };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm flex flex-col gap-6">
        <div className="flex flex-col items-center gap-3">
          <Logo className="h-10" />
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            {mode === "login" ? "Sign in to your account" : "Create your account"}
          </p>
        </div>

        {/* Email verification banner */}
        {verifyBanner && (
          <div className="rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 flex flex-col gap-2">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Mail className="h-4 w-4 text-primary flex-shrink-0" />
              Check your inbox
            </div>
            <p className="text-xs text-muted-foreground">
              We sent a verification link to <strong>{email}</strong>. Click it to activate your account before signing in.
            </p>
            {resendSent ? (
              <p className="text-xs text-primary">Verification email resent ✓</p>
            ) : (
              <button
                onClick={handleResendVerification}
                disabled={resending}
                className="text-xs text-primary/80 hover:text-primary underline text-left w-fit"
              >
                {resending ? "Sending…" : "Resend verification email"}
              </button>
            )}
          </div>
        )}

        {/* Google OAuth button */}
        <button
          onClick={handleGoogleSignIn}
          disabled={googleLoading}
          className="flex items-center justify-center gap-3 rounded-md border border-input bg-card px-4 py-2.5
                     text-sm text-foreground hover:bg-secondary transition-colors disabled:opacity-50"
        >
          {googleLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <svg className="h-4 w-4 flex-shrink-0" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
          )}
          Continue with Google
        </button>

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-border" />
          <span className="text-xs text-muted-foreground">or</span>
          <div className="flex-1 h-px bg-border" />
        </div>

        {/* Email / password form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {mode === "register" && (
            <input
              type="text"
              placeholder="Shop name (optional)"
              value={shopName}
              onChange={(e) => setShopName(e.target.value)}
              className="rounded-md border border-input bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          )}
          <input
            type="email"
            placeholder="Email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-md border border-input bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <input
            type="password"
            placeholder="Password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-md border border-input bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button type="submit" disabled={loading} className="gap-2">
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {mode === "login" ? "Sign in" : "Create account"}
          </Button>
        </form>

        <p className="text-center text-xs text-muted-foreground">
          {mode === "login" ? "Don't have an account?" : "Already have an account?"}{" "}
          <button
            onClick={() => switchMode(mode === "login" ? "register" : "login")}
            className="text-foreground underline hover:no-underline"
          >
            {mode === "login" ? "Register" : "Sign in"}
          </button>
        </p>
      </div>
    </div>
  );
}
