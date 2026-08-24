"use client";

import { useMemo, useState } from "react";
import type { Market, MembershipPlan } from "@/lib/types";
import { formatCurrency } from "@/lib/format";
import { startMembershipCheckout } from "./actions";

export default function PlanCheckoutForm({
  plans,
  markets,
  defaultPlanSlug,
}: {
  plans: MembershipPlan[];
  markets: Market[];
  defaultPlanSlug?: string;
}) {
  const [planSlug, setPlanSlug] = useState(defaultPlanSlug ?? plans[0]?.slug ?? "");
  const [selectedMarkets, setSelectedMarkets] = useState<string[]>([]);
  const plan = useMemo(() => plans.find((p) => p.slug === planSlug) ?? plans[0], [plans, planSlug]);
  const limit = plan?.market_limit ?? null;
  const atLimit = limit !== null && selectedMarkets.length >= limit;

  if (!plan) return null;

  return (
    <form action={startMembershipCheckout} className="flex flex-col gap-5">
      <div>
        <span className="mb-2 block text-sm font-semibold text-ink">Choose your plan</span>
        <div className="grid gap-2 sm:grid-cols-3">
          {plans.map((p) => (
            <label
              key={p.id}
              className={`cursor-pointer rounded-2xl border px-4 py-3 transition ${
                p.slug === planSlug ? "border-findmi bg-findmi-50" : "border-black/10 bg-white hover:border-black/20"
              }`}
            >
              <input
                type="radio"
                name="plan_slug"
                value={p.slug}
                checked={p.slug === planSlug}
                onChange={() => {
                  setPlanSlug(p.slug);
                  setSelectedMarkets([]);
                }}
                className="sr-only"
              />
              <p className="text-sm font-bold text-ink">{p.name}</p>
              <p className="mt-0.5 text-xs text-ink/60">
                {formatCurrency(p.annual_price)}/yr · {p.market_limit ? `up to ${p.market_limit} market${p.market_limit === 1 ? "" : "s"}` : "unlimited markets"}
              </p>
            </label>
          ))}
        </div>
        {plan.description && <p className="mt-2 text-xs text-ink/50">{plan.description}</p>}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink">Business Name</span>
          <input
            type="text"
            name="business_name"
            required
            className="w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink focus:border-ink/30 focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink">Your Name</span>
          <input
            type="text"
            name="contact_name"
            required
            className="w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink focus:border-ink/30 focus:outline-none"
          />
        </label>
      </div>
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-ink">Email</span>
        <input
          type="email"
          name="contact_email"
          required
          className="w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink focus:border-ink/30 focus:outline-none"
        />
      </label>

      <div>
        <span className="mb-1.5 block text-sm font-medium text-ink">
          FindMi Market{limit ? ` (choose up to ${limit})` : "s"}
        </span>
        <div className="flex flex-wrap gap-2">
          {markets.map((m) => {
            const checked = selectedMarkets.includes(m.id);
            const disabled = !checked && atLimit;
            return (
              <label
                key={m.id}
                className={`flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm transition ${
                  checked ? "border-findmi bg-findmi-50 text-findmi-700" : "border-black/10 text-ink/70"
                } ${disabled ? "opacity-40" : "cursor-pointer hover:border-black/20"}`}
              >
                <input
                  type="checkbox"
                  name="market_ids"
                  value={m.id}
                  checked={checked}
                  disabled={disabled}
                  onChange={(e) => {
                    setSelectedMarkets((prev) =>
                      e.target.checked ? [...prev, m.id] : prev.filter((id) => id !== m.id)
                    );
                  }}
                  className="sr-only"
                />
                {m.name}
              </label>
            );
          })}
        </div>
        <p className="mt-1.5 text-xs text-ink/45">
          A national brand still only gets the markets its plan covers — broader coverage needs Pro or
          Multi-Region, not company size.
        </p>
      </div>

      <button
        type="submit"
        className="rounded-full bg-findmi px-6 py-3.5 text-center text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
      >
        Continue to Payment — {formatCurrency(plan.annual_price)}/year
      </button>
      <p className="text-center text-xs text-ink/40">Secure checkout via Stripe. Cancel anytime.</p>
    </form>
  );
}
