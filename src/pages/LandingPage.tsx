import { Link } from "react-router-dom";
import { ArrowRight, Upload, Code, Sparkles } from "lucide-react";
import Logo from "@/components/Logo";

export default function LandingPage() {
  return (
    <div className="min-h-screen flex flex-col">

      {/* Nav */}
      <header className="px-6 py-4 flex items-center justify-between border-b border-border/40">
        <Logo className="h-7" />
        <Link
          to="/login"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Sign in →
        </Link>
      </header>

      {/* Hero */}
      <section className="flex-1 flex flex-col items-center justify-center text-center px-6 py-24 gap-8">
        <div className="flex flex-col items-center gap-5 max-w-2xl">
          <span className="text-xs uppercase tracking-widest text-primary border border-primary/30 rounded-full px-4 py-1">
            AI-powered furniture visualisation
          </span>
          <h1 className="text-5xl sm:text-6xl font-light tracking-wide leading-tight">
            Let customers see your furniture<br />
            <span className="text-primary">in their own room.</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-xl leading-relaxed">
            One script tag on your product page. Customers snap a photo of their room — Roomora places your furniture in it instantly, powered by AI.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 items-center">
          <Link
            to="/login"
            className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-6 py-3 rounded-md text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            Get started free <ArrowRight className="h-4 w-4" />
          </Link>
          <a
            href="#how-it-works"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors px-4 py-3"
          >
            See how it works ↓
          </a>
        </div>

        {/* Mock preview */}
        <div className="mt-4 w-full max-w-2xl rounded-xl border border-border bg-card overflow-hidden shadow-lg">
          <div className="border-b border-border px-4 py-2.5 flex items-center gap-2">
            <div className="h-2.5 w-2.5 rounded-full bg-border" />
            <div className="h-2.5 w-2.5 rounded-full bg-border" />
            <div className="h-2.5 w-2.5 rounded-full bg-border" />
            <span className="ml-2 text-xs text-muted-foreground">yourshop.com/products/sofa</span>
          </div>
          <div className="p-8 flex flex-col sm:flex-row gap-8 items-center">
            <div className="w-36 h-36 rounded-lg bg-secondary flex items-center justify-center flex-shrink-0">
              <span className="text-xs text-muted-foreground text-center px-2">Product photo</span>
            </div>
            <div className="flex flex-col gap-3 flex-1 items-start">
              <div className="h-4 w-40 rounded bg-secondary" />
              <div className="h-3 w-56 rounded bg-secondary/70" />
              <div className="h-3 w-48 rounded bg-secondary/50" />
              <div className="mt-2 h-3 w-24 rounded bg-secondary/40" />
              <button className="mt-3 inline-flex items-center gap-2 bg-primary text-primary-foreground text-xs px-4 py-2 rounded-md font-medium">
                <Sparkles className="h-3.5 w-3.5" />
                See in your room
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="border-t border-border px-6 py-24">
        <div className="max-w-4xl mx-auto flex flex-col gap-16">
          <div className="text-center flex flex-col gap-3">
            <h2 className="text-3xl font-light tracking-wide">Three steps. That's it.</h2>
            <p className="text-muted-foreground">No app to install. No developer needed beyond a paste.</p>
          </div>

          <div className="grid sm:grid-cols-3 gap-8">
            {[
              {
                icon: <Upload className="h-6 w-6 text-primary" />,
                step: "01",
                title: "Upload your 3D model",
                body: "Drop a GLB, GLTF, or OBJ file into your Roomora dashboard. We automatically generate product snapshots from multiple angles.",
              },
              {
                icon: <Code className="h-6 w-6 text-primary" />,
                step: "02",
                title: "Paste one script tag",
                body: "Copy your embed snippet and paste it into your shop's HTML. Add a single attribute to any button or element on your product pages.",
              },
              {
                icon: <Sparkles className="h-6 w-6 text-primary" />,
                step: "03",
                title: "Customers see it live",
                body: "Shoppers click the button, photograph their room, and see your exact product placed there by AI — before they buy.",
              },
            ].map(({ icon, step, title, body }) => (
              <div key={step} className="flex flex-col gap-4">
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground/50 font-mono tabular-nums">{step}</span>
                  <div className="h-px flex-1 bg-border" />
                  {icon}
                </div>
                <h3 className="text-base font-medium">{title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Embed preview */}
      <section className="border-t border-border px-6 py-24 bg-card/40">
        <div className="max-w-2xl mx-auto flex flex-col gap-8 items-center text-center">
          <h2 className="text-3xl font-light tracking-wide">The whole integration.</h2>
          <p className="text-muted-foreground">Two snippets. Your customers get a premium AR-like experience.</p>
          <div className="w-full text-left flex flex-col gap-4">
            <div className="rounded-lg border border-border bg-background overflow-hidden">
              <div className="px-4 py-2 border-b border-border flex items-center justify-between">
                <span className="text-xs text-muted-foreground font-mono">Paste once in &lt;head&gt;</span>
              </div>
              <pre className="px-4 py-4 text-xs text-muted-foreground font-mono overflow-x-auto leading-relaxed">
                <span className="text-primary/70">&lt;script</span>
                {` src="https://roomora.com/embed.js"\n`}
                {'        '}
                <span className="text-primary/70">data-shop</span>
                {`="YOUR_SHOP_ID"&gt;&lt;/script&gt;`}
              </pre>
            </div>
            <div className="rounded-lg border border-border bg-background overflow-hidden">
              <div className="px-4 py-2 border-b border-border">
                <span className="text-xs text-muted-foreground font-mono">Add to any button on your product page</span>
              </div>
              <pre className="px-4 py-4 text-xs text-muted-foreground font-mono overflow-x-auto leading-relaxed">
                <span className="text-primary/70">&lt;button</span>
                {` `}
                <span className="text-primary/70">data-roomora-product</span>
                {`="PRODUCT_ID"&gt;\n  See in your room\n`}
                <span className="text-primary/70">&lt;/button&gt;</span>
              </pre>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="border-t border-border px-6 py-24 bg-card/40">
        <div className="max-w-5xl mx-auto flex flex-col gap-12">
          <div className="text-center flex flex-col gap-3">
            <h2 className="text-3xl font-light tracking-wide">Simple, transparent pricing</h2>
            <p className="text-muted-foreground">One Gen Point = one customer AR placement. No hidden fees.</p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5 items-stretch">
            {[
              {
                name:     "Free",
                price:    "€0",
                points:   "25 AR try-ons",
                popular:  false,
                features: ["25 Gen Points included", "Variant creator", "Embed on any website", "Community support"],
                cta:      { label: "Get started free", href: "/login", disabled: false },
              },
              {
                name:     "Starter",
                price:    "€120",
                points:   "500 AR try-ons / mo",
                popular:  false,
                features: ["500 Gen Points / month", "Variant creator", "Embed on any website", "Email support"],
                cta:      { label: "Coming soon", href: null, disabled: true },
              },
              {
                name:     "Pro",
                price:    "€240",
                points:   "1,000 AR try-ons / mo",
                popular:  true,
                features: ["1,000 Gen Points / month", "Variant creator", "Embed on any website", "Priority support"],
                cta:      { label: "Coming soon", href: null, disabled: true },
              },
              {
                name:     "Unlimited",
                price:    "€480",
                points:   "Unlimited AR try-ons",
                popular:  false,
                features: ["Unlimited Gen Points", "Variant creator", "Embed on any website", "Dedicated support"],
                cta:      { label: "Coming soon", href: null, disabled: true },
              },
            ].map((plan) => (
              <div
                key={plan.name}
                className={`relative rounded-xl border bg-card flex flex-col gap-5 p-6 ${
                  plan.popular ? "border-primary/60 shadow-lg shadow-primary/10" : "border-border"
                }`}
              >
                {plan.popular && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-[10px] font-semibold uppercase tracking-widest bg-primary text-primary-foreground rounded-full px-3 py-0.5">
                    Most popular
                  </span>
                )}

                <div className="flex flex-col gap-1">
                  <p className="text-xs text-muted-foreground uppercase tracking-widest">{plan.name}</p>
                  <p className="text-3xl font-light text-foreground">{plan.price}<span className="text-base text-muted-foreground">{plan.price !== "€0" ? " /mo" : ""}</span></p>
                  <p className="text-xs text-primary">{plan.points}</p>
                </div>

                <ul className="flex flex-col gap-2 flex-1">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-xs text-muted-foreground">
                      <span className="text-primary mt-0.5 flex-shrink-0">✓</span>
                      {f}
                    </li>
                  ))}
                </ul>

                {plan.cta.disabled ? (
                  <button disabled className="w-full rounded-md border border-border py-2.5 text-xs text-muted-foreground cursor-not-allowed opacity-50">
                    {plan.cta.label}
                  </button>
                ) : (
                  <Link
                    to={plan.cta.href!}
                    className="w-full rounded-md bg-primary text-primary-foreground py-2.5 text-xs font-medium text-center hover:bg-primary/90 transition-colors"
                  >
                    {plan.cta.label}
                  </Link>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-border px-6 py-24">
        <div className="max-w-xl mx-auto flex flex-col items-center gap-6 text-center">
          <h2 className="text-4xl font-light tracking-wide">Ready to boost conversions?</h2>
          <p className="text-muted-foreground">
            Set up your first product in under 10 minutes. No credit card required.
          </p>
          <Link
            to="/login"
            className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-8 py-3.5 rounded-md text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            Create free account <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border px-6 py-6 flex items-center justify-between">
        <Logo className="h-5 opacity-60" />
        <span className="text-xs text-muted-foreground">© 2026 Roomora</span>
      </footer>

    </div>
  );
}
