import SupabaseImage from "@/components/SupabaseImage";
import type { PublicProfile } from "@/lib/types";

// User Identity + Follow Foundation pass — extracted from /user/[username]
// (unchanged markup) so the FindMi Global Handle Registry pass's root
// /[username] vanity route can render the exact same Person view instead
// of forking a second copy. Reads only PublicProfile's own columns — see
// lib/profiles.ts's own note on why that's the complete privacy boundary
// (no email/phone/auth id/owned-business internals ever reach this far).
export default function PublicProfileView({ profile }: { profile: PublicProfile }) {
  return (
    <div className="mx-auto max-w-xl px-6 py-12">
      <div className="flex items-center gap-4">
        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-full bg-mist">
          {profile.avatar_url && (
            <SupabaseImage src={profile.avatar_url} alt={profile.display_name ?? profile.username} fill sizes="80px" className="object-cover" />
          )}
        </div>
        <div className="min-w-0">
          {profile.display_name && (
            <h1 className="truncate font-display text-xl font-bold tracking-tight text-ink">{profile.display_name}</h1>
          )}
          <p className="truncate text-sm text-ink/50">@{profile.username}</p>
        </div>
      </div>

      {profile.bio && <p className="mt-4 text-sm text-ink/70">{profile.bio}</p>}
      {profile.location_label && <p className="mt-2 text-xs text-ink/45">{profile.location_label}</p>}
    </div>
  );
}
