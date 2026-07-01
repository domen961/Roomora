import { Link } from "react-router-dom";
import Logo from "@/components/Logo";

/* ──────────────────────────────────────────────────────────────────────────
 * TEMPLATE — fill in the bracketed details below, then have a lawyer review
 * before public launch. This is a solid starting point tailored to how Furora
 * actually processes data, not legal advice.
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

export default function PrivacyPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-border px-6 py-4 flex items-center justify-between">
        <Link to="/"><Logo className="h-6" /></Link>
        <Link to="/" className="text-xs text-muted-foreground hover:text-foreground">← Back to home</Link>
      </header>

      <main className="mx-auto w-full max-w-3xl px-6 py-12 flex flex-col gap-8">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-serif text-primary">Privacy Policy</h1>
          <p className="text-xs text-muted-foreground">Last updated: {UPDATED}</p>
        </div>

        <Section title="1. Who we are">
          <p>
            Furora ("we", "us") is a service operated by {COMPANY}, {ADDRESS}. Furora lets online furniture
            retailers ("merchants") add an AI "see it in your room" button to their product pages, so their
            customers can preview furniture in a photo of their own room. For any privacy question, contact us
            at <a href={`mailto:${EMAIL}`} className="text-primary hover:underline">{EMAIL}</a>.
          </p>
        </Section>

        <Section title="2. Data we process">
          <p>Depending on how you use Furora, we process:</p>
          <ul className="list-disc pl-5 flex flex-col gap-1">
            <li><strong className="text-foreground">Merchant account data</strong> — email address, shop name, authentication identifiers, and (for Google sign-in) the basic profile Google shares.</li>
            <li><strong className="text-foreground">Merchant catalog data</strong> — product names, descriptions, dimensions, and product images you upload or import.</li>
            <li><strong className="text-foreground">Customer room photos</strong> — when a shopper uses the "see in your room" feature, the photo they capture or upload is processed to generate the preview (see §4).</li>
            <li><strong className="text-foreground">Usage data</strong> — generation ("Gen Point") counts and timestamps, used for quotas and billing.</li>
            <li><strong className="text-foreground">Essential cookies / tokens</strong> — used only to keep merchants signed in. We do not use advertising or tracking cookies.</li>
          </ul>
        </Section>

        <Section title="3. How and why we use it">
          <p>We use the data to: provide and operate the service; generate room previews; enforce usage quotas and (where applicable) bill merchants; secure the service and prevent abuse; and respond to support requests. Our legal bases are performance of a contract, our legitimate interests in operating and securing the service, and your consent where required.</p>
        </Section>

        <Section title="4. Room photos and AI processing">
          <p>
            Customer room photos are used solely to generate the requested preview. To do this, the photo is sent
            to our AI processors — <strong className="text-foreground">Google (Gemini)</strong> for image generation and
            <strong className="text-foreground"> Anthropic (Claude)</strong> for measurement/quality checks — and returned as an edited image.
          </p>
          <p>
            Room photos captured through the phone hand-off flow are stored only transiently and are
            <strong className="text-foreground"> automatically deleted within about 15 minutes</strong>. We do not use room photos to train
            our own models, and we do not sell them. Merchants and shoppers should not include people, faces, or
            other sensitive content in room photos.
          </p>
        </Section>

        <Section title="5. Sub-processors">
          <p>We rely on the following providers to run the service:</p>
          <ul className="list-disc pl-5 flex flex-col gap-1">
            <li><strong className="text-foreground">Supabase</strong> — authentication, database, and file storage.</li>
            <li><strong className="text-foreground">Google</strong> — Gemini AI (image/text generation) and Google Sign-In.</li>
            <li><strong className="text-foreground">Anthropic</strong> — Claude AI (room measurement and result verification).</li>
            <li><strong className="text-foreground">Vercel</strong> — application hosting and serverless functions.</li>
          </ul>
          <p>Some of these providers may process data outside {COUNTRY} / the EEA. Where that happens, transfers are covered by appropriate safeguards such as Standard Contractual Clauses.</p>
        </Section>

        <Section title="6. Retention">
          <p>We keep merchant account and catalog data for as long as the account is active. Customer room photos in the hand-off flow are deleted automatically (see §4). When a merchant deletes their account, we delete their account, catalog, and associated files.</p>
        </Section>

        <Section title="7. Your rights">
          <p>Subject to applicable law (including the GDPR), you may request access to, correction of, or deletion of your personal data, object to or restrict certain processing, and request data portability. Merchants can delete their account and all associated data at any time from <span className="text-foreground">Account → Danger zone</span> in the dashboard. To exercise any right, contact <a href={`mailto:${EMAIL}`} className="text-primary hover:underline">{EMAIL}</a>. You also have the right to lodge a complaint with your local data protection authority.</p>
        </Section>

        <Section title="8. Security">
          <p>We use encryption in transit, access controls, and reputable infrastructure providers to protect data. No system is perfectly secure, but we work to protect your information and to notify you of significant incidents where required.</p>
        </Section>

        <Section title="9. Children">
          <p>Furora is intended for businesses and is not directed to children. We do not knowingly collect personal data from children.</p>
        </Section>

        <Section title="10. Changes">
          <p>We may update this policy from time to time. Material changes will be reflected by the "last updated" date above and, where appropriate, communicated to merchants.</p>
        </Section>

        <Section title="11. Contact">
          <p>Questions about this policy or your data: <a href={`mailto:${EMAIL}`} className="text-primary hover:underline">{EMAIL}</a>, {COMPANY}, {ADDRESS}.</p>
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
