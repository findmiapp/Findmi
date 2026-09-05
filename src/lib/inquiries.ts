// Native Inquiries + Private Conversation Threads V1 — shared read
// helpers for both the customer (/account/inquiries) and business
// (Business Manager Inquiries tab) surfaces. Callers pass whichever
// Supabase client is already appropriate for them (the customer's own
// session client, respecting inquiries_select_customer RLS; the
// business's admin/service-role client, already gated by a prior
// requireBusinessMember() check) — this file never decides authorization
// itself, same "authorize first, read after" shape as the rest of the
// app's owner-facing reads (see lib/business-followers.ts).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Inquiry, InquiryMessage, PublicProfile } from "./types";
import { getPublicProfilesByUserIds } from "./profiles";

export interface InquiryListItem {
  id: string;
  status: Inquiry["status"];
  createdAt: string;
  productId: string | null;
  productName: string | null;
  lastMessage: { body: string; senderType: InquiryMessage["sender_type"]; createdAt: string } | null;
  unread: boolean;
}

export interface CustomerInquiryListItem extends InquiryListItem {
  businessId: string;
  businessName: string;
  businessSlug: string;
  businessLogoUrl: string | null;
}

export interface BusinessInquiryListItem extends InquiryListItem {
  customerProfile: PublicProfile | null;
}

type InquiryRow = Inquiry;
type MessageRow = InquiryMessage;

async function latestMessagesByInquiry(
  supabase: SupabaseClient,
  inquiryIds: string[]
): Promise<Map<string, MessageRow>> {
  const map = new Map<string, MessageRow>();
  if (inquiryIds.length === 0) return map;
  const { data } = await supabase
    .from("inquiry_messages")
    .select("*")
    .in("inquiry_id", inquiryIds)
    .order("created_at", { ascending: false });
  for (const row of (data ?? []) as MessageRow[]) {
    if (!map.has(row.inquiry_id)) map.set(row.inquiry_id, row);
  }
  return map;
}

function isUnreadForCustomer(inquiry: InquiryRow, last: MessageRow | undefined): boolean {
  if (!last || last.sender_type !== "business") return false;
  if (!inquiry.customer_last_read_at) return true;
  return new Date(last.created_at) > new Date(inquiry.customer_last_read_at);
}

function isUnreadForBusiness(inquiry: InquiryRow, last: MessageRow | undefined): boolean {
  if (!last || last.sender_type !== "customer") return false;
  if (!inquiry.business_last_read_at) return true;
  return new Date(last.created_at) > new Date(inquiry.business_last_read_at);
}

/** The authenticated customer's own inquiries — relies on RLS
 * (inquiries_select_customer) rather than an explicit .eq("user_id", ...)
 * filter alone, so this is safe to call with the plain session client;
 * the filter is added anyway as defense in depth, same discipline
 * lib/permissions.ts's own comment documents for its RLS-backed reads. */
export async function getCustomerInquiryList(
  supabase: SupabaseClient,
  userId: string
): Promise<CustomerInquiryListItem[]> {
  const { data } = await supabase
    .from("inquiries")
    .select("*, business:businesses(id, name, slug, logo_url), product:products(name)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  type Row = InquiryRow & {
    business: { id: string; name: string; slug: string; logo_url: string | null } | null;
    product: { name: string } | null;
  };
  const rows = (data ?? []) as unknown as Row[];
  const lastByInquiry = await latestMessagesByInquiry(supabase, rows.map((r) => r.id));

  return rows
    .filter((r) => r.business)
    .map((r) => {
      const last = lastByInquiry.get(r.id);
      return {
        id: r.id,
        status: r.status,
        createdAt: r.created_at,
        productId: r.product_id,
        productName: r.product?.name ?? null,
        businessId: r.business!.id,
        businessName: r.business!.name,
        businessSlug: r.business!.slug,
        businessLogoUrl: r.business!.logo_url,
        lastMessage: last ? { body: last.body, senderType: last.sender_type, createdAt: last.created_at } : null,
        unread: isUnreadForCustomer(r, last),
      };
    });
}

export interface InquiryDetail {
  inquiry: Inquiry;
  messages: InquiryMessage[];
}

export async function getCustomerInquiryDetail(
  supabase: SupabaseClient,
  inquiryId: string,
  userId: string
): Promise<(InquiryDetail & { business: { id: string; name: string; slug: string; logo_url: string | null } }) | null> {
  const { data: inquiry } = await supabase
    .from("inquiries")
    .select("*, business:businesses(id, name, slug, logo_url)")
    .eq("id", inquiryId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!inquiry) return null;
  const row = inquiry as unknown as InquiryRow & { business: { id: string; name: string; slug: string; logo_url: string | null } | null };
  if (!row.business) return null;

  const { data: messages } = await supabase
    .from("inquiry_messages")
    .select("*")
    .eq("inquiry_id", inquiryId)
    .order("created_at", { ascending: true });

  return { inquiry: row, business: row.business, messages: (messages ?? []) as InquiryMessage[] };
}

/** Business Manager's Inquiries tab — always called with the admin
 * client AFTER requireBusinessMember(businessId) has already run in the
 * page itself (same authorize-then-elevate shape every other owner-facing
 * admin-client read in that page uses — see getBusinessFollowerSummary).
 * Never exposes customer_email/customer_phone/user_id in the returned
 * shape; only PublicProfile for the subset of customers who have one. */
export async function getBusinessInquiryList(
  admin: SupabaseClient,
  businessId: string
): Promise<BusinessInquiryListItem[]> {
  const { data } = await admin
    .from("inquiries")
    .select("*, product:products(name)")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false });

  type Row = InquiryRow & { product: { name: string } | null };
  const rows = (data ?? []) as unknown as Row[];
  const lastByInquiry = await latestMessagesByInquiry(admin, rows.map((r) => r.id));
  const userIds = rows.map((r) => r.user_id).filter((id): id is string => Boolean(id));
  const profiles = await getPublicProfilesByUserIds(admin, userIds);

  return rows.map((r) => {
    const last = lastByInquiry.get(r.id);
    return {
      id: r.id,
      status: r.status,
      createdAt: r.created_at,
      productId: r.product_id,
      productName: r.product?.name ?? null,
      customerProfile: r.user_id ? (profiles.get(r.user_id) ?? null) : null,
      lastMessage: last ? { body: last.body, senderType: last.sender_type, createdAt: last.created_at } : null,
      unread: isUnreadForBusiness(r, last),
    };
  });
}

export async function getBusinessInquiryDetail(
  admin: SupabaseClient,
  inquiryId: string,
  businessId: string
): Promise<(InquiryDetail & { customerProfile: PublicProfile | null }) | null> {
  const { data: inquiry } = await admin
    .from("inquiries")
    .select("*")
    .eq("id", inquiryId)
    .eq("business_id", businessId)
    .maybeSingle();
  if (!inquiry) return null;
  const row = inquiry as InquiryRow;

  const [{ data: messages }, profiles] = await Promise.all([
    admin.from("inquiry_messages").select("*").eq("inquiry_id", inquiryId).order("created_at", { ascending: true }),
    row.user_id ? getPublicProfilesByUserIds(admin, [row.user_id]) : Promise.resolve(new Map<string, PublicProfile>()),
  ]);

  return {
    inquiry: row,
    customerProfile: row.user_id ? (profiles.get(row.user_id) ?? null) : null,
    messages: (messages ?? []) as InquiryMessage[],
  };
}
