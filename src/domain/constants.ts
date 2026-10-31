import { PieceShapeId, PieceShapeSpec, RelicVisualSpec, SolverStrategyId, SolverStrategySpec } from '../types/forge';

export const RELIC_SPECS: Record<number, RelicVisualSpec> = {
  1: {
    star: 1,
    name: 'Iron Broadsword',
    shortName: 'Sword',
    tierGroup: 1,
    bgHex: '#5D646E',
    borderHex: '#9EA6B2',
    badgeText: '★',
    starCount: 1,
    isLargeStar: false,
  },
  2: {
    star: 2,
    name: 'Emerald Wing Cloak',
    shortName: 'Cloak',
    tierGroup: 1,
    bgHex: '#3E7C45',
    borderHex: '#6EC274',
    badgeText: '★★',
    starCount: 2,
    isLargeStar: false,
  },
  3: {
    star: 3,
    name: 'Royal Plate Cuirass',
    shortName: 'Cuirass',
    tierGroup: 1,
    bgHex: '#37699E',
    borderHex: '#6BA9EA',
    badgeText: '★★★',
    starCount: 3,
    isLargeStar: false,
  },
  4: {
    star: 4,
    name: 'Ruby Warhammer',
    shortName: 'Warhammer',
    tierGroup: 1,
    bgHex: '#72509D',
    borderHex: '#B08AE0',
    badgeText: '★★★★',
    starCount: 4,
    isLargeStar: false,
  },
  5: {
    star: 5,
    name: 'Crimson Flame Greatsword',
    shortName: 'Flame Sword',
    tierGroup: 2,
    bgHex: '#AA4549',
    borderHex: '#F27D82',
    badgeText: '★',
    starCount: 1,
    isLargeStar: true,
  },
  6: {
    star: 6,
    name: 'Gold Dragon Amulet',
    shortName: 'Dragon Amulet',
    tierGroup: 2,
    bgHex: '#B58435',
    borderHex: '#F5C66C',
    badgeText: '★ ★',
    starCount: 2,
    isLargeStar: true,
  },
  7: {
    star: 7,
    name: 'Azure Dragon Scale Armor',
    shortName: 'Dragon Armor',
    tierGroup: 2,
    bgHex: '#2E8E9E',
    borderHex: '#7AF0FF',
    badgeText: '★ ★ ★',
    starCount: 3,
    isLargeStar: true,
  },
  8: {
    star: 8,
    name: 'Molten Magma Core',
    shortName: 'Magma Core',
    tierGroup: 2,
    bgHex: '#6B5B7B',
    borderHex: '#E8F4FF',
    badgeText: '★ ★ ★★',
    starCount: 4,
    isLargeStar: true,
  },
  9: {
    star: 9,
    name: 'Celestial Winged Battleaxe',
    shortName: 'Winged Axe',
    tierGroup: 3,
    bgHex: '#9A7848',
    borderHex: '#E2F8FF',
    badgeText: '★★ ★ ★★',
    starCount: 5,
    isLargeStar: true,
  },
  10: {
    star: 10,
    name: 'Mythic Primordial Relic',
    shortName: 'Mythic Relic',
    tierGroup: 3,
    bgHex: '#8C2D2B',
    borderHex: '#FFF59D',
    badgeText: '★ ★',
    starCount: 2,
    isLargeStar: true,
  },
};

export const PIECE_SHAPES: Record<PieceShapeId, PieceShapeSpec> = {
  single: {
    id: 'single',
    name: '1-Tile (Single)',
    shortName: '1-Tile',
    tileCount: 1,
    baseCubeOffsets: [[0, 0, 0]],
    rotationLabels: [
      'Single Square (0°)',
      'Single Square (60°)',
      'Single Square (120°)',
      'Single Square (180°)',
      'Single Square (240°)',
      'Single Square (300°)',
    ],
  },
  pair: {
    id: 'pair',
    name: '2-Tile (Pair)',
    shortName: '2-Pair',
    tileCount: 2,
    baseCubeOffsets: [
      [0, 0, 0],
      [0, -1, 1], // N
    ],
    rotationLabels: [
      'Vertical Pair (T1 Above T0)',
      'Diagonal Pair ↗ (T1 Upper-Right)',
      'Diagonal Pair ↘ (T1 Lower-Right)',
      'Vertical Pair (T1 Below T0)',
      'Diagonal Pair ↙ (T1 Lower-Left)',
      'Diagonal Pair ↖ (T1 Upper-Left)',
    ],
  },
  line3: {
    id: 'line3',
    name: '3-Tile Straight Line',
    shortName: '3-Line',
    tileCount: 3,
    baseCubeOffsets: [
      [0, 0, 0], // Center
      [0, -1, 1], // N
      [0, 1, -1], // S
    ],
    rotationLabels: [
      'Vertical Line | (T1 Top, T2 Bottom)',
      'Diagonal Line / (T1 NE, T2 SW)',
      'Diagonal Line \\ (T1 SE, T2 NW)',
      'Vertical Line | (T1 Bottom, T2 Top)',
      'Diagonal Line / (T1 SW, T2 NE)',
      'Diagonal Line \\ (T1 NW, T2 SE)',
    ],
  },
  chevron3: {
    id: 'chevron3',
    name: '3-Tile Chevron (^ / v Shape)',
    shortName: '3-Arch (^)',
    tileCount: 3,
    baseCubeOffsets: [
      [0, 0, 0], // Top Vertex T0
      [-1, 1, 0], // Lower-Left (SW) T1
      [1, 0, -1], // Lower-Right (SE) T2
    ],
    rotationLabels: [
      'Chevron ^ (T0 Top Vertex, T1 SW, T2 SE)',
      'L-Shape (T0 Vertex, T1 N, T2 SW)',
      'L-Shape (T0 Vertex, T1 NE, T2 NW)',
      'V-Shape v (T0 Bottom Vertex, T1 NE, T2 NW)',
      'L-Shape (T0 Vertex, T1 S, T2 NE)',
      'L-Shape (T0 Vertex, T1 SE, T2 S)',
    ],
  },
  bent3: {
    id: 'bent3',
    name: '3-Tile Bent / Arch (120°)',
    shortName: '3-Bent',
    tileCount: 3,
    baseCubeOffsets: [
      [0, 0, 0], // Vertex
      [0, -1, 1], // N
      [1, 0, -1], // SE
    ],
    rotationLabels: [
      'L-Shape (Arms Up N + Lower-Right SE)',
      'L-Shape (Arms Upper-Right NE + Down S)',
      'Arch ^ (Symmetric V: Arms SE + SW)',
      'L-Shape (Arms Down S + Upper-Left NW)',
      'L-Shape (Arms Lower-Left SW + Up N)',
      'V-Shape v (Symmetric V: Arms NW + NE)',
    ],
  },
  compact3: {
    id: 'compact3',
    name: '3-Tile Triangle Cluster',
    shortName: '3-Triangle',
    tileCount: 3,
    baseCubeOffsets: [
      [0, 0, 0],
      [0, -1, 1], // N
      [1, -1, 0], // NE
    ],
    rotationLabels: [
      'Triangle Cluster (N + NE)',
      'Triangle Cluster (NE + SE)',
      'Triangle Cluster (SE + S)',
      'Triangle Cluster (S + SW)',
      'Triangle Cluster (SW + NW)',
      'Triangle Cluster (NW + N)',
    ],
  },
};

