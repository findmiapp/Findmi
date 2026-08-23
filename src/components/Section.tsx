import Link from "next/link";

export default function Section({
  title,
  subtitle,
  viewAllHref,
  children,
}: {
  title: string;
  subtitle?: string;
  viewAllHref?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="py-6">
      <div className="mb-3 flex items-end justify-between gap-4 px-4 sm:px-6">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-ink">{title}</h2>
          {subtitle && <p className="mt-1 text-sm text-ink/55">{subtitle}</p>}
        </div>
        {viewAllHref && (
          <Link
            href={viewAllHref}
            className="shrink-0 text-sm font-medium text-ink/60 hover:text-ink"
          >
            View all
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

export function HorizontalScroller({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-4 overflow-x-auto px-4 pb-2 sm:px-6 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {children}
    </div>
  );
}
