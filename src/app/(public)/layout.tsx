import NavDesktop from "@/components/NavDesktop";
import NavMobile from "@/components/NavMobile";
import MobileHeader from "@/components/MobileHeader";
import Footer from "@/components/Footer";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <MobileHeader />
      <NavDesktop />
      {/* No bottom padding here: Footer (always the next element) carries
          its own nav-clearance padding, so double-padding this div only
          produced a dead gap between content and the footer. */}
      <div className="flex-1 pt-14 md:pt-0">{children}</div>
      <Footer />
      <NavMobile />
    </>
  );
}
