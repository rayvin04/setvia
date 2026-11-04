# Landing page design QA

## Selected direction

- Event section: coastal plan scene with four distinct role cats and a working sample decision receipt.
- Closing CTA: the mascot team illustration, “Make the next message move things forward,” and Start planning / Explore demos actions.
- Footer: expanded transparency and project links, with “Make plans that survive the group chat.” as the headline.

## Visual review

- Desktop event capture: 1440 px wide; the title wraps to two lines, the proposal card stays centered, and all four role captions and thoughts remain visible.
- Mobile event capture: 390 px wide; the role cards stack in two columns above the receipt.
- Mobile CTA and footer captures: 390 px wide; the mascot image, calls to action, transparency notes and links remain visible.
- Page width check: no horizontal overflow at 390 px or 360 px.
- Screenshots are saved under `C:\Users\Rayvin Gianan\.codex\visualizations\2026\11\04\01a1a50a-5f36-7db0-9040-2cd749fa3c68\setvia-review`.

## Behavior and checks

- Changed the sample departure from 7:00 AM to 8:30 AM, added a sample approval, reset to the original votes, and opened the change details.
- Privacy policy link opens `/privacy`.
- No browser page errors during the responsive pass. The homepage Run action was not triggered, so no model request was made.
- `npm run build` passed.
- `npx tsx --test client/frontend-preview.test.ts` passed (7 tests).
- `git diff --check` passed.

This review uses the local Vite preview. No production deployment was triggered.
