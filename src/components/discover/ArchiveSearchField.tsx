/**
 * Shared archive search input (Discovery/Archive V2 Part 15) — plain,
 * server-rendered, no client JS needed: it's one field inside the
 * page's own <form method="get">, so pressing Enter submits natively
 * and the query lands in the URL (`?q=...`) like every other filter.
 * Not a separate component instance per keystroke/typeahead — the
 * header's AJAX search already owns that experience (HeaderSearch.tsx);
 * this is the archive page's own real, URL-driven search field.
 */
export default function ArchiveSearchField({
  name = "q",
  defaultValue,
  placeholder,
}: {
  name?: string;
  defaultValue?: string;
  placeholder: string;
}) {
  return (
    <input
      type="text"
      name={name}
      defaultValue={defaultValue}
      placeholder={placeholder}
      className="h-12 w-full rounded-full border border-black/10 bg-white px-5 text-sm text-ink placeholder:text-ink/40 focus:border-ink/30 focus:outline-none"
    />
  );
}
