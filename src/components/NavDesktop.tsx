import Link from "next/link";
import CartBadge from "./CartBadge";
import Logo from "./Logo";
import type { ResolvedNavItem } from "@/lib/navigation";

// Desktop nav's link list now reads from the same founder-managed source
// as the mobile hamburger menu (Part A11: "desktop and mobile should use
// the SAME managed navigation source") — Logo, the dedicated Search link,
// and CartBadge stay exactly where they were; only the link list + CTA
// button are now data-driven instead of a hardcoded array. Grouping is a
// mobile-drawer-only concept (this renders every visible item flat,
// highlighted or not) since desktop nav has never had subheadings.
export default function NavDesktop({ navItems }: { navItems: ResolvedNavItem[] }) {
  const plain = navItems.filter((item) => !item.highlight);
  const highlighted = navItems.filter((item) => item.highlight);

  return (
    <header className="sticky top-0 z-40 hidden border-b border-black/5 bg-paper/90 backdrop-blur md:block">
      <div className="mx-auto flex max-w-6xl items-center gap-8 px-6 py-4">
        <Logo heightClassName="h-10" />
        <nav className="flex flex-1 items-center gap-6">
          {plain.map((item) => (
            <NavLink key={item.id} item={item} className="text-sm font-medium text-ink/70 transition hover:text-ink" />
          ))}
        </nav>
        <Link href="/businesses" className="text-sm font-medium text-ink/70 transition hover:text-ink">
          Search
        </Link>
        <CartBadge variant="text" />
        {highlighted.map((item) => (
          <NavLink
            key={item.id}
            item={item}
            className="rounded-full bg-findmi px-5 py-2.5 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
          />
        ))}
      </div>
    </header>
  );
}

function NavLink({ item, className }: { item: ResolvedNavItem; className: string }) {
  if (item.external) {
    return (
      <a href={item.href} target="_blank" rel="noopener noreferrer" className={className}>
        {item.label}
      </a>
    );
  }
  return (
    <Link href={item.href} className={className}>
      {item.label}
    </Link>
  );
}
