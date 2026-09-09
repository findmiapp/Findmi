"use client";

// FindMi Global Handle Registry — one reusable username input shared by
// the Person profile form and every owned-entity (Business/Location/
// Event) "choose your Findmi URL" card. Sanitizes as-you-type (lowercase,
// allowed charset only, no spaces) so the field's displayed value is
// always exactly the candidate that would be submitted, then debounces a
// live availability check via checkHandleAvailability — the same "plain
// server action called directly from a client component" pattern
// AreaPicker already uses for requestMissingArea. This is UX ONLY: the
// real uniqueness guarantee is the handles table's own unique index,
// re-checked atomically on submit regardless of what this field last
// reported (see each entity's own claim action).
import { useEffect, useRef, useState } from "react";
import { checkHandleAvailability, type HandleAvailability } from "@/app/(public)/actions/handle-availability";
import type { HandleEntityType } from "@/lib/handles";
import { siteConfig } from "@/lib/site-config";

const ALLOWED_CHARS = /[^a-z0-9_]/g;
const DEBOUNCE_MS = 400;
const MIN_LENGTH = 3;

/** Lowercases and strips anything outside a-z0-9_ on every keystroke —
 * never silently reinterprets punctuation into something else, it just
 * removes what isn't allowed, so the field always shows exactly the
 * candidate username. */
function sanitize(raw: string): string {
  return raw.toLowerCase().replace(ALLOWED_CHARS, "");
}

export default function UsernameField({
  name,
  defaultValue,
  current,
  autoFocus,
}: {
  name: string;
  defaultValue?: string | null;
  /** The entity already holding this field's CURRENT value, if any — lets
   * the availability check report "available" for a value that's already
   * this entity's own handle, instead of a confusing "taken". Omit for a
   * brand-new claim (Person or a not-yet-handled entity). */
  current?: { entityType: HandleEntityType; entityId: string };
  autoFocus?: boolean;
}) {
  const [value, setValue] = useState(defaultValue ?? "");
  const [result, setResult] = useState<HandleAvailability | null>(null);
  const [checking, setChecking] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    if (value.length < MIN_LENGTH) {
      setResult(null);
      setChecking(false);
      return;
    }
    setChecking(true);
    const id = ++requestId.current;
    const timer = setTimeout(() => {
      checkHandleAvailability(value, current).then((res) => {
        if (requestId.current === id) {
          setResult(res);
          setChecking(false);
        }
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const statusColor =
    result?.status === "available" ? "text-findmi-700" : result?.status && result.status !== "unknown" ? "text-red-600" : "text-ink/40";

  return (
    <div>
      <div className="flex items-center gap-1.5 rounded-xl border border-black/10 bg-white px-3.5 py-2.5 focus-within:border-ink/30">
        <span className="shrink-0 text-sm text-ink/40">{siteConfig.domain}/</span>
        <input
          type="text"
          name={name}
          value={value}
          onChange={(e) => setValue(sanitize(e.target.value))}
          placeholder="yourbusiness"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          autoComplete="off"
          autoFocus={autoFocus}
          minLength={MIN_LENGTH}
          maxLength={20}
          className="w-full min-w-0 flex-1 border-0 bg-transparent p-0 text-base text-ink placeholder:text-ink/30 focus:outline-none focus:ring-0"
        />
      </div>
      <p className={`mt-1.5 text-xs font-medium ${statusColor}`}>
        {value.length === 0
          ? "Choose a username — this becomes your Findmi URL."
          : value.length < MIN_LENGTH
            ? `At least ${MIN_LENGTH} characters.`
            : checking
              ? "Checking…"
              : result
                ? result.status === "available"
                  ? `✓ ${result.message}`
                  : result.message
                : ""}
      </p>
    </div>
  );
}
