import type { ReactNode } from "react";

// Shared layout for Findmi's legal documents (Terms of Service, Privacy
// Policy). Plain, readable text pages in the existing Findmi type scale:
// one column, an "On This Page" index of anchor links, and numbered
// sections. Content stays in each page so the wording is reviewable in one
// place; this component only renders it.

/** A paragraph (string), a bullet list, or a rich block (links etc.). */
export type LegalBlock = string | { list: readonly ReactNode[] } | { node: ReactNode };

export interface LegalSection {
  id: string;
  title: string;
  blocks: readonly LegalBlock[];
}

function renderBlock(block: LegalBlock, key: number) {
  if (typeof block === "string") return <p key={key}>{block}</p>;
  if ("list" in block) {
    return (
      <ul key={key} className="list-disc space-y-1.5 pl-5 marker:text-ink/30">
        {block.list.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    );
  }
  return <div key={key}>{block.node}</div>;
}

export default function LegalPage({
  title,
  lastUpdated,
  intro,
  sections,
}: {
  title: string;
  lastUpdated: string;
  intro: readonly LegalBlock[];
  sections: readonly LegalSection[];
}) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6 sm:py-16">
      <h1 className="font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">{title}</h1>
      <p className="mt-2 text-sm text-ink/50">Last updated {lastUpdated}</p>

      <div className="mt-6 space-y-3 text-base leading-relaxed text-ink/75">{intro.map(renderBlock)}</div>

      <nav aria-labelledby="legal-toc-title" className="mt-8 rounded-2xl border border-black/5 bg-black/[0.015] p-4 sm:p-5">
        <h2 id="legal-toc-title" className="text-xs font-semibold uppercase tracking-wide text-ink/45">
          On This Page
        </h2>
        <ol className="mt-3 grid gap-x-6 gap-y-1.5 text-sm text-ink/70 sm:grid-cols-2">
          {sections.map((s, i) => (
            <li key={s.id} className="min-w-0">
              <a href={`#${s.id}`} className="hover:text-ink hover:underline">
                {i + 1}. {s.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="mt-10 space-y-10 text-sm leading-relaxed text-ink/70">
        {sections.map((s, i) => (
          <section key={s.id} id={s.id} aria-labelledby={`${s.id}-title`} className="scroll-mt-24">
            <h2 id={`${s.id}-title`} className="font-display text-lg font-semibold tracking-tight text-ink">
              {i + 1}. {s.title}
            </h2>
            <div className="mt-3 space-y-3">{s.blocks.map(renderBlock)}</div>
          </section>
        ))}
      </div>
    </div>
  );
}
