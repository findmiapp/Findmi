import Link from "next/link";

export default function Logo({ className = "" }: { className?: string }) {
  return (
    <Link
      href="/"
      className={`text-xl font-semibold tracking-tight text-ink ${className}`}
    >
      Findmi
    </Link>
  );
}
