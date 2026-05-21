(function () {
  "use strict";

  const script  = document.currentScript;
  if (!script) return;
  const shopId  = script.dataset.shop;
  const origin  = script.src.replace(/\/embed\.js.*$/, "");
  if (!shopId) { console.warn("[Roomora] Missing data-shop attribute on embed script."); return; }

  // ── Inject overlay styles ──────────────────────────────────────────────────
  const style = document.createElement("style");
  style.textContent = `
    .roomora-overlay {
      position: fixed; inset: 0; z-index: 2147483647;
      background: rgba(0,0,0,0.75); backdrop-filter: blur(4px);
      display: flex; align-items: center; justify-content: center;
      padding: 16px;
      opacity: 0; transition: opacity 0.2s ease;
    }
    .roomora-overlay.roomora-visible { opacity: 1; }
    .roomora-iframe {
      width: 100%; max-width: 480px; height: 90dvh;
      border: none; border-radius: 16px; overflow: hidden;
      box-shadow: 0 32px 80px rgba(0,0,0,0.6);
      background: #1c1c1c;
    }
    @media (max-width: 520px) {
      .roomora-iframe { max-width: 100%; height: 100dvh; border-radius: 0; }
      .roomora-overlay { padding: 0; }
    }
  `;
  document.head.appendChild(style);

  // ── Open overlay ───────────────────────────────────────────────────────────
  function openProduct(productId) {
    const overlay = document.createElement("div");
    overlay.className = "roomora-overlay";

    const iframe = document.createElement("iframe");
    iframe.className = "roomora-iframe";
    iframe.src = `${origin}/try/${shopId}/${encodeURIComponent(productId)}`;
    iframe.allow = "camera; microphone";
    iframe.title = "See in your room — powered by Roomora";

    overlay.appendChild(iframe);
    document.body.appendChild(overlay);

    // Animate in
    requestAnimationFrame(() => {
      requestAnimationFrame(() => overlay.classList.add("roomora-visible"));
    });

    // Close on backdrop click
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) closeOverlay(overlay);
    });

    // Close on Escape
    function onKey(e) {
      if (e.key === "Escape") { closeOverlay(overlay); document.removeEventListener("keydown", onKey); }
    }
    document.addEventListener("keydown", onKey);

    // Close on postMessage from iframe
    function onMessage(e) {
      if (e.data === "roomora:close") { closeOverlay(overlay); window.removeEventListener("message", onMessage); }
    }
    window.addEventListener("message", onMessage);
  }

  function closeOverlay(overlay) {
    overlay.classList.remove("roomora-visible");
    setTimeout(() => overlay.remove(), 200);
  }

  // ── Wire up all tagged elements ────────────────────────────────────────────
  function wireElements() {
    document.querySelectorAll("[data-roomora-product]").forEach(function (el) {
      if (el.dataset.roomoraWired) return;
      el.dataset.roomoraWired = "1";
      el.addEventListener("click", function (e) {
        e.preventDefault();
        openProduct(el.dataset.roomoraProduct);
      });
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
