-- Follow-up correction to business_order_management: that migration
-- widened order_items_fulfillment_status_check to the new 5-value
-- workflow (new/confirmed/ready/fulfilled/cancelled) but left the
-- column's own DEFAULT at the old 'unfulfilled' literal — which the new
-- constraint rejects outright. createPendingOrder() never sets
-- fulfillment_status explicitly on insert (relies on the column
-- default), so this would have made every new checkout fail at the
-- order_items insert step. Caught and fixed in the same pass, before any
-- application code shipped against it.
alter table public.order_items alter column fulfillment_status set default 'new';
