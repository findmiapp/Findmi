import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s · FindMi Admin" },
  robots: { index: false, follow: false },
};

// Deliberately minimal — the real nav/header chrome lives in
// (protected)/layout.tsx so /admin/login doesn't render it (there's
// nothing to navigate to before signing in). Middleware is the actual
// access gate either way; this split is purely about not showing an admin
// nav bar on the login screen.
export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-paper">{children}</div>;
}
