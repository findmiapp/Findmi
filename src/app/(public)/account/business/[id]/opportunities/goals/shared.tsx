import Link from "next/link";
import type { ReactNode } from "react";

/** Shared frame for the goal flow pages (inside the Business shell). */
export function GoalFrame({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex w-full max-w-xl flex-col gap-4">{children}</div>;
}

export function GoalNotAllowed({ message, backHref }: { message: string; backHref: string }) {
  return (
    <div className="rounded-2xl border border-black/[0.07] bg-white p-5">
      <p className="text-card-title font-semibold text-primary">Goals</p>
      <p className="mt-1 text-body text-muted">{message}</p>
      <Link href={backHref} className="mt-3 inline-flex h-10 items-center rounded-xl border border-black/10 px-4 text-button font-semibold text-primary">
        Back To Your Goals
      </Link>
    </div>
  );
}
