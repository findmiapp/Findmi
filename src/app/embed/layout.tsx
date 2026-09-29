import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { default: "Findmi", template: "%s · Findmi" },
  // An embed fragment is never a real destination of its own — never
  // indexed, never followed. Same convention as admin/layout.tsx.
  robots: { index: false, follow: false },
};

// Embeddable Business Widget Phase 1 — deliberately its own top-level
// segment (sibling to (public) and admin), NOT nested inside
// (public)/layout.tsx, so it never inherits that layout's nav/footer/
// session queries. No min-h-screen here (admin/layout.tsx's own wrapper
// uses it, but that's for a real full-page app view) — the embed lives
// inside an iframe the PARENT page sizes to the widget's own rendered
// content height, so nothing here should force extra height.
export default function EmbedLayout({ children }: { children: React.ReactNode }) {
  return <div className="bg-paper">{children}</div>;
}
