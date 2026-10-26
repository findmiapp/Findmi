// Taxonomy V2 stages its new Category rows in public.categories with
// status 'staged' until the read switch. Anon / authenticated reads never
// see them (RLS); SERVICE-ROLE reads bypass RLS, so every V1 reader that
// lists or resolves categories through the admin client adds
// `.neq("status", STAGED_CATEGORY_STATUS)`. (Live V1 rows are all
// 'active' — unaffected.)

export const STAGED_CATEGORY_STATUS = "staged";
