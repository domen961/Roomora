import { useState } from "react";
import { Download, RefreshCw, RotateCcw, Share2, Sparkles, Grid3x3, Wand2, SlidersHorizontal, Loader2 } from "lucide-react";
import Logo from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";
import { refinePlacement, type RefineMode } from "@/lib/gemini";
import { consumeGenPoint } from "@/lib/quota";

interface Props {
  result:             string;
  productName:        string;
  category?:          string | null;   // for the Fix correction prompt
  merchantId?:        string;          // to charge a Gen Point for Fix/HD
  onReset:            () => void;
  onRegenerate?:      () => void;  // re-run with the same room photo
  freeRegenAvailable?: boolean;    // true until the one free regeneration is used
}

const isMobile =
  typeof navigator !== "undefined" &&
  (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

export default function ResultStep({ result, productName, category, merchantId, onReset, onRegenerate, freeRegenAvailable }: Props) {
  const filename = `furora-${productName.replace(/\s+/g, "-").toLowerCase()}.jpg`;
  const regenHint = freeRegenAvailable ? t("regenFree") : t("regenAgain");

  // "Fix"/"HD" passes — refine or upgrade the current result in place (repeatable).
  const [fixed, setFixed] = useState<string | null>(null);
  const [fixing, setFixing] = useState(false);
  const [busyLabel, setBusyLabel] = useState("");
  const [isHd, setIsHd] = useState(false);
  const [quotaMsg, setQuotaMsg] = useState("");
  const [showOptions, setShowOptions] = useState(false);
  const shown = fixed ?? result;

  const handleFix = async (mode: RefineMode) => {
    setFixing(true);
    setBusyLabel(mode === "hd" ? t("generatingHd") : t("fixing"));
    setQuotaMsg("");
    try {
      // Fix/HD are AI generations — charge a Gen Point (metered tiers) so heavy use is billed,
      // not absorbed. Fails open on server/network error; Custom/demo don't deduct.
      const quota = await consumeGenPoint(merchantId ?? "");
      if (!quota.ok) { setQuotaMsg(t("quotaExhausted")); return; }
      const out = await refinePlacement(shown, category, mode);
      setFixed(out);
      if (mode === "hd") setIsHd(true);
    } catch (err) {
      console.error("[Furora] refine failed:", err);
    } finally {
      setFixing(false);
    }
  };

  const handleDownload = () => {
    const a = document.createElement("a");
    a.href = shown;
    a.download = filename;
    a.click();
  };

  const handleShare = async () => {
    try {
      const res  = await fetch(shown);
      const blob = await res.blob();
      const file = new File([blob], filename, { type: "image/jpeg" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `${productName} ${t("inYourRoom")}` });
      } else {
        handleDownload(); // fallback: download if share API unavailable
      }
    } catch {
      // user cancelled — ignore
    }
  };

  // ── Mobile: full-screen overlay (matches CapturePage result) ────────────────
  if (isMobile) {
    return (
      <div className="relative w-full bg-background overflow-hidden" style={{ height: "100dvh" }}>
        <img src={shown} alt={`${productName} placed in room`}
          className="absolute inset-0 w-full h-full object-contain" />
        {fixing && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <div className="flex flex-col items-center gap-2 text-white">
              <Loader2 className="h-8 w-8 animate-spin" />
              <span className="text-sm">{busyLabel}</span>
            </div>
          </div>
        )}
        <div className="absolute bottom-0 left-0 right-0 h-44 bg-gradient-to-t from-black/85 to-transparent pointer-events-none" />
        <div className="absolute top-8 left-0 right-0 flex items-center justify-between px-6">
          <div className="w-10" /> {/* spacer */}
          <div className="pointer-events-none"><Logo /></div>
          <button onClick={handleShare}
            className="w-10 h-10 rounded-full bg-white/20 backdrop-blur-sm border border-white/30
                       flex items-center justify-center active:scale-95 transition-transform shadow-lg"
            aria-label="Share">
            <Share2 className="h-5 w-5 text-white" />
          </button>
        </div>
        <div className="absolute bottom-7 left-0 right-0 flex flex-col items-center gap-2 px-6">
          {/* Expandable options — only shown when the user taps Options */}
          {showOptions && (
            <div className="w-full max-w-xs flex flex-col gap-2 mb-1">
              <div className="flex gap-2">
                <button onClick={() => handleFix("straighten")} disabled={fixing}
                  className="flex-1 flex items-center justify-center gap-2 rounded-xl border border-primary/40 bg-primary/15 backdrop-blur-sm py-2.5 text-sm font-medium text-white active:scale-95 transition-transform disabled:opacity-50">
                  <Sparkles className="h-4 w-4" />{t("straighten")}
                </button>
                <button onClick={() => handleFix("floor")} disabled={fixing}
                  className="flex-1 flex items-center justify-center gap-2 rounded-xl border border-primary/40 bg-primary/15 backdrop-blur-sm py-2.5 text-sm font-medium text-white active:scale-95 transition-transform disabled:opacity-50">
                  <Grid3x3 className="h-4 w-4" />{t("fixFloor")}
                </button>
              </div>
              {!isHd && (
                <button onClick={() => handleFix("hd")} disabled={fixing}
                  className="w-full flex items-center justify-center gap-2 rounded-xl border border-primary/40 bg-primary/15 backdrop-blur-sm py-2.5 text-sm font-medium text-white active:scale-95 transition-transform disabled:opacity-50">
                  <Wand2 className="h-4 w-4" />{t("makeHd")}
                </button>
              )}
              <button onClick={onReset} disabled={fixing}
                className="w-full flex items-center justify-center gap-2 rounded-xl border border-white/25 bg-white/5 backdrop-blur-sm py-2.5 text-sm font-medium text-white/75 active:scale-95 transition-transform disabled:opacity-50">
                <RotateCcw className="h-4 w-4" />{t("retry")}
              </button>
              {quotaMsg && <p className="text-xs text-red-300 text-center">{quotaMsg}</p>}
            </div>
          )}

          {/* Primary bar: Download · Again · Options */}
          <div className="flex gap-2.5 w-full max-w-sm">
            <button onClick={handleDownload} disabled={fixing}
              className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-black active:scale-95 transition-transform disabled:opacity-50">
              <Download className="h-4 w-4" />{t("download")}
            </button>
            {onRegenerate && (
              <button onClick={onRegenerate} disabled={fixing}
                className="flex-1 flex items-center justify-center gap-2 rounded-xl border-2 border-white/40 bg-white/10 backdrop-blur-sm py-3 text-sm font-medium text-white active:scale-95 transition-transform disabled:opacity-50">
                <RefreshCw className="h-4 w-4" />{t("again")}
              </button>
            )}
            <button onClick={() => setShowOptions((v) => !v)} disabled={fixing} aria-expanded={showOptions} aria-label={t("moreOptions")}
              className={`px-4 flex items-center justify-center rounded-xl border-2 backdrop-blur-sm py-3 active:scale-95 transition-transform disabled:opacity-50 ${showOptions ? "border-primary/60 bg-primary/20 text-white" : "border-white/40 bg-white/10 text-white"}`}>
              <SlidersHorizontal className="h-4 w-4" />
            </button>
          </div>
          {onRegenerate && freeRegenAvailable && !showOptions && (
            <p className="text-white/45 text-[11px]">{regenHint}</p>
          )}
        </div>
      </div>
    );
  }

  // ── Desktop: structured layout ──────────────────────────────────────────────
  return (
    <div className="flex flex-col">
      <header className="border-b border-border px-6 py-4 flex items-center justify-between">
        <Logo />
        <div className="flex items-center gap-1.5">
          {[1, 2, 3].map((n) => (
            <div key={n} className="h-1.5 w-3 rounded-full bg-primary/40" />
          ))}
        </div>
      </header>

      <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-8 flex flex-col gap-6">
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1">{t("resultLabel")}</p>
          <h1 className="text-3xl text-primary">{productName} {t("inYourRoom")}</h1>
        </div>

        <div className="relative flex justify-center">
          <img
            src={shown}
            alt={`${productName} placed in room`}
            className="mx-auto max-h-[72vh] w-auto max-w-full rounded-xl border border-border object-contain shadow-[var(--shadow-md)]"
          />
          {fixing && (
            <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/50">
              <div className="flex flex-col items-center gap-2 text-white">
                <Loader2 className="h-8 w-8 animate-spin" />
                <span className="text-sm">{busyLabel}</span>
              </div>
            </div>
          )}
        </div>

        {/* Primary actions */}
        <div className="flex gap-3">
          <Button onClick={handleDownload} size="lg" className="flex-1 gap-2" disabled={fixing}>
            <Download className="h-4 w-4" />
            {t("download")}
          </Button>
          <Button variant="outline" size="lg" onClick={handleShare} className="gap-2" disabled={fixing}>
            <Share2 className="h-4 w-4" />
            {t("share")}
          </Button>
          <Button variant="outline" size="lg" onClick={onReset} className="gap-2" disabled={fixing}>
            <RotateCcw className="h-4 w-4" />
            {t("tryAnother")}
          </Button>
        </div>

        {/* Fix — targeted corrections of the current result */}
        <div className="flex flex-col items-center gap-2">
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => handleFix("straighten")} className="gap-2" disabled={fixing}>
              <Sparkles className="h-4 w-4" />{t("straighten")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => handleFix("floor")} className="gap-2" disabled={fixing}>
              <Grid3x3 className="h-4 w-4" />{t("fixFloor")}
            </Button>
            {!isHd && (
              <Button variant="outline" size="sm" onClick={() => handleFix("hd")} className="gap-2" disabled={fixing}>
                <Wand2 className="h-4 w-4" />{t("makeHd")}
              </Button>
            )}
          </div>
          <p className={`text-xs ${quotaMsg ? "text-destructive" : "text-muted-foreground"}`}>{quotaMsg || (isHd ? t("hdReady") : t("fixHint"))}</p>
        </div>

        {/* Regenerate — separated with hint */}
        {onRegenerate && (
          <div className="flex flex-col items-center gap-2 pt-1 border-t border-border">
            <p className="text-xs text-muted-foreground">{regenHint}</p>
            <Button variant="outline" size="sm" onClick={onRegenerate} className="gap-2" disabled={fixing}>
              <RefreshCw className="h-3.5 w-3.5" />
              {t("regenerate")}
            </Button>
          </div>
        )}

        <p className="text-xs text-muted-foreground text-center">
          {t("poweredBy")} <span className="font-medium text-foreground">Furora</span> &amp; AI
        </p>
      </main>
    </div>
  );
}
