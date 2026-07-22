# 经营地图星图化 Design QA

## Evidence

- source visual truth: `/Users/fancy/Documents/YiRan/Knowledge-Graph/other/经营地图V3设计方案/星图风格无底图/00-star-mode-reference.png`
- implementation screenshot: `/Users/fancy/Documents/YiRan/Knowledge-Graph/other/经营地图V3设计方案/星图风格无底图/02-starfield-map-skill-selected.png`
- combined comparison: `/Users/fancy/Documents/YiRan/Knowledge-Graph/other/经营地图V3设计方案/星图风格无底图/03-star-reference-vs-implementation.png`
- light theme screenshot: `/Users/fancy/Documents/YiRan/Knowledge-Graph/other/经营地图V3设计方案/星图风格无底图/04-light-theme-map.png`
- dark theme screenshot: `/Users/fancy/Documents/YiRan/Knowledge-Graph/other/经营地图V3设计方案/星图风格无底图/05-dark-theme-map.png`
- theme comparison: `/Users/fancy/Documents/YiRan/Knowledge-Graph/other/经营地图V3设计方案/星图风格无底图/06-light-dark-theme-comparison.png`
- route/state: `http://localhost:5173/home`, 经营地图，技能节点选中
- viewport: 2560 × 1232 CSS px
- density: devicePixelRatio 1
- source pixels: 2560 × 1232
- implementation pixels: 2560 × 1232
- normalization: same viewport, same browser chrome, same density; comparison image scales both captures equally to 1280 × 616 before placing them side by side.

## Full-view comparison

The implementation intentionally converts Star Mode's pale canvas into the dark variant requested by the user. It preserves the structural visual language: concentric orbital rings, sparse star points, center-led hierarchy, radial group placement, faint constellation connections, and a selected-path glow. The former garden/road background is no longer rendered. The 13 supplied building/module PNG assets remain the primary node visuals.

## Focused-region comparison

The selected Skill state was inspected at full browser resolution because it simultaneously exposes the module image, selected label, highlighted route, stage relationship, and right-side detail panel. All supplied node images report matching source and rendered aspect ratios (source assets are 1:1; rendered width equals rendered height), so no UI image is stretched.

## Required fidelity surfaces

- Fonts and typography: compact hierarchy retained; title and labels use existing Inter/PingFang/Microsoft YaHei stack. Small labels remain readable without returning to the previously oversized map typography.
- Spacing and layout rhythm: nodes are distributed on outer and inner orbits with clear center, LOOP stages, modules, and two bases. The map occupies the full remaining work area without a white poster frame.
- Colors and visual tokens: white canvas is intentionally replaced by deep navy, blue-violet orbit lines, cyan star points, and blue selected-state glow. Right detail panel and mode switch share the same dark token family.
- Image quality and asset fidelity: all original business-map PNGs are retained; no building/module was replaced with CSS art, SVG, emoji, or placeholder. Transparent edges remain sharp on the dark field.
- Copy and content: title, LOOP stages, module names, capabilities, current path, related modules, and CTA copy are preserved.

## Comparison history

### Pass 1

- [P2] Node containers could make differently weighted assets look squeezed.
  - Fix: removed forced square sizing behavior from node images and now render each PNG at width 100% with automatic natural height.
  - Post-fix evidence: `02-starfield-map-skill-selected.png`; browser metrics confirm every rendered image preserves its natural ratio.

### Pass 2

- No actionable P0/P1/P2 visual findings remain.

### Pass 3 — theme adaptation

- [P1] The operating map was initially locked to the dark palette and did not follow the app theme.
  - Fix: passed the global visualization theme into `OperatingMapV2`; introduced paired light/dark surface, label, panel, route, starfield, orbit, and toolbar tokens.
  - Post-fix evidence: `04-light-theme-map.png`, `05-dark-theme-map.png`, and `06-light-dark-theme-comparison.png`.
- No actionable P0/P1/P2 visual findings remain after the theme switch test.

## Interaction and runtime checks

- Mode switch: Star Mode → Operating Map works.
- App theme switch: Light → Dark updates the page class, map class, Canvas drawing, labels, route styling, toolbar, and detail rail without reloading the route.
- Node interaction: selecting Skill updates the selected label, route highlight, detail title, capability list, related modules, and CTA.
- Console: no browser console errors.
- Production bundling: `npx vite build` passed.
- Repository-wide `npm run build` remains blocked by pre-existing TypeScript errors in `AppLayout.tsx`, `LoopsDiyCanvas.tsx`, and duplicate `disabled` in `Accounts.tsx`; none are introduced by this map change.

## Findings

- No actionable P0/P1/P2 findings.

## Follow-up polish

- P3: route glow strength can be tuned after the user views it on their usual monitor.

final result: passed
