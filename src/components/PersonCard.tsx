import type { Person } from "@/lib/types";
import PostCard from "./PostCard";

export default function PersonCard({ person, role }: { person: Person; role?: string | null }) {
  return (
    <PostCard
      href={`/people/${person.slug}`}
      image={person.image_url}
      kind="person"
      badgeLabel={role ?? "FindMi"}
      title={person.name}
      metaLines={person.location ? [{ icon: "pin", text: person.location }] : []}
      excerpt={person.short_bio}
      cta="View Profile"
    />
  );
}