export const INITIAL_HAMMERS = 1;
export const MAX_HAMMERS = 2;
export const MAX_STAR_UPGRADE_TARGET_GRADE = 8; // Star raises 1★..8★ by +1 grade (cannot be used on 9★)
export const MAX_RUN_PLACEMENTS = 1000;

export const PIECE_SHAPE_ORDER: PieceShapeId[] = [
  'single',
  'pair',
  'line3',
  'bent3',
  'compact3',
];

/**
 * Active Spawn Pool Rule (verified with Column 5 of player strategy infographic & high-tier screenshots):
 * - 1★ retires at 5★ (M >= 5)
 * - 2★ retires at 6★ (M >= 6)
 * - 3★ retires at 7★ (M >= 7)
 * - At M >= 8 (8★, 9★, 10★), 4★ (Purple Warhammer) NEVER retires! The minimum active spawn tier caps at 4★.
 */
export function getMinActiveSpawnStar(maxUnlockedStar: number): number {
  const clampedMax = Math.max(4, Math.min(10, maxUnlockedStar));
  return Math.min(4, Math.max(1, clampedMax - 3));
}

export function getActiveSpawnPool(maxUnlockedStar: number): number[] {
  const clampedMax = Math.max(4, Math.min(10, maxUnlockedStar));
  const minStar = getMinActiveSpawnStar(clampedMax);
  const pool: number[] = [];
  for (let s = minStar; s <= Math.min(clampedMax, minStar + 3); s++) {
    pool.push(s);
  }
  return pool;
}

export function getRetiredStars(maxUnlockedStar: number): number[] {
  const minActive = getMinActiveSpawnStar(maxUnlockedStar);
  const retired: number[] = [];
  for (let s = 1; s < minActive; s++) {
    retired.push(s);
  }
  return retired;
}

export const DEFAULT_STRATEGY_ID: SolverStrategyId = 'mythic-climax';

export const SOLVER_STRATEGIES: Record<SolverStrategyId, SolverStrategySpec> = {
  'mythic-climax': {
    id: 'mythic-climax',
    name: '👑 Mythic Climax (10★ Forge)',
    shortName: 'Mythic 10★',
    badge: '👑 Mythic Forge',
    description:
      'Aggressively builds high-tier 8★/9★ pairs and cascade highways to forge maximum 10★ Mythic Primordial Relics.',
    icon: '👑',
    iconName: 'Crown',
  },
  'max-survival': {
    id: 'max-survival',
    name: '🛡️ Maximum Moves (Survivalist)',
    shortName: 'Max Moves',
    badge: '🛡️ Survivalist',
    description:
      'Prioritizes all-shape mobility and zero-trap placements to survive the highest possible number of moves without locking the board.',
    icon: '🛡️',
    iconName: 'Shield',
  },
  'max-space': {
    id: 'max-space',
    name: '🧹 Maximum Empty Space (Board Cleaner)',
    shortName: 'Max Space',
    badge: '🧹 Board Cleaner',
    description:
      'Aggressively triggers 5+ super-merges and mass clears to keep the maximum number of empty cells open on the board.',
    icon: '🧹',
    iconName: 'Sparkles',
  },
  'hammer-cycle': {
    id: 'hammer-cycle',
    name: '🔨 Hammer Cycle (Super-Merge Engine)',
    shortName: 'Hammer Cycle',
    badge: '🔨 Super-Merge Engine',
    description:
      'Maximizes 5+ relic super-merges (+2★ jumps) and loops the generated hammers to aggressively keep the board clear and farm 10★ relics.',
    icon: '🔨',
    iconName: 'Hammer',
  },
};
