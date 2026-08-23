import Link from "next/link";
import CartBadge from "./CartBadge";
import Logo from "./Logo";

const links = [
  { href: "/discover", label: "Discover" },
  { href: "/find", label: "FindMi Here" },
  { href: "/events", label: "Events" },
  { href: "/businesses", label: "Businesses" },
  { href: "/join", label: "For Business" },
];

export default function NavDesktop() {
  return (
    <header className="sticky top-0 z-40 hidden border-b border-black/5 bg-paper/90 backdrop-blur md:block">
      <div className="mx-auto flex max-w-6xl items-center gap-8 px-6 py-4">
        <Logo />
        <nav className="flex flex-1 items-center gap-6">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-ink/70 transition hover:text-ink"
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <Link
          href="/businesses"
          className="text-sm font-medium text-ink/70 transition hover:text-ink"
        >
          Search
        </Link>
        <CartBadge variant="text" />
        <Link
          href="/join"
          className="rounded-full bg-findmi px-5 py-2.5 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
        >
          Join FindMi
        </Link>
      </div>
    </header>
  );
}
