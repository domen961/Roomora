import { Link } from "react-router-dom";
import Logo from "@/components/Logo";

/* ──────────────────────────────────────────────────────────────────────────
 * TEMPLATE — fill in the bracketed details below, then have a lawyer review
 * before public launch. Tailored to how Furora works; not legal advice.
 * ────────────────────────────────────────────────────────────────────────── */
const COMPANY  = "[COMPANY LEGAL NAME]";
const ADDRESS  = "[BUSINESS ADDRESS]";
const EMAIL    = "[CONTACT EMAIL]";
const COUNTRY  = "[COUNTRY]";           // e.g. "Poland"
const UPDATED  = "1 July 2026";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-medium text-foreground">{title}</h2>
      <div className="flex flex-col gap-2 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

export default function TermsPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-border px-6 py-4 flex items-center justify-between">
        <Link to="/"><Logo className="h-6" /></Link>
        <Link to="/" className="text-xs text-muted-foreground hover:text-foreground">← Back to home</Link>
      </header>

      <main className="mx-auto w-full max-w-3xl px-6 py-12 flex flex-col gap-8">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-serif text-primary">Terms of Service</h1>
          <p className="text-xs text-muted-foreground">Last updated: {UPDATED}</p>
        </div>

        <Section title="1. Agreement">
          <p>These Terms govern your use of Furora, operated by {COMPANY}, {ADDRESS} ("we", "us"). By creating an account or using the service, you agree to these Terms. If you use Furora on behalf of a business, you confirm you are authorised to bind that business.</p>
        </Section>

        <Section title="2. The service">
          <p>Furora provides merchants with an embeddable "see it in your room" tool that uses AI to place a merchant's furniture into a customer-supplied room photo, plus a dashboard to manage products and usage. Features may change or be discontinued as the product evolves.</p>
        </Section>

        <Section title="3. Accounts">
          <p>Furora is intended for business use. You are responsible for your account credentials and for all activity under your account. Provide accurate information and keep it current.</p>
        </Section>

        <Section title="4. Merchant responsibilities">
          <ul className="list-disc pl-5 flex flex-col gap-1">
            <li>You must own or have the rights to the product names, descriptions, and images you upload or import.</li>
            <li>You are responsible for the accuracy of product data, including dimensions, which affect how previews are generated.</li>
            <li>You must present the tool to your customers lawfully, including any notice or consent required for processing the room photos they provide.</li>
            <li>You must comply with all applicable laws and with the terms of any site where you embed the tool.</li>
          </ul>
        </Section>

        <Section title="5. Acceptable use">
          <p>You may not misuse the service, including: uploading unlawful, infringing, or harmful content; attempting to reverse engineer, overload, or circumvent quotas or security; or using the service to process images of people for identification or any unlawful purpose.</p>
        </Section>

        <Section title="6. Gen Points and usage">
          <p>Generation usage is metered in "Gen Points". One Gen Point corresponds to one room-preview generation. As a courtesy, the first regeneration of a given photo does not consume a point. Gen Points have no cash value, are tied to your plan period, and are non-transferable and non-refundable except where required by law.</p>
        </Section>

        <Section title="7. Plans and fees">
          <p>Subscription plans, included Gen Points, and prices are shown in the app and may change with notice. During any free or beta period the service is provided without charge. Where paid plans apply, fees are billed in advance for the plan period and are exclusive of applicable taxes unless stated otherwise.</p>
        </Section>

        <Section title="8. Intellectual property">
          <p>You keep all rights to your own content (products, images, and generated previews of your products). We keep all rights to the Furora platform, software, and branding. You grant us the limited licence needed to host and process your content in order to provide the service.</p>
        </Section>

        <Section title="9. AI-generated previews — important">
          <p>
            Previews are produced by AI and are <strong className="text-foreground">approximate visualisations, not exact
            representations</strong>. Colour, texture, scale, proportions, lighting, and placement may differ from the real
            product and the real room. Previews are provided to help imagination only and must not be relied on as an
            accurate depiction for a purchase decision. We do not warrant that any preview is accurate, and neither we
            nor the merchant are liable for differences between a preview and the actual product or room.
          </p>
        </Section>

        <Section title="10. Availability and disclaimer">
          <p>The service is provided "as is" and "as available", without warranties of any kind to the maximum extent permitted by law. We do not guarantee uninterrupted or error-free operation, and generation depends on third-party AI providers whose availability we do not control.</p>
        </Section>

        <Section title="11. Limitation of liability">
          <p>To the maximum extent permitted by law, we are not liable for indirect, incidental, or consequential damages, or for lost profits or data. Our total liability arising from the service is limited to the amount you paid us in the twelve months before the event giving rise to the claim. Nothing limits liability that cannot be limited by law.</p>
        </Section>

        <Section title="12. Termination">
          <p>You may stop using Furora and delete your account at any time. We may suspend or terminate access for breach of these Terms or to protect the service. On termination, your account and associated data are deleted as described in the Privacy Policy.</p>
        </Section>

        <Section title="13. Governing law">
          <p>These Terms are governed by the laws of {COUNTRY}, and disputes are subject to the competent courts there, unless mandatory consumer-protection law provides otherwise.</p>
        </Section>

        <Section title="14. Changes">
          <p>We may update these Terms from time to time. Material changes will be reflected by the "last updated" date and, where appropriate, communicated to merchants. Continued use after changes take effect constitutes acceptance.</p>
        </Section>

        <Section title="15. Contact">
          <p>Questions about these Terms: <a href={`mailto:${EMAIL}`} className="text-primary hover:underline">{EMAIL}</a>, {COMPANY}, {ADDRESS}.</p>
        </Section>
      </main>

      <footer className="border-t border-border px-6 py-6 flex items-center justify-between mt-auto">
        <Logo className="h-5 opacity-60" />
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <Link to="/privacy" className="hover:text-foreground">Privacy</Link>
          <Link to="/terms" className="hover:text-foreground">Terms</Link>
          <span>© 2026 Furora</span>
        </div>
      </footer>
    </div>
  );
}
