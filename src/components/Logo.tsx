import Image from "next/image";
import Link from "next/link";

// Native size is 1189x484 (~2.457:1). Sized here so it reads clearly at
// header height without ever upscaling the source asset.
const LOCKUP_RATIO = 1189 / 484;

export default function Logo({
  className = "",
  heightClassName = "h-8",
}: {
  className?: string;
  heightClassName?: string;
}) {
  return (
    <Link href="/" className={`flex shrink-0 items-center ${className}`}>
      <Image
        src="/logo-lockup.png"
        alt="FindMi"
        width={Math.round(484 * LOCKUP_RATIO)}
        height={484}
        priority
        className={`w-auto ${heightClassName}`}
      />
    </Link>
  );
}
