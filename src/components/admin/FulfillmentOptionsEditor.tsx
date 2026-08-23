"use client";

import { useState } from "react";
import type { SelectOption } from "@/lib/admin/queries";
import type { ProductFulfillmentOptionRow } from "@/lib/admin/queries";

const inputClass =
  "rounded-lg border border-black/10 bg-white px-2.5 py-2 text-sm text-ink focus:border-ink/30 focus:outline-none";

const STANDARD_METHODS: { method: "shipping" | "local_delivery" | "pickup"; label: string }[] = [
  { method: "shipping", label: "Shipping" },
  { method: "local_delivery", label: "Local Delivery" },
  { method: "pickup", label: "Pickup" },
];

/** Founder-configured, flat-priced fulfillment methods for one product —
 * no carrier integration, just enable/price per method (Part 7), plus
 * Event Pickup rows tied to specific upcoming appearances (Part 8). Posts
 * as plain form fields into the same product Server Action; the action
 * rebuilds this product's fulfillment options from scratch on save. */
export default function FulfillmentOptionsEditor({
  initialOptions,
  appearanceOptions,
}: {
  initialOptions: ProductFulfillmentOptionRow[];
  appearanceOptions: SelectOption[];
}) {
  const standardInitial = (method: string) => initialOptions.find((o) => o.method === method);

  const [eventPickups, setEventPickups] = useState(
    initialOptions
      .filter((o) => o.method === "event_pickup" && o.appearance_id)
      .map((o) => ({ appearanceId: o.appearance_id as string, price: o.price }))
  );
  const [addAppearanceId, setAddAppearanceId] = useState("");
  const [addPrice, setAddPrice] = useState("0");

  const usedIds = new Set(eventPickups.map((e) => e.appearanceId));
  const remainingAppearances = appearanceOptions.filter((a) => !usedIds.has(a.value));

  return (
    <div className="rounded-2xl border border-black/10 p-4">
      <p className="mb-3 text-sm font-semibold text-ink">Fulfillment Options</p>

      <div className="flex flex-col gap-2.5">
        {STANDARD_METHODS.map(({ method, label }) => {
          const existing = standardInitial(method);
          return (
            <div key={method} className="flex flex-wrap items-center gap-3 rounded-lg border border-black/5 p-2.5">
              <label className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  name={`fulfillment_${method}_enabled`}
                  defaultChecked={existing?.enabled}
                  className="h-4 w-4 accent-findmi"
                />
                {label}
              </label>
              <span className="text-xs text-ink/50">$</span>
              <input
                type="number"
                step="0.01"
                min="0"
                name={`fulfillment_${method}_price`}
                defaultValue={existing?.price ?? 0}
                className={`${inputClass} w-24`}
              />
            </div>
          );
        })}
      </div>

      <p className="mb-1.5 mt-4 text-xs font-semibold uppercase tracking-wide text-ink/50">
        Event Pickup
      </p>
      {eventPickups.length === 0 ? (
        <p className="text-sm text-ink/45">No pickup appearances configured.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {eventPickups.map((ep) => {
            const appearance = appearanceOptions.find((a) => a.value === ep.appearanceId);
            return (
              <div key={ep.appearanceId} className="flex flex-wrap items-center gap-3 rounded-lg border border-black/5 p-2.5">
                <input type="hidden" name="event_pickup_appearance_id" value={ep.appearanceId} />
                <span className="min-w-0 flex-1 truncate text-sm text-ink">
                  {appearance?.label ?? "Appearance"}
                </span>
                <span className="text-xs text-ink/50">$</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  name={`event_pickup_price_${ep.appearanceId}`}
                  value={ep.price}
                  onChange={(e) =>
                    setEventPickups((prev) =>
                      prev.map((p) => (p.appearanceId === ep.appearanceId ? { ...p, price: Number(e.target.value) } : p))
                    )
                  }
                  className={`${inputClass} w-24`}
                />
                <button
                  type="button"
                  onClick={() => setEventPickups((prev) => prev.filter((p) => p.appearanceId !== ep.appearanceId))}
                  className="text-xs font-semibold text-red-600 hover:underline"
                >
                  Remove
                </button>
              </div>
            );
          })}
        </div>
      )}

      {remainingAppearances.length > 0 ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <select value={addAppearanceId} onChange={(e) => setAddAppearanceId(e.target.value)} className={inputClass}>
            <option value="">Choose an upcoming appearance…</option>
            {remainingAppearances.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
          <span className="text-xs text-ink/50">$</span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={addPrice}
            onChange={(e) => setAddPrice(e.target.value)}
            className={`${inputClass} w-24`}
          />
          <button
            type="button"
            disabled={!addAppearanceId}
            onClick={() => {
              setEventPickups((prev) => [...prev, { appearanceId: addAppearanceId, price: Number(addPrice) || 0 }]);
              setAddAppearanceId("");
              setAddPrice("0");
            }}
            className="rounded-lg border border-black/10 px-3 py-2 text-xs font-semibold text-ink hover:bg-black/[0.03] disabled:opacity-40"
          >
            + Add
          </button>
        </div>
      ) : (
        <p className="mt-2 text-xs text-ink/40">
          {appearanceOptions.length === 0
            ? "This business has no upcoming appearances to attach pickup to yet."
            : "Every upcoming appearance is already configured for pickup."}
        </p>
      )}
    </div>
  );
}
