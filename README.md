# ⬡ EF2 Relic Forge Advisor

> **Interactive Strategy Solver & Board Optimizer for the Endless Frontier 2 Relic Forge**

[![Vite](https://img.shields.io/badge/Vite-6.0-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![React](https://img.shields.io/badge/React-18.3-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-3.4-38B2AC?logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![Vitest](https://img.shields.io/badge/Tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

---

## 📖 Overview

**EF2 Relic Forge Advisor** is a high-performance web application designed to help *Endless Frontier 2* players master the Relic Forge mini-game. It models authentic hexagonal board layouts, polyomino piece geometry, cascading merge rules, and lookahead solver algorithms to calculate optimal tile placements in real time (<150ms).

---

## ✨ Features

- **⬡ Authentic Honeycomb Board Layouts**
  - Staggered column coordinate system (even/odd offset grid) matching the in-game forge.
  - Supports both **23-cell Standard** (E1 and E5 locked) and **25-cell Unlocked** board modes.
  - Interactive cell editor with paintbrush star assignment (1★–10★), eraser, and cell inspector.

- **🔄 Polyomino Piece Composer with 60° Hexagonal Rotation**
  - Supports all piece shapes: `1-Tile (Single)`, `2-Pair`, `3-Line`, `3-Chevron (^)`, `3-Bent (L)`, and `3-Triangle Cluster`.
  - True cube coordinate vector rotation ($x' = -z, y' = -x, z' = -y$) across all 6 orientations (0° to 300°).
  - Configurable Current Piece and Next Piece with independent star levels.

- **⚡ Fast, Comprehensive Solver Engine (<150ms)**
  - Exhaustive search of all valid board positions across all 6 rotations.
  - Rotation-invariant deduplication prioritizing the least rotation clicks from your composer.
  - Multi-tier chain cascade simulation (2★ → 3★ → 4★ → ...).
  - Authentic multi-tile landing rules & 5-tile super-merge (+2★ jump) support.
  - 2-Ply lookahead continuation when the Next Piece is enabled.

- **🛡️ Straggler Protection & Trap Detection**
  - Simulates spawn retirement windows (e.g. retiring 1★ upon 5★ unlock, retiring 2★ upon 6★ unlock).
  - Flags dangerous moves that trap low-tier tiles as permanent dead space on the board.
  - Recommends proactive bridge builds and rescues for stranded tiles.

- **🎬 Video Scenario Presets**
  - Preloaded with authentic gameplay scenarios (e.g. 00:00 Opening 4★ Merge, 00:13 Double Cascade Chain, 00:32 6★ Unlock + Straggler Rescue).

- **🔗 Shareable State & History**
  - Base64 URL hash serialization (`#...`) to share any board configuration.
  - Full Undo / Redo history stack (up to 50 actions).

---

## 🛠️ Tech Stack

- **Framework:** [React 18](https://react.dev/) + [Vite 6](https://vitejs.dev/)
- **Language:** [TypeScript](https://www.typescriptlang.org/) (Strict Mode)
- **Styling:** [Tailwind CSS 3](https://tailwindcss.com/)
- **Icons:** [Lucide React](https://lucide.dev/)
- **Testing:** [Vitest](https://vitest.dev/)

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (version 18 or higher recommended)
- [npm](https://www.npmjs.com/) (or pnpm / yarn)

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/<your-username>/EF2-Relic-Forge-Assist.git
   cd EF2-Relic-Forge-Assist
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the local development server:
   ```bash
   npm run dev
   ```

4. Open your browser to the local address (typically `http://localhost:5173`).

---

## 🧪 Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Starts the Vite development server with Hot Module Replacement (HMR). |
| `npm run build` | Type-checks with TypeScript and compiles the production bundle to `dist/`. |
| `npm run preview` | Previews the production build locally. |
| `npm test` | Runs the Vitest test suite. |

---

## 📂 Project Structure

```text
EF2-Relic-Forge-Assist/
├── src/
│   ├── components/            # UI Components
│   │   ├── HoneycombBoard.tsx       # Hexagonal SVG board rendering & ghost overlays
│   │   ├── PieceComposer.tsx        # Piece shape selector, rotation wheel & star picker
│   │   ├── RecommendationsPanel.tsx # Ranked move list, cascade details & ply-2 preview
│   │   ├── RelicTileVisual.tsx      # Authentic relic icon styling & star badges
│   │   └── TopProgressionHeader.tsx # Board mode toggle, spawn pool & preset scenario selector
│   ├── domain/                # Game Logic & Math
│   │   ├── constants.ts             # Relic tier data, piece shapes & spawn pool rules
│   │   ├── honeycomb.ts             # Cube coordinates, 6-neighbor adjacency & axial math
│   │   ├── presets.ts               # Scenario configurations & URL hash encoder/decoder
│   │   ├── simulator.ts             # Cascade merges, super-merges & mobility analysis
│   │   ├── solver.ts                # Ranked scoring heuristic & 2-ply lookahead engine
│   │   └── solver.test.ts           # Vitest verification suite
│   ├── types/
│   │   └── forge.ts                 # Domain type definitions & interfaces
│   ├── App.tsx                # Main application state orchestration
│   ├── index.css              # Global styles & Tailwind directives
│   └── main.tsx               # Application entrypoint
├── index.html
├── package.json
├── tailwind.config.js
├── tsconfig.json
└── vite.config.ts
```

---

## 🤝 Contributing

Contributions, bug reports, and feature suggestions are welcome!

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📄 License

Distributed under the MIT License. See [`LICENSE`](./LICENSE) for more information.
