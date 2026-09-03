# virtual-office-ui

A "digital twin" floor view for Your Office — inspired by openclaw-office
(MIT, WW-AI-Lab), freshly implemented for a-coder-cli's engine contract.

One SVG scene: desk rows, meeting pods, lounge decor, walk animations,
collaboration links between coworkers who talk to each other, speech bubbles
with live activity, and status auras (thinking / tool calling).

## Layout

- `src/types.ts` — the feed contract (`VirtualOfficeFeed`) the host provides
- `src/geometry.ts` — zones, desk slots, meeting seats, walk paths (pure)
- `src/store.ts` — zustand store: derives status/bubbles/links from the feed,
  animates walks with a single rAF loop
- `src/avatar.tsx` — procedural SVG faces from the engine's Face model
  (shape + color, user uploads override) with status-driven features
- `src/VirtualOffice.tsx` — the 2D scene (zones, furniture, links, avatars)
- `src/furniture2d.tsx` — SVG furniture pieces
- `src/palette.ts` — themes + status hues shared by both views
- `src/office3d.tsx` — the 3D scene (three + @react-three/fiber, no drei):
  capsule characters with walk bob and status auras, emissive monitors,
  windowed walls, canvas-texture labels, drag/zoom orbit camera
- `src/OfficeView.tsx` — 2D/3D switcher (3D is lazy-loaded)
- `src/mock.ts` — mock scenario + loop for standalone development
- `src/dev-main.tsx` + `index.html` + `vite.config.ts` — standalone dev harness

## Run standalone

```sh
cd virtual-office-ui
npm install --ignore-scripts
npm run dev          # http://localhost:1425 — mock office day on a loop
```

## Views

`<OfficeView feed theme />` renders a segmented 2D/3D toggle; `3D` code-splits
so three.js only loads when chosen. `<VirtualOffice>` (2D) and `<Office3D>` are
also exported standalone.

## Embed (desktop)

```tsx
import { VirtualOffice, type VirtualOfficeFeed } from "../../virtual-office-ui/src";

<VirtualOffice feed={feed} theme={theme} />;
```

The feed maps from office RPC state:

- `coworkers` — roster snapshot entries (id/name/handle/title/face)
- `activity` — recent `office_activity` events (ascending)
- `roomLog` — the selected huddle's log
- `roomRunning` / `roomMembers` — the huddle's drive state and members
- `roomName` — banner label while a drive runs

Engine side: `office_activity` events (turn lifecycle, tool calls, completed
speech) are emitted by the office service and pushed over RPC.