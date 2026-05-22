import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import type { IncomingMessage, ServerResponse } from "http";

// Dev-only middleware that mirrors the Vercel /api/scrape function
// so the feature works with `npm run dev` without needing `vercel dev`.
function scrapeMiddleware() {
  return {
    name: "scrape-api",
    configureServer(server: any) {
      server.middlewares.use(
        "/api/scrape",
        async (req: IncomingMessage, res: ServerResponse) => {
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Access-Control-Allow-Origin", "*");

          const params = new URL(req.url ?? "", "http://localhost").searchParams;
          const url    = params.get("url");
          const type   = params.get("type");

          if (!url) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: "Missing url" }));
            return;
          }

          try {
            const response = await fetch(url, {
              headers: {
                "User-Agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Accept":
                  type === "image"
                    ? "image/avif,image/webp,image/apng,image/*,*/*;q=0.8"
                    : "text/html,application/xhtml+xml,*/*;q=0.8",
                "Accept-Language": "pl-PL,pl;q=0.9,en-US;q=0.8",
                "Referer": new URL(url).origin + "/",
              },
            });

            if (!response.ok) {
              res.writeHead(400);
              res.end(JSON.stringify({ error: `Remote server returned ${response.status}` }));
              return;
            }

            if (type === "image") {
              const buffer   = await response.arrayBuffer();
              const base64   = Buffer.from(buffer).toString("base64");
              const mimeType = (response.headers.get("content-type") ?? "image/jpeg").split(";")[0];
              res.writeHead(200);
              res.end(JSON.stringify({ data: base64, mimeType }));
            } else {
              const html = await response.text();
              res.writeHead(200);
              res.end(JSON.stringify({ html: html.slice(0, 120_000) }));
            }
          } catch (err) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: String(err) }));
          }
        },
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), scrapeMiddleware()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  server: { port: 5173, host: true },
});
