import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-start px-6 py-24">
      <p className="text-sm font-semibold text-findmi-600">404</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">
        We couldn&rsquo;t find that.
      </h1>
      <p className="mt-3 text-sm text-ink/60">
        The page you&rsquo;re looking for doesn&rsquo;t exist or may have moved.
      </p>
      <Link
        href="/"
        className="mt-6 rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-findmi-600"
      >
        Back to Findmi
      </Link>
    </div>
  );
}
