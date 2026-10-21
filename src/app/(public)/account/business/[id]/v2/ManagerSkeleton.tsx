"use client";

import { useSearchParams } from "next/navigation";

/** Business Manager — the content-area placeholder shown the instant a
 * destination is entered while its data resolves. It only ever fills the
 * content slot of the persistent shell (never the whole manager), is shaped
 * like the destination being opened (so nothing jumps when the real view
 * arrives) and is plain markup — no data, no spinner. */

const bar = "animate-pulse rounded-lg bg-black/[0.06]";

function Heading({ withAction }: { withAction?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <div className={`${bar} h-8 w-40`} />
        <div className={`${bar} mt-3 h-4 w-full max-w-sm`} />
      </div>
      {withAction && <div className="h-11 w-32 shrink-0 animate-pulse rounded-full bg-black/[0.06]" />}
    </div>
  );
}

function Rows({ n = 3 }: { n?: number }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-2xl border border-black/[0.06] bg-white p-3">
          <div className="h-16 w-16 shrink-0 animate-pulse rounded-xl bg-black/[0.06]" />
          <div className="min-w-0 flex-1">
            <div className={`${bar} h-4 w-2/3`} />
            <div className={`${bar} mt-2.5 h-3 w-1/2`} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Tiles({ n = 4 }: { n?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {Array.from({ length: n }, (_, i) => (
        <div key={i}>
          <div className="aspect-[4/5] animate-pulse rounded-2xl bg-black/[0.06]" />
          <div className={`${bar} mt-2.5 h-4 w-3/4`} />
          <div className={`${bar} mt-2 h-3 w-1/2`} />
        </div>
      ))}
    </div>
  );
}

function Metrics() {
  return (
    <div className="grid grid-cols-2 gap-3">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="rounded-2xl border border-black/[0.06] bg-white p-4">
          <div className={`${bar} h-3 w-16`} />
          <div className={`${bar} mt-3 h-7 w-20`} />
        </div>
      ))}
    </div>
  );
}

function Pills() {
  return <div className="h-11 w-full max-w-md animate-pulse rounded-full bg-black/[0.05]" />;
}

export default function ManagerSkeleton({ tab: tabProp }: { tab?: string }) {
  const urlTab = useSearchParams().get("tab");
  const tab = tabProp ?? urlTab ?? "overview";
  let body;
  switch (tab) {
    case "moments":
      body = (
        <>
          <Heading withAction />
          <Pills />
          <Tiles />
        </>
      );
      break;
    case "findmi-here":
      body = (
        <>
          <Heading />
          <Pills />
          <Rows />
        </>
      );
      break;
    case "performance":
    case "qr":
      body = (
        <>
          <Heading />
          <Pills />
          <Metrics />
        </>
      );
      break;
    case "growth":
    case "opportunities":
      body = (
        <>
          <Heading />
          <Pills />
          <Rows n={4} />
        </>
      );
      break;
    case "overview":
      body = (
        <>
          <div className="h-14 w-full animate-pulse rounded-2xl bg-black/[0.05]" />
          <div className={`${bar} h-6 w-32`} />
          <Rows n={2} />
          <div className={`${bar} h-6 w-32`} />
          <Metrics />
        </>
      );
      break;
    default:
      body = (
        <>
          <Heading />
          <Rows n={4} />
        </>
      );
  }
  return (
    <div role="status" aria-label="Loading" aria-busy="true" data-manager-skeleton className="flex flex-col gap-5 lg:max-w-3xl">
      {body}
    </div>
  );
}
