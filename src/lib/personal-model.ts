// Findmi's consumer mental model — one place, pure (client + server + tests).
//
//   RELATIONSHIP = what this thing means to me (system-defined, per type).
//   COLLECTION   = how I organize it (user-named, optional, any type).
//
// The two are independent: adding to a Collection never sets a relationship
// and setting/removing a relationship never touches Collection membership.
//
// Per entity type, the relationships a detail page offers:
//   Product   Want (product_wants — owned by ProductWantButton, never here)
//             and Have
//   Event     Want To Do, Been ("Going" has no stored relation yet)
//   Location  Want To Go, Been
//   Business  Follow (account_followed_* — owned by the Follow control)
// Generic Save is NOT a primary action on any of these four. Legacy Saves
// (account_saved_* rows, device-local saves) are kept untouched and stay
// visible in Your Library's "Saved" view; Moments / other content may keep Save.

import type { Relationship } from "./discovery/relationships";
import type { CollectionEntityType } from "./collections-domain";

export interface PersonalRelationAction {
  relation: Relationship;
  label: string;
  activeLabel: string;
}

/** Relationship toggles a detail page renders through RelationshipButton
 * (user_entity_relationships). Product Want and Business Follow are handled
 * by their own dedicated controls and are deliberately absent. */
export const PERSONAL_RELATION_ACTIONS: Record<CollectionEntityType, readonly PersonalRelationAction[]> = {
  product: [{ relation: "have", label: "I Have This", activeLabel: "You Have This" }],
  event: [
    { relation: "want", label: "Want To Do", activeLabel: "Want To Do ✓" },
    { relation: "been", label: "Been", activeLabel: "Been ✓" },
  ],
  location: [
    { relation: "want", label: "Want To Go", activeLabel: "Want To Go ✓" },
    { relation: "been", label: "Been Here", activeLabel: "Been Here ✓" },
  ],
  business: [],
};

/** The personal destination's display name (route stays /account/saved).
 * Not "Your Findmi": that is already the account menu's SECTION heading
 * (NavDesktop / HamburgerMenu) that this item sits inside. */
export const PERSONAL_DESTINATION_NAME = "Your Library";
