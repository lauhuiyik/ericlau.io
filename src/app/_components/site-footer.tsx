import Link from "next/link";
import { CONTACT_EMAIL, CONTACT_MAILTO } from "@/lib/contact";

type Props = {
  backHref?: string;
  backLabel?: string;
};

/** Footer for inner pages: the way back on the left, the contact email on the right (like the home page footer). */
export function SiteFooter({ backHref = "/", backLabel = "← Back to index" }: Props) {
  return (
    <footer className="border-t border-rule px-6 sm:px-12 py-8 flex flex-col sm:flex-row gap-4 sm:gap-8 items-start sm:items-center justify-between font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
      <Link href={backHref} className="hover:text-foreground transition-colors">
        {backLabel}
      </Link>
      <a href={CONTACT_MAILTO} className="normal-case tracking-[0.12em] hover:text-foreground transition-colors">
        {CONTACT_EMAIL}
      </a>
    </footer>
  );
}
