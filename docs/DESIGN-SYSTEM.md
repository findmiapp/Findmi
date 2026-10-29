# Design System and UX Conventions

The locked brand rules (Findmi name, Aqua `#14B0BC`, Inter, Title Case, no
lime/purple) live in `/CLAUDE.md` §5 and aren't repeated here. Before
styling, read `tailwind.config.ts`, `src/app/globals.css` and the
component's current classes.

## Durable patterns

- **Mobile-first, app-like.** QA at 360 / 390 / 412px. No horizontal page
  scroll. Use `touch-action: pan-y` on horizontally swipeable surfaces.
- **Horizontal rails** are the main discovery pattern (Home lanes, Coming
  Up, Create & Manage, Moments category rail). Don't swap them for another
  pattern without understanding the discovery model behind them.
- **Board swipe.** Swiping the Moments feed surface moves to the adjacent
  category (`components/moments/useBoardSwipe.ts`). This means the whole
  content view, not just the chip rail. Only a completed, dominantly
  horizontal swipe counts. Cards are never swiped away.
- **Bottom sheets** (`BottomSheet`, `SaveOrganizeSheet`) for intentional
  choices such as Mark As or Add to Collection, instead of exposing chip
  fields up front.
- **Skeletons over blank transitions.** Keep the shell mounted. Show the
  destination skeleton when entering a new view, and keep the current view
  when moving within one (`v2/OptimisticTabs`, `ManagerSkeleton`).
- **Square profile imagery** for entity avatars. [VERIFY] consistency.
- **Moments media**: multi-photo, mixed-aspect carousel with constrained
  height and the left gutter kept. Pixel values are history, not law.
- **Business Manager** is an operational console: dense, compact landscape
  cards, a sticky section rail. It should look related to Findmi, not like
  a generic SaaS template.
- **Input capitalization** helpers (`lib/input-capitalization.ts`) for
  entity-name fields.
- Map: MapLibre with a keyless OpenFreeMap "positron" default
  (`NEXT_PUBLIC_MAP_STYLE_URL`). The Map lens/filter model is canonical
  (`CONSUMER-EXPERIENCE.md` § Map lenses and filters). Map visual polish
  is still in QA.

## Rejected — don't reintroduce

| Pattern | Notes |
| --- | --- |
| `#C6FF00` / lime / purple SaaS styling | Locked rejection |
| Space Grotesk, Plus Jakarta Sans | Read as "tech/SaaS" |
| "My World" | Retired. Use My Journal / My Moments |
| Random brand logo row on Home | Disliked in consumer QA |
| Ambiguous "Recent Moments" as a generic Home section | Purpose unclear. "Your Recent Moments" on Account Home and "Recent Moments Here" on the map are scoped and fine |
| Oversized Take Photo / Choose From Photos controls | Rejected. Any redesign must keep photo grouping, reordering and organization |
| "Public Actions" as a prominent editor tab | Now "Profile Buttons", last tab |
| "Coming Up" for followed content in consumer context | Use "Upcoming Events · From Pages You Follow" |
| Flower icon for manager navigation | Rejected. Performance uses a chart icon |
| Chip-rail-only swipe for Moments | Doesn't satisfy board swipe |
| Standalone Needs Attention row/nav | It's a badge inside Inbox / Follow-Ups |
| Homepage Map button next to Search | Experiment cancelled (`1c34590`) |
