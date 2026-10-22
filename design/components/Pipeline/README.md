The pipeline tracks jobs from saved to closed. Columns: Saved, Applied, Interviewing, Offer, Closed (`STATUS_LABEL` in `packages/core/src/next-steps.ts`; the stored status of the last one is `rejected`, however the job ended).

## Use
The board is `apps/web/src/components/Pipeline.tsx`, built with Tailwind on the tokens. The `rj-board`, `rj-column` and `rj-card` classes in `bundle.css` and `preview.html` are the reference for its look; the app doesn't use them.
- Each column is a `<section>` labelled by its `<h2>` (name and count), on an inset ground framed in `border-default`, holding a `<ul>` of cards. On wide screens the five columns sit side by side (each at least 220px) and scroll sideways inside the board; on phones one column shows at a time, picked with a row of chips that carry the counts.
- A card is an `<li>` on `bg-raised` with `shadow-l1` (`shadow-l2` on hover). It shows a dot for its state, the title (`small`, semibold), the company (with "Closed", "Added by you" or "No longer listed" when that applies), the last activity with its channel icon, a next-step chip and the next interview when there is one, a Move menu, and how long it has been in this column.
- Closed shows its first three cards and a "Show N more" button.

## Rules
- The card's title is a real button that opens the job, described by a hidden instruction: "Press [ or ] to move this job to the previous or next stage." Clicking anywhere else on the card opens it too.
- Drag a card with the pointer, focus its title and press `[` / `]` to move it one column, or use its Move menu (which also has "Remove from the board"). Announce the move in a polite live region ("Moved <title> to Applied"). The column under a dragged card is outlined in `text-primary` on `bg-active`.
- Moving a card to Closed first asks "How did it end?".
- The next-step chip is always a word, never color alone.
- Columns scroll sideways inside the board; the page never does.
