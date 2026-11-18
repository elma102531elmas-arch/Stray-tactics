# 📱 My Phone Factory

A deep, mobile-first smartphone-empire simulator. You start in January 2010 with
$75,000, two inexperienced engineers and one assembly workstation, and try to grow
into a global phone maker — without going bankrupt on the way.

**Play:** open [`../my-phone-factory.html`](../my-phone-factory.html) in any modern browser
(phone or PC). It is a single self-contained file; progress autosaves in the browser.

## What's in the game

- **Company setup** — name & logo, HQ country (wages, taxes, supply chain, investors differ),
  first market, strategy, starting category, research specialization, difficulty.
- **Research (100+ technologies)** — displays, batteries, cameras, materials, memory,
  CPU/GPU/NPU/ISP/modem generations, process nodes 90nm → 1nm, assembly automation,
  quality control, own OS, app store, AI. Researching ahead of the industry costs far more.
- **Chip engineering** — design your own SoC: architecture (licensed or custom), core counts,
  clocks, caches, GPU, AI engine, ISP, integrated modem, memory controller, foundry & node.
  The model computes transistor count, die area, dies per wafer, defect density, yield,
  unit cost, performance and power. Tape-out costs real money; first silicon can have bugs.
  Build your own fabs and sell spare capacity as a foundry.
- **Phone designer** — chipset, RAM type/capacity/bus, storage, display panel/size/resolution/
  refresh/bezels, battery chemistry/capacity/charging, cameras, materials, water resistance,
  biometrics, cooling, OS. Every choice changes cost, size, weight, heat, battery life and quality.
- **Test lab** — an interactive phone simulator with a benchmark, a 20-minute thermal gaming
  test, a camera, a battery drain test and more — all driven by the same physics model.
- **Manufacturing** — workstations → plants → factories → mega campuses, production plans,
  defect rates, OEM assembly and engineering-consulting contracts.
- **Markets** — 8 regions, retail and carrier channels, marketing, 7 rival brands that launch
  new models every year, react to your hits, and can die. Buyers compare every phone on sale.
- **Finance** — P&L, loans, angel → Series D → IPO, stock price, patents & lawsuits, random
  world events (chip shortage, pandemic, trade war). Two months of unpaid bills = bankruptcy.
- **Launch events** — plan the venue, city, stage, streaming, ads, invitations, guests,
  lighting, music, effects, rehearsals and trailer; then walk your CEO across a live 3D stage.
  Reveal the phone, show specs, compare with rivals, run live benchmarks, gaming, camera and
  battery demos (they can fail — overheating, 18 FPS, crashing camera), reveal the price, and
  pull off "one more thing". The crowd, social feed, press headlines, reviews, YouTube
  videos, comments and preorders all react to what actually happened. Watch full replays.

## Development

Sources live in `src/` and load directly from `index.html` (open it in a browser to develop).
To produce the single-file build:

```
node build.js   # writes ../my-phone-factory.html
```

| File | Contents |
| --- | --- |
| `src/data.js` | Countries, regions, nodes, chip IP, components, tech tree, rivals |
| `src/models.js` | Chip physics, phone stats, quality, thermal/FPS/battery/camera tests |
| `src/sim.js` | Game state and the monthly simulation |
| `src/ui.js`, `src/screens.js` | App shell, setup, HQ/R&D/Factory/Market/Finance/Team |
| `src/design.js`, `src/phonesim.js` | Phone & chip designers, phone renderer, test lab |
| `src/event.js`, `src/keynote.js`, `src/media.js` | Launch planning, live keynote & replay, reviews |
