"use client";

import { useEffect, useRef, useState } from "react";
import SupabaseImage from "@/components/SupabaseImage";

// Rounded, image-first media slot. A missing or failed image falls back to
// a calm tonal field (seeded by the title, so it's stable per item) rather
// than a broken icon or a grey box.

const TONES = [
  "from-[#EDE7DF] to-[#D9CFC2]",
  "from-[#E3E8E4] to-[#C9D3CC]",
  "from-[#E6E4EC] to-[#CFCADB]",
  "from-[#EAE3E0] to-[#D6C7C1]",
  "from-[#E1E6EA] to-[#C6D0D8]",
];

function tone(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return TONES[h % TONES.length];
}

export default function JcMedia({
  src,
  alt,
  sizes,
  className = "",
  priority = false,
  rounded = "rounded-2xl",
}: {
  src: string | null;
  alt: string;
  sizes: string;
  className?: string;
  priority?: boolean;
  rounded?: string;
}) {
  const [failed, setFailed] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  // An image that already failed before hydration never fires onError —
  // catch that case once mounted.
  useEffect(() => {
    const img = box.current?.querySelector("img");
    if (img && img.complete && img.naturalWidth === 0) setFailed(true);
  }, [src]);
  const showImage = !!src && !failed;
  return (
    <div ref={box} className={`relative overflow-hidden bg-neutral-100 ${rounded} ${className}`}>
      {showImage ? (
        <SupabaseImage src={src} alt={alt} fill sizes={sizes} priority={priority} className="object-cover" onError={() => setFailed(true)} />
      ) : (
        <div aria-hidden className={`absolute inset-0 bg-gradient-to-br ${tone(alt)}`}>
          <span className="absolute left-3 top-3 text-[44px] font-semibold leading-none tracking-[-0.04em] text-black/[0.08]">
            {alt.trim().charAt(0)}
          </span>
        </div>
      )}
    </div>
  );
}
