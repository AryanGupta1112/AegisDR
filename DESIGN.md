# AegisDR design system

## Current interface (16 October 2026)

The user's new direction supersedes the earlier blue glass palette: black, white and neutral gray in both appearances. No colored status dots or chart accents. Status meaning uses readable words and differing marker shapes. Home, My apps, Restore, and Practice recovery replace specialist navigation labels. RPO and RTO are explained as maximum data age and target restore time.

Screen entries use a 180 ms opacity/transform transition; dialogs use a 200 ms entry and 120 ms exit, and the mobile drawer uses 240 ms. Live tables do not animate during data refresh. Both device reduced-motion preferences and the saved Reduce movement choice disable movement. Display preferences persist locally; live operational data stays in memory, is refreshed from the server, and is never persisted in browser storage. Hashed static assets can be cached indefinitely; API responses cannot.

The earlier design notes below describe the original implementation only.
The user's pinned glass dashboard direction governs this Operate surface. Build directly from the explicit brief without interrupting autonomous implementation for a design interview.

Cool midnight ink, glacial blue highlights, restrained teal for verified outcomes, amber for unavailable infrastructure. Frosted navigation overlays a quiet atmospheric background. Dense, legible operational tables anchor the interface. Display typography uses self-hosted Manrope with tabular operational numerals. Sidebar collapses on desktop and becomes a drawer on mobile. Focus rings and reduced-motion support are mandatory. No invented history or optimistic health badges.

The first viewport prioritizes backup coverage and the latest actual recovery point, then execution history, then environmental readiness. Recovery confirmation names the exact application and overwrite scope. Status changes persist in row identity and are announced through an accessible notification region.
