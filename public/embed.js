(function () {
  "use strict";

  const script  = document.currentScript;
  if (!script) return;
  const shopId  = script.dataset.shop;
  const origin  = script.src.replace(/\/embed\.js.*$/, "");
  if (!shopId) { console.warn("[Roomora] Missing data-shop attribute on embed script."); return; }

  // Magic wand icon (Lucide wand-2)
  const WAND_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0;vertical-align:middle;margin-top:-1px"><path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72Z"/><path d="m14 7 3 3"/><path d="M5 6v4"/><path d="M19 14v4"/><path d="M10 2v2"/><path d="M7 8H3"/><path d="M21 16h-4"/><path d="M11 3H9"/></svg>';

  // ── Inject overlay + button styles ─────────────────────────────────────────
  const style = document.createElement("style");
  style.textContent = [
    ".roomora-overlay{position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,0.75);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:16px;opacity:0;transition:opacity 0.2s ease}",
    ".roomora-overlay.roomora-visible{opacity:1}",
    ".roomora-iframe{width:100%;max-width:480px;height:560px;max-height:92dvh;border:none;border-radius:16px;overflow:hidden;box-shadow:0 32px 80px rgba(0,0,0,0.6);background:#1c1c1c;transition:height 0.2s ease}",
    "@media(max-width:520px){.roomora-iframe{max-width:100%;height:100dvh;max-height:100dvh;border-radius:0}.roomora-overlay{padding:0}}",
    "[data-roomora-product]{display:inline-flex!important;align-items:center!important;gap:8px!important;justify-content:center!important;background:linear-gradient(135deg,#F59E0B 0%,#F97316 100%)!important;color:#1a1a1a!important;border:none!important;border-radius:8px!important;padding:11px 22px!important;font-size:14px!important;font-weight:600!important;cursor:pointer!important;box-shadow:0 2px 12px rgba(245,158,11,0.40)!important;transition:transform 0.15s ease,box-shadow 0.15s ease!important;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif!important;letter-spacing:0.2px!important;text-decoration:none!important;line-height:1!important;white-space:nowrap!important;vertical-align:middle!important;outline:none!important}",
    "[data-roomora-product]:hover{background:linear-gradient(135deg,#FBBF24 0%,#FB923C 100%)!important;box-shadow:0 4px 20px rgba(245,158,11,0.55)!important;transform:translateY(-1px)!important}",
    "[data-roomora-product]:active{transform:translateY(0)!important;box-shadow:0 2px 8px rgba(245,158,11,0.30)!important}",
    "[data-roomora-product]:focus-visible{box-shadow:0 0 0 3px rgba(245,158,11,0.50)!important}",
    ".roomora-powered{display:flex;align-items:center;justify-content:center;gap:4px;margin-top:5px;font-size:10px;color:#888;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;text-decoration:none;user-select:none;transition:opacity 0.15s ease}",
    ".roomora-powered:hover{opacity:0.7}"
  ].join("\n");
  document.head.appendChild(style);

  // ── Open overlay ───────────────────────────────────────────────────────────
  function openProduct(productId) {
    const overlay = document.createElement("div");
    overlay.className = "roomora-overlay";

    const iframe = document.createElement("iframe");
    iframe.className = "roomora-iframe";
    iframe.src = origin + "/try/" + shopId + "/" + encodeURIComponent(productId);
    iframe.allow = "camera; microphone";
    iframe.title = "See in your room — powered by Roomora";

    overlay.appendChild(iframe);
    document.body.appendChild(overlay);

    requestAnimationFrame(function () {
      requestAnimationFrame(function () { overlay.classList.add("roomora-visible"); });
    });

    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) closeOverlay(overlay);
    });

    function onKey(e) {
      if (e.key === "Escape") { closeOverlay(overlay); document.removeEventListener("keydown", onKey); }
    }
    document.addEventListener("keydown", onKey);

    function onMessage(e) {
      if (e.data === "roomora:close") { closeOverlay(overlay); window.removeEventListener("message", onMessage); return; }
      if (e.data && typeof e.data === "object" && e.data.type === "roomora:resize") {
        var maxH = Math.round(window.innerHeight * 0.92);
        iframe.style.height = Math.min(e.data.height, maxH) + "px";
      }
    }
    window.addEventListener("message", onMessage);
  }

  function closeOverlay(overlay) {
    overlay.classList.remove("roomora-visible");
    setTimeout(function () { overlay.remove(); }, 200);
  }

  // ── Wire up all tagged elements ─────────────────────────────────────────────
  function wireElements() {
    document.querySelectorAll("[data-roomora-product]").forEach(function (el) {
      if (el.dataset.roomoraWired) return;
      el.dataset.roomoraWired = "1";

      // Clean button: wand icon + action text only
      el.innerHTML = WAND_SVG + '<span style="color:#1a1a1a;font-weight:600">See in your room</span>';

      el.addEventListener("click", function (e) {
        e.preventDefault();
        openProduct(el.dataset.roomoraProduct);
      });

      // "Powered by roomora" caption — links to Roomora landing page
      if (!el.nextElementSibling || !el.nextElementSibling.classList.contains("roomora-powered")) {
        var a = document.createElement("a");
        a.className = "roomora-powered";
        a.href = origin;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.appendChild(document.createTextNode("Powered by "));
        var img = document.createElement("img");
        img.src = origin + "/logo.svg";
        img.height = 13;
        img.alt = "roomora";
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
