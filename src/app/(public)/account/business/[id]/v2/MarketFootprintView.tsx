import Link from "next/link";

/** Segmented switch between the place list, the Market view and the private Targets
 * pipeline. Plain links, so Back / Forward and shared URLs keep the same view. */
export function FindUsViewSwitch({ basePath, active }: { basePath: string; active: "places" | "markets" | "targets" }) {
  const item = (key: "places" | "markets" | "targets", label: string, href: string) => (
    <Link
      key={key}
      href={href}
      aria-current={active === key ? "page" : undefined}
      className={`flex h-9 flex-1 items-center justify-center rounded-full px-4 text-metadata font-semibold transition ${active === key ? "bg-white text-primary shadow-sm" : "text-muted hover:text-primary"}`}
    >
      {label}
    </Link>
  );
  return (
    <nav aria-label="Find Us Here views" className="flex w-full max-w-sm gap-1 rounded-full bg-black/[0.05] p-1">
      {item("places", "Places", `${basePath}?tab=findmi-here&view=find-us`)}
      {item("markets", "By Market", `${basePath}?tab=findmi-here&view=find-us&fv=markets`)}
      {item("targets", "Targets", `${basePath}?tab=findmi-here&view=find-us&fv=targets`)}
    </nav>
  );
}
