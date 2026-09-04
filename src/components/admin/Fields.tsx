// Plain server-renderable form field primitives for the admin. Native
// browser inputs + Server Actions do all the work — no client-side form
// library needed. Consistent full-width, mobile-friendly sizing (text-base
// avoids iOS Safari auto-zoom on focus) and human-language labels.

const inputClass =
  "w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none disabled:bg-black/[0.03] disabled:text-ink/40";

function Wrap({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink/45">{hint}</span>}
    </label>
  );
}

export function TextField({
  label,
  name,
  defaultValue,
  placeholder,
  required,
  hint,
  type = "text",
}: {
  label: string;
  name: string;
  defaultValue?: string | number | null;
  placeholder?: string;
  required?: boolean;
  hint?: string;
  type?: "text" | "email" | "tel" | "url" | "password" | "date";
}) {
  return (
    <Wrap label={label} hint={hint}>
      <input
        type={type}
        name={name}
        defaultValue={defaultValue ?? ""}
        placeholder={placeholder}
        required={required}
        className={inputClass}
      />
    </Wrap>
  );
}

export function NumberField({
  label,
  name,
  defaultValue,
  step = "any",
  hint,
}: {
  label: string;
  name: string;
  defaultValue?: number | null;
  step?: string;
  hint?: string;
}) {
  return (
    <Wrap label={label} hint={hint}>
      <input
        type="number"
        step={step}
        name={name}
        defaultValue={defaultValue ?? ""}
        className={inputClass}
      />
    </Wrap>
  );
}

export function DateTimeField({
  label,
  name,
  defaultValue,
  required,
  hint,
}: {
  label: string;
  name: string;
  /** Already in "YYYY-MM-DDTHH:mm" form (see lib/admin/form-helpers'
   * isoToLocalDateTime) — this component doesn't do ISO conversion itself,
   * so the same value round-trips through localDateTimeToIso on submit. */
  defaultValue?: string | null;
  required?: boolean;
  hint?: string;
}) {
  return (
    <Wrap label={label} hint={hint}>
      <input
        type="datetime-local"
        name={name}
        defaultValue={defaultValue ?? ""}
        required={required}
        className={inputClass}
      />
    </Wrap>
  );
}

export function TextareaField({
  label,
  name,
  defaultValue,
  rows = 4,
  hint,
}: {
  label: string;
  name: string;
  defaultValue?: string | null;
  rows?: number;
  hint?: string;
}) {
  return (
    <Wrap label={label} hint={hint}>
      <textarea
        name={name}
        defaultValue={defaultValue ?? ""}
        rows={rows}
        className={`${inputClass} resize-y`}
      />
    </Wrap>
  );
}

export function SelectField({
  label,
  name,
  defaultValue,
  options,
  hint,
}: {
  label: string;
  name: string;
  defaultValue?: string | null;
  options: { value: string; label: string }[];
  hint?: string;
}) {
  return (
    <Wrap label={label} hint={hint}>
      <select name={name} defaultValue={defaultValue ?? ""} className={inputClass}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Wrap>
  );
}

export function CheckboxField({
  label,
  name,
  defaultChecked,
  hint,
}: {
  label: string;
  name: string;
  defaultChecked?: boolean;
  hint?: string;
}) {
  return (
    <label className="flex items-start gap-3 rounded-xl border border-black/10 bg-white px-3.5 py-3">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="mt-0.5 h-5 w-5 shrink-0 accent-findmi"
      />
      <span>
        <span className="block text-sm font-medium text-ink">{label}</span>
        {hint && <span className="block text-xs text-ink/45">{hint}</span>}
      </span>
    </label>
  );
}

/** A scrollable checklist of checkboxes sharing one field name — used for
 * "which businesses are in this event" style multi-select. Each checked
 * value posts under `name` (read via formData.getAll(name)). */
export function CheckboxList({
  label,
  name,
  options,
  defaultSelected,
  emptyText,
}: {
  label: string;
  name: string;
  options: { value: string; label: string; sublabel?: string }[];
  defaultSelected: string[];
  emptyText?: string;
}) {
  const selected = new Set(defaultSelected);
  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium text-ink">{label}</span>
      {options.length === 0 ? (
        <p className="text-sm text-ink/45">{emptyText ?? "Nothing to choose from yet."}</p>
      ) : (
        <div className="max-h-64 overflow-y-auto rounded-xl border border-black/10 bg-white p-1.5">
          {options.map((o) => (
            <label
              key={o.value}
              className="flex items-center gap-3 rounded-lg px-2.5 py-2.5 hover:bg-black/[0.02]"
            >
              <input
                type="checkbox"
                name={name}
                value={o.value}
                defaultChecked={selected.has(o.value)}
                className="h-5 w-5 shrink-0 accent-findmi"
              />
              <span className="min-w-0">
                <span className="block truncate text-sm text-ink">{o.label}</span>
                {o.sublabel && (
                  <span className="block truncate text-xs text-ink/45">{o.sublabel}</span>
                )}
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
