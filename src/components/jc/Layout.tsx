import Link from "next/link";
import { MIN_RAIL_ITEMS, jcHref } from "@/lib/jc/config";

// Rails, sections, chips and empty states — the JC page skeleton.

/** Horizontal scroll-snap rail. Card width leaves the next card peeking. */
export function Rail({ children, size = "md" }: { children: React.ReactNode[]; size?: "sm" | "md" | "lg" }) {
  const width = size === "lg" ? "w-[86%] md:w-[420px]" : size === "sm" ? "w-[38%] md:w-[170px]" : "w-[62%] md:w-[240px]";
  return (
    <div className="jc-rail -mb-2 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-4 px-4 pb-2 md:scroll-px-8 md:px-8">
      {children.map((child, i) => (
        <div key={i} className={`${width} shrink-0 snap-start`}>
          {child}
        </div>
      ))}
      <div aria-hidden className="w-1 shrink-0" />
    </div>
  );
}

export function SectionHead({ title, href, sub }: { title: string; href?: string; sub?: string }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-4 px-4 md:px-8">
      <div>
        <h2 className="text-[20px] font-semibold leading-tight tracking-[-0.025em]">{title}</h2>
        {sub && <p className="mt-0.5 text-[13px] text-neutral-500">{sub}</p>}
      </div>
      {href && (
        <Link href={href} className="shrink-0 pb-0.5 text-[13.5px] font-medium text-neutral-500 hover:text-neutral-950">
          See all
        </Link>
      )}
    </div>
  );
}

/** Renders only when there's enough real content — never padded. */
export function Module<T>({
  title,
  sub,
  href,
  items,
  min = MIN_RAIL_ITEMS,
  size,
  render,
}: {
  title: string;
  sub?: string;
  href?: string;
  items: T[];
  min?: number;
  size?: "sm" | "md" | "lg";
  render: (item: T, i: number) => React.ReactNode;
}) {
  if (items.length < min) return null;
  return (
    <section className="pt-7">
      <SectionHead title={title} sub={sub} href={href} />
      <Rail size={size}>{items.map(render)}</Rail>
    </section>
  );
}

export interface Chip {
  label: string;
  href: string;
  active: boolean;
}

export function ChipBar({ chips, className = "" }: { chips: Chip[]; className?: string }) {
  if (chips.length < 2) return null;
  return (
    <nav className={`jc-rail flex gap-2 overflow-x-auto px-4 md:px-8 ${className}`}>
      {chips.map((c) => (
        <Link
          key={c.href}
          href={c.href}
          scroll={false}
          className={`shrink-0 rounded-full px-3.5 py-[7px] text-[13.5px] font-medium transition-colors ${
            c.active ? "bg-neutral-950 text-white" : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"
          }`}
        >
          {c.label}
        </Link>
      ))}
    </nav>
  );
}

export function PageTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <header className="px-4 pb-4 pt-5 md:px-8 md:pt-10">
      <h1 className="text-[30px] font-semibold leading-[1.05] tracking-[-0.035em] md:text-[40px]">{title}</h1>
      {sub && <p className="mt-1.5 text-[15px] text-neutral-500">{sub}</p>}
    </header>
  );
}

export function EmptyState({ title, body, cta }: { title: string; body: string; cta?: { label: string; href: string } }) {
  return (
    <div className="mx-4 my-8 rounded-[22px] bg-neutral-50 px-6 py-10 text-center md:mx-8">
      <p className="text-[17px] font-semibold tracking-[-0.015em]">{title}</p>
      <p className="mx-auto mt-1.5 max-w-xs text-[14px] leading-relaxed text-neutral-500">{body}</p>
      {cta && (
        <Link href={cta.href} className="mt-5 inline-flex rounded-full bg-neutral-950 px-4 py-2 text-[14px] font-medium text-white">
          {cta.label}
        </Link>
      )}
    </div>
  );
}

export function withParams(path: string, params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
  const qs = sp.toString();
  return jcHref(qs ? `${path}?${qs}` : path);
}
