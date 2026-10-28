"use client";

import { useEffect, useState } from "react";
import OptimisticTabs from "./OptimisticTabs";
import ScrollActiveIntoView from "./ScrollActiveIntoView";
import { managerHref } from "@/lib/manager-links";

/** Public Profile's section navigation, shared by Public Profile
 * (?tab=profile) and its Photos destination (?tab=gallery) so the two read
 * as one place. Same segmented control as Findmi Here's Events / Places /
 * Past (PresenceHeader): OptimisticTabs in a rounded track, white active
 * pill, scrolling sideways inside the track on a phone (never wrapping,
 * never widening the page), the active pill scrolled into view.
 *
 * On Public Profile the four in-page sections are in-page anchors and the
 * highlight follows the section in view; Photos is its own destination, so
 * there it is the highlighted item and the others lead back into Profile. */

type Key = "details" | "gallery" | "links" | "announcement" | "public-actions";

/** Findmi Consolidation pass — Details · Photos (Logo, Cover, Gallery) ·
 * Contact & Links · Announcement · Profile Buttons. Profile Buttons is no
 * longer the second item: identity first, then how people reach you. */
const SECTIONS: { key: Key; label: string }[] = [
  { key: "details", label: "Details" },
  { key: "gallery", label: "Photos" },
  { key: "links", label: "Contact & Links" },
  { key: "announcement", label: "Announcement" },
  { key: "public-actions", label: "Profile Buttons" },
];

const IN_PAGE: Key[] = ["details", "links", "announcement", "public-actions"];

export default function ProfileSectionNav({ businessId, current }: { businessId: string; current: "profile" | "gallery" }) {
  const onProfile = current === "profile";
  const [inView, setInView] = useState<Key>("details");

  // Which Profile section is under the header: the last one whose top has
  // passed ~a third of the way down the screen.
  useEffect(() => {
    if (!onProfile) return;
    const els = IN_PAGE.map((id) => document.getElementById(id)).filter((el): el is HTMLElement => el !== null);
    if (els.length === 0) return;
    const update = () => {
      const line = window.innerHeight / 3;
      let key: Key = "details";
      for (const el of els) if (el.getBoundingClientRect().top <= line) key = el.id as Key;
      setInView(key);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [onProfile]);

  const base = managerHref(businessId, "profile");
  const items = SECTIONS.map(({ key, label }) => ({
    key,
    label,
    href: key === "gallery" ? managerHref(businessId, "gallery") : onProfile ? `#${key}` : `${base}#${key}`,
  }));
  const active = onProfile ? inView : "gallery";

  return (
    <OptimisticTabs
      ariaLabel="Public Profile sections"
      navClass="flex w-full gap-1 overflow-x-auto rounded-full bg-black/[0.04] p-1 [-ms-overflow-style:none] [scrollbar-width:none] sm:w-fit [&::-webkit-scrollbar]:hidden"
      linkClass="flex h-9 shrink-0 items-center justify-center whitespace-nowrap rounded-full px-3 text-[13px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-findmi/40 sm:px-3.5 sm:text-button"
      activeClass="bg-white text-primary shadow-sm"
      inactiveClass="text-muted hover:text-primary"
      active={active}
      items={items}
    >
      <ScrollActiveIntoView key={active} />
    </OptimisticTabs>
  );
}
