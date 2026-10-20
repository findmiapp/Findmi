import { EmptyState } from "@/components/jc/Layout";
import { jcHref } from "@/lib/jc/config";

export default function JcNotFound() {
  return <EmptyState title="Not in Jersey City" body="That page doesn't exist here, or it's no longer happening." cta={{ label: "Back to Home", href: jcHref() }} />;
}
