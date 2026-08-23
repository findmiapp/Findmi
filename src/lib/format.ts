export function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatDateRange(startIso: string, endIso?: string | null): string {
  const start = formatDateShort(startIso);
  const startTime = formatTime(startIso);
  if (!endIso) return `${start} · ${startTime}`;

  const sameDay = new Date(startIso).toDateString() === new Date(endIso).toDateString();
  if (sameDay) {
    return `${start} · ${startTime}–${formatTime(endIso)}`;
  }
  return `${start} – ${formatDateShort(endIso)}`;
}

export function cityState(city?: string | null, state?: string | null): string {
  return [city, state].filter(Boolean).join(", ");
}

export function formatPrice(price: number | null, label: string | null): string {
  if (label) return label;
  if (price == null) return "";
  return `$${price.toFixed(2)}`;
}
