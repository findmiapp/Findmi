import Link from "next/link";
import CartBadge from "./CartBadge";
import HeaderSearch from "./HeaderSearch";
import Logo from "./Logo";
import type { ResolvedNavItem } from "@/lib/navigation";

// Desktop nav's link list now reads from the same founder-managed source
// as the mobile hamburger menu (Part A11: "desktop and mobile should use
// the SAME managed navigation source") — Logo, the dedicated Search link,
// and CartBadge stay exactly where they were; only the link list + CTA
// button are now data-driven instead of a hardcoded array. There's no
// dropdown UI on desktop this pass (submenus are a mobile-drawer-only
// concept for now), so a parent-only header row (no destination of its
// own) has nothing to render on desktop — its children are flattened
// into the same top-level row instead of being dropped, so no real
// destination goes unreachable from desktop just because it's nested in
// the mobile drawer. A top-level item WITH its own destination renders
// directly, whether or not it also has children.
export default function NavDesktop({ navItems }: { navItems: ResolvedNavItem[] }) {
  const linkable = navItems
    .flatMap((item) => (item.href ? [item] : item.children))
    .filter((item): item is ResolvedNavItem & { href: string } => Boolean(item.href));
  const plain = linkable.filter((item) => !item.highlight);
  const highlighted = linkable.filter((item) => item.highlight);

  return (
    <header className="sticky top-0 z-40 hidden border-b border-black/5 bg-paper/90 backdrop-blur md:block">
      <div className="mx-auto flex max-w-6xl items-center gap-8 px-6 py-4">
        <Logo heightClassName="h-10" />
        <nav className="flex flex-1 items-center gap-6">
          {plain.map((item) => (
            <NavLink key={item.id} item={item} className="text-sm font-medium text-ink/70 transition hover:text-ink" />
          ))}
        </nav>
        <HeaderSearch variant="text" />
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

function NavLink({ item, className }: { item: ResolvedNavItem & { href: string }; className: string }) {
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
