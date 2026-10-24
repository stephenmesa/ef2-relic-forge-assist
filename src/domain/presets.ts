import { BoardMode, PresetScenario } from '../types/forge';
import { cellToIndex } from './honeycomb';

export const PRESET_SCENARIOS: PresetScenario[] = [
  {
    id: 'video-00-00-opening-4star',
    title: 'Scenario 1: Opening 4★ Merge → 5★ Unlock',
    subtitle: 'Video 00:00 — Diagonal [4★, 3★] Pair + Bent-3 [2★, 3★, 2★] Preview',
    videoTimestamp: '00:00',
    description:
      'Early-mid game board where two 4★ Hammers are primed on the upper-left perimeter and all 1★ Daggers have already been cleared. Placing the [4★, 3★] pair unlocks your first 5★ Flame Blade cleanly while setting up a 3★ pair for the upcoming [2★, 3★, 2★] Bent-3 piece.',
    boardMode: '23-cell',
    maxUnlockedStar: 4,
    boardCells: [
      { col: 0, row: 0, star: 4 },
      { col: 0, row: 1, star: 4 },
      { col: 1, row: 1, star: 3 },
      { col: 2, row: 2, star: 2 },
      { col: 3, row: 1, star: 2 },
      { col: 4, row: 0, star: 3 },
      { col: 4, row: 1, star: 2 },
    ],
    currentPiece: {
      shapeId: 'pair',
      rotation: 2, // Diagonal SE
      tileStars: [4, 3],
    },
    nextPiece: {
      shapeId: 'bent3',
      rotation: 0,
      tileStars: [2, 3, 2],
    },
    nextPieceKnown: true,
  },
  {
    id: 'video-00-13-double-cascade',
    title: 'Scenario 2: Double Chain Cascade (2★ → 3★ → 4★)',
    subtitle: 'Video 00:13 — Bent-3 [2★, 2★, 3★] at (B2, C2, C1)',
    videoTimestamp: '00:13',
    description:
      'Authentic board state from 00:12 of gameplay. Placing the Bent-3 [2★, 2★, 3★] piece with vertex T0 (2★) at C2 (Col 2, Row 1), T1 (2★) at B2 (Col 1, Row 1), and T2 (3★) at C1 (Col 2, Row 0) merges the 2★ group onto C2, which immediately bridges T2 (3★) and existing 3★ neighbors to cascade into 4★!',
    boardMode: '23-cell',
    maxUnlockedStar: 5,
    boardCells: [
      { col: 0, row: 0, star: 5 },
      { col: 2, row: 2, star: 2 },
      { col: 1, row: 3, star: 3 },
      { col: 3, row: 0, star: 3 },
      { col: 3, row: 1, star: 4 },
      { col: 4, row: 0, star: 4 },
      { col: 4, row: 2, star: 3 },
      { col: 2, row: 3, star: 2 },
    ],
    currentPiece: {
      shapeId: 'bent3',
      rotation: 4, // T0=(0,0,0), T1=SW(-1,1,0), T2=N(0,-1,1) -> places at (2,1), (1,1), (2,0)
      tileStars: [2, 2, 3],
    },
    nextPiece: {
      shapeId: 'pair',
      rotation: 0,
      tileStars: [3, 4],
    },
    nextPieceKnown: true,
  },
  {
    id: 'video-00-32-6star-straggler-rescue',
    title: 'Scenario 3: 6★ Unlock + Last 2★ Straggler Rescue',
    subtitle: 'Video 00:32 — Chain 4★ → 5★ → 6★ & Clear Final 2★ Tiles',
    videoTimestamp: '00:32',
    description:
      'High-stakes window shift from 00:32! Placing [4★, 2★] at B2 (1,1) triggers a 4★ → 5★ → 6★ cascade that unlocks 6★ and permanently retires 2★. Rotating [4★, 2★] SE toward C3 (2,2) connects with the 2★ at D3 (3,2) so Next Piece [2★, 3★] rescues all 2★ stragglers—whereas rotating SW to A3 (0,2) traps 2× 2★ as permanent dead space!',
    boardMode: '23-cell',
    maxUnlockedStar: 5,
    boardCells: [
      { col: 0, row: 0, star: 5 },
      { col: 1, row: 0, star: 5 },
      { col: 0, row: 1, star: 4 },
      { col: 2, row: 1, star: 4 },
      { col: 3, row: 2, star: 2 },
      { col: 4, row: 0, star: 5 },
      { col: 4, row: 1, star: 3 },
      { col: 3, row: 3, star: 3 },
    ],
    currentPiece: {
      shapeId: 'pair',
      rotation: 2, // T0 at (1,1) [4★], T1 SE at (2,2) [2★]
      tileStars: [4, 2],
    },
    nextPiece: {
      shapeId: 'pair',
      rotation: 0,
      tileStars: [2, 3],
    },
    nextPieceKnown: true,
  },
];

export function buildBoardFromPreset(preset: PresetScenario): Uint8Array {
  const board = new Uint8Array(25);
  for (const item of preset.boardCells) {
    const idx = cellToIndex(item.col, item.row);
    if (idx >= 0 && idx < 25) {
      board[idx] = item.star;
    }
  }
  return board;
}

export function encodeStateToHash(state: {
  boardMode: BoardMode;
  maxUnlockedStar: number;
  board: Uint8Array;
  currentPiece: PresetScenario['currentPiece'];
  nextPiece: PresetScenario['nextPiece'];
  nextPieceKnown: boolean;
}): string {
  const payload = {
    m: state.boardMode === '23-cell' ? 23 : 25,
    u: state.maxUnlockedStar,
    b: Array.from(state.board),
    c: [
      state.currentPiece.shapeId,
      state.currentPiece.rotation,
      state.currentPiece.tileStars,
    ],
    n: [
      state.nextPiece.shapeId,
      state.nextPiece.rotation,
      state.nextPiece.tileStars,
    ],
    k: state.nextPieceKnown ? 1 : 0,
  };
  return btoa(JSON.stringify(payload));
}

export function decodeStateFromHash(hashStr: string): {
  boardMode: BoardMode;
  maxUnlockedStar: number;
  board: Uint8Array;
  currentPiece: PresetScenario['currentPiece'];
  nextPiece: PresetScenario['nextPiece'];
  nextPieceKnown: boolean;
} | null {
  try {
    const clean = hashStr.replace(/^#/, '').trim();
    if (!clean) return null;
    const parsed = JSON.parse(atob(clean));
    if (!parsed || !Array.isArray(parsed.b) || parsed.b.length !== 25) {
      return null;
    }
    return {
      boardMode: parsed.m === 25 ? '25-cell' : '23-cell',
      maxUnlockedStar: Math.max(4, Math.min(10, Number(parsed.u) || 4)),
      board: new Uint8Array(parsed.b.map((v: number) => Math.max(0, Math.min(10, Number(v) || 0)))),
      currentPiece: {
        shapeId: parsed.c?.[0] || 'pair',
        rotation: Number(parsed.c?.[1]) || 0,
        tileStars: Array.isArray(parsed.c?.[2]) ? parsed.c[2] : [2, 3],
      },
      nextPiece: {
        shapeId: parsed.n?.[0] || 'bent3',
        rotation: Number(parsed.n?.[1]) || 0,
        tileStars: Array.isArray(parsed.n?.[2]) ? parsed.n[2] : [2, 3, 2],
      },
      nextPieceKnown: parsed.k !== 0,
    };
  } catch {
    return null;
  }
}
