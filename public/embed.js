(function () {
  "use strict";

  const script  = document.currentScript;
  if (!script) return;
  const shopId  = script.dataset.shop;
  const origin  = script.src.replace(/\/embed\.js.*$/, "");
  if (!shopId) { console.warn("[Furora] Missing data-shop attribute on embed script."); return; }

  // Shopper language — Polish browsers get Polish, everyone else English (matches the app).
  // Optional override: <script ... data-lang="pl"> or "en".
  var LANG = (script.dataset.lang || navigator.language || "").toLowerCase().indexOf("pl") === 0 ? "pl" : "en";
  var TXT = {
    en: { button: "Place this furniture in your room", poweredBy: "Powered by " },
    pl: { button: "Zobacz ten mebel w swoim pokoju",    poweredBy: "Obsługiwane przez " }
  }[LANG];

  // Magic wand icon (Lucide wand-2)
  const WAND_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0;vertical-align:middle;margin-top:-1px"><path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72Z"/><path d="m14 7 3 3"/><path d="M5 6v4"/><path d="M19 14v4"/><path d="M10 2v2"/><path d="M7 8H3"/><path d="M21 16h-4"/><path d="M11 3H9"/></svg>';

  // ── Inject overlay + button styles ─────────────────────────────────────────
  const style = document.createElement("style");
  style.textContent = [
    ".furora-overlay{position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,0.75);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:16px;opacity:0;transition:opacity 0.2s ease}",
    ".furora-overlay.furora-visible{opacity:1}",
    ".furora-iframe{width:100%;max-width:480px;height:560px;max-height:92dvh;border:none;border-radius:16px;overflow:hidden;box-shadow:0 32px 80px rgba(0,0,0,0.6);background:#1c1c1c;transition:height 0.2s ease}",
    "@media(max-width:520px){.furora-overlay{padding:0;align-items:stretch;justify-content:stretch}.furora-iframe{max-width:100%;width:100%;height:100%;max-height:none;border-radius:0;transition:none}}",
    "[data-furora-product]{display:inline-flex!important;align-items:center!important;gap:8px!important;justify-content:center!important;background:linear-gradient(135deg,#F59E0B 0%,#F97316 100%)!important;color:#1a1a1a!important;border:none!important;border-radius:8px!important;padding:11px 22px!important;font-size:14px!important;font-weight:600!important;cursor:pointer!important;box-shadow:0 2px 12px rgba(245,158,11,0.40)!important;transition:transform 0.15s ease,box-shadow 0.15s ease!important;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif!important;letter-spacing:0.2px!important;text-decoration:none!important;line-height:1!important;white-space:nowrap!important;vertical-align:middle!important;outline:none!important}",
    "[data-furora-product]:hover{background:linear-gradient(135deg,#FBBF24 0%,#FB923C 100%)!important;box-shadow:0 4px 20px rgba(245,158,11,0.55)!important;transform:translateY(-1px)!important}",
    "[data-furora-product]:active{transform:translateY(0)!important;box-shadow:0 2px 8px rgba(245,158,11,0.30)!important}",
    "[data-furora-product]:focus-visible{box-shadow:0 0 0 3px rgba(245,158,11,0.50)!important}",
    ".furora-powered{display:flex;align-items:center;justify-content:center;gap:4px;margin-top:5px;font-size:10px;color:#888;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;text-decoration:none;user-select:none;transition:opacity 0.15s ease}",
    ".furora-powered:hover{opacity:0.7}"
  ].join("\n");
  document.head.appendChild(style);

  var isMobileDevice =
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  // ── Open overlay ───────────────────────────────────────────────────────────
  function openProduct(productId) {
    var url = origin + "/try/" + shopId + "/" + encodeURIComponent(productId);

    // On mobile: navigate directly — no iframe, no browser-chrome gaps, truly full-screen
    if (isMobileDevice) {
      window.location.href = url;
      return;
    }

    // Desktop: overlay + iframe
    const overlay = document.createElement("div");
    overlay.className = "furora-overlay";

    const iframe = document.createElement("iframe");
    iframe.className = "furora-iframe";
    iframe.src = url;
    iframe.allow = "camera; microphone";
    iframe.title = "See in your room — powered by Furora";

    overlay.appendChild(iframe);
    document.body.appendChild(overlay);

    requestAnimationFrame(function () {
      requestAnimationFrame(function () { overlay.classList.add("furora-visible"); });
    });

    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) closeOverlay(overlay);
    });

    function onKey(e) {
      if (e.key === "Escape") { closeOverlay(overlay); document.removeEventListener("keydown", onKey); }
    }
    document.addEventListener("keydown", onKey);

    function onMessage(e) {
      if (e.data === "furora:close") { closeOverlay(overlay); window.removeEventListener("message", onMessage); return; }
      if (e.data && typeof e.data === "object" && e.data.type === "furora:resize") {
        var maxH = Math.round(window.innerHeight * 0.92);
        iframe.style.height = Math.min(e.data.height, maxH) + "px";
      }
    }
    window.addEventListener("message", onMessage);
  }

  function closeOverlay(overlay) {
    overlay.classList.remove("furora-visible");
    setTimeout(function () { overlay.remove(); }, 200);
  }

  // ── Wire up all tagged elements ─────────────────────────────────────────────
  function wireElements() {
    document.querySelectorAll("[data-furora-product]").forEach(function (el) {
      if (el.dataset.furoraWired) return;
      el.dataset.furoraWired = "1";

      // Clean button: wand icon + action text only
      el.innerHTML = WAND_SVG + '<span style="color:#1a1a1a;font-weight:600">' + TXT.button + '</span>';

      el.addEventListener("click", function (e) {
        e.preventDefault();
        openProduct(el.dataset.furoraProduct);
      });

      // "Powered by furora" caption — links to Furora landing page
      if (!el.nextElementSibling || !el.nextElementSibling.classList.contains("furora-powered")) {
        var a = document.createElement("a");
        a.className = "furora-powered";
        a.href = origin;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.appendChild(document.createTextNode(TXT.poweredBy));
        var img = document.createElement("img");
        img.src = origin + "/logo.svg";
        img.height = 13;
        img.alt = "furora";
        img.style.cssText = "display:inline-block;vertical-align:middle;margin-top:-1px;pointer-events:none";
        a.appendChild(img);
        el.insertAdjacentElement("afterend", a);
      }
    });
  }

  // Wire on DOM ready + observe future elements (e.g. SPAs)
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wireElements);
  } else {
    wireElements();
  }

  const observer = new MutationObserver(wireElements);
  observer.observe(document.body, { childList: true, subtree: true });
})();
