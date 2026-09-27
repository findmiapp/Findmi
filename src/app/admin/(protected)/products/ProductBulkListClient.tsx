"use client";

import Link from "next/link";
import AdminBulkList from "@/components/admin/AdminBulkList";
import ProductBulkActionBar from "./ProductBulkActionBar";
import type { AdminProductRow } from "@/lib/admin/queries";
import type { Category } from "@/lib/types";
import { formatDateShort, formatPrice } from "@/lib/format";

/** Admin Content Lifecycle + Bulk Management V1 — client half of the
 * products list: per-row checkbox + the existing status badges (now also
 * showing Archived/Trashed, when applicable) wired into the shared
 * AdminBulkList selection primitive and the product-specific bulk action
 * bar. Row content itself (name, business, price, badges) is unchanged
 * from the previous list — only the outer element changed, from a
 * whole-row <Link> to a checkbox + row div with the name itself as the
 * click target, so a checkbox can sit in the row without ending up nested
 * inside an anchor (same shape AppearanceReviewList already uses). */
export default function ProductBulkListClient({
  products,
  view,
  categories,
}: {
  products: AdminProductRow[];
  view: "active" | "paused" | "archived" | "trashed" | "other";
  categories: Category[];
}) {
  return (
    <AdminBulkList
      items={products}
      emptyMessage="No products in this view."
      renderBulkBar={(selectedIds) => <ProductBulkActionBar view={view} selectedIds={selectedIds} categories={categories} />}
      renderRow={(p, selected, toggle) => {
        const moderationStatus = p.moderation_status ?? "live";
        const badgeLabel =
          moderationStatus === "pending_review"
            ? "Pending Review"
            : moderationStatus === "rejected"
              ? "Rejected"
              : p.pending_changes
                ? "Changes Pending"
                : p.is_active
                  ? "Active"
                  : "Inactive";
        const badgeClass =
          moderationStatus === "pending_review" || p.pending_changes
            ? "bg-amber-100 text-amber-800"
            : moderationStatus === "rejected"
              ? "bg-red-50 text-red-700"
              : p.is_active
                ? "bg-findmi-50 text-findmi-700"
                : "bg-black/[0.06] text-ink/50";

        const marketplaceStatus = p.marketplace_status ?? "catalog_only";
        const marketplaceBadge =
          marketplaceStatus === "submitted"
            ? { label: "Marketplace Pending", className: "bg-sky-100 text-sky-800" }
            : marketplaceStatus === "approved"
              ? { label: "Marketplace Approved", className: "bg-sky-50 text-sky-700" }
              : marketplaceStatus === "paused"
                ? { label: "Marketplace Paused", className: "bg-black/[0.06] text-ink/50" }
                : marketplaceStatus === "rejected"
                  ? { label: "Marketplace Rejected", className: "bg-red-50 text-red-700" }
                  : null;

        return (
          <div
            key={p.id}
            className="flex items-center gap-3 rounded-xl border border-black/5 bg-white px-4 py-3 transition hover:border-black/10"
          >
            <input
              type="checkbox"
              checked={selected}
              onChange={toggle}
              className="h-4 w-4 shrink-0"
              aria-label={`Select ${p.name}`}
            />
            <Link href={`/admin/products/${p.id}`} className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink">{p.name}</p>
              <p className="truncate text-xs text-ink/45">
                {p.business?.name ?? "—"}
                {formatPrice(p.price, p.price_label) ? ` · ${formatPrice(p.price, p.price_label)}` : ""}
              </p>
              {p.archived_at && (
                <p className="truncate text-[11px] text-ink/40">Archived {formatDateShort(p.archived_at)}</p>
              )}
              {p.trashed_at && <p className="truncate text-[11px] text-ink/40">Trashed {formatDateShort(p.trashed_at)}</p>}
            </Link>
            <span className="flex shrink-0 flex-col items-end gap-1">
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${badgeClass}`}>
                {badgeLabel}
              </span>
              {marketplaceBadge && (
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${marketplaceBadge.className}`}>
                  {marketplaceBadge.label}
                </span>
              )}
            </span>
          </div>
        );
      }}
    />
  );
}
