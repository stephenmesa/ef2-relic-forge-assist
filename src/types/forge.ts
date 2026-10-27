export type PieceShapeId =
  | 'single'
  | 'pair'
  | 'line3'
  | 'chevron3'
  | 'bent3'
  | 'compact3';

export type CubeCoord = [number, number, number]; // [x, y, z] with x + y + z = 0

export interface OffsetCoord {
  col: number;
  row: number;
}

export interface RelicVisualSpec {
  star: number;
  name: string;
  shortName: string;
  tierGroup: 1 | 2 | 3;
  bgHex: string;
  borderHex: string;
  badgeText: string;
  starCount: number;
  isLargeStar: boolean;
}

export interface PieceShapeSpec {
  id: PieceShapeId;
  name: string;
  shortName: string;
  tileCount: 1 | 2 | 3;
  baseCubeOffsets: CubeCoord[]; // Relative to T0 at [0, 0, 0]
  rotationLabels: [string, string, string, string, string, string];
}

export interface PieceConfig {
  shapeId: PieceShapeId;
  rotation: number; // 0..5 (60° CW steps)
  tileStars: number[]; // length matches shape's tileCount, values 1..10
  anchorTileIndex?: number; // 0..(tileCount - 1): the tile marked with the in-game dot ● where merged relics land (defaults to 0)
}

export interface PlacedTile {
  tileIndex: number; // 0, 1, or 2
  cellIndex: number; // col * 5 + row (0..24)
  col: number;
  row: number;
  star: number; // 1..10
  isAnchor?: boolean; // true if this tile has the piece's in-game anchor dot ●
}

export interface MergeStep {
  stepIndex: number; // 0 = initial merge, 1+ = chain cascade step
  fromStar: number;
  toStar: number;
  mergedCells: number[]; // All cell indices cleared in this merge step
  landingCell: number; // The cell index where toStar spawns
}

export interface SimulationResult {
  nextBoard: Uint8Array; // length 25 (col * 5 + row)
  nextMaxStar: number;
  previousMaxStar: number;
  merges: MergeStep[];
  maxChainDepth: number;
  totalTilesCleared: number;
  unlockedNewMaxTier: boolean;
  newlyRetiredStars: number[];
}

export interface StragglerCellInfo {
  cellIndex: number;
  col: number;
  row: number;
  star: number;
  status: 'dead' | 'at-risk';
  reason: string;
}

export interface Ply2Continuation {
  rotation: number;
  rotationStepsFromComposer: number;
  rotationDescription: string;
  anchorCol: number;
  anchorRow: number;
  placedTiles: PlacedTile[];
  sim: SimulationResult;
  transitionScore: number;
  boardEvalScore: number;
  totalPly2Score: number;
}

export interface CandidateMove {
  id: string;
  rotation: number;
  rotationStepsFromComposer: number;
  rotationDescription: string;
  anchorCol: number;
  anchorRow: number;
  placedTiles: PlacedTile[];
  ply1Sim: SimulationResult;
  bestPly2: Ply2Continuation | null;
  totalScore: number;
  ply1TransitionScore: number;
  ply2ContinuationScore: number;
  isLethal: boolean;
  trapsRetiredTilesCount: number;
  trappedStarLevel: number | null;
  rescuedStragglersCount: number;
  deadSpacesAfter: number;
  atRiskSpacesAfter: number;
  emptyCellsBefore: number;
  emptyCellsAfterPly1: number;
  emptyCellsAfterPly2: number;
  threeTileMobilityAfter: number;
  strategicTag: {
    label: string;
    tone: 'chain' | 'rescue' | 'warning' | 'lethal' | 'setup' | 'merge';
  };
  warnings: string[];
  highlights: string[];
  scoreBreakdown: { label: string; value: number }[];
}

export type HammerUrgency =
  | 'critical-survival' // Board is locked / 0 safe moves or 0 3-triangle slots; hammer saves the run now
  | 'high-value-cascade' // Hammering unblocks a tier-up or multi-step chain cascade on this turn
  | 'good-cleanup' // Mid/late game (especially M>=7★ where no new tiers retire) clearing a permanent dead space
  | 'hold-save'; // Board is healthy or low-star tiles can still be naturally merged; save your 1× hammer

export interface HammerCandidateTarget {
  cellIndex: number;
  col: number;
  row: number;
  star: number;
  isDeadRetired: boolean;
  isAtRisk: boolean;
  netGainScore: number;
  bestMoveAfterHammer: CandidateMove | null;
  savesFromGameOver: boolean;
  unlocksNewTierOrCascade: boolean;
  clearsLastPermanentDeadSpace: boolean;
  triangleSlotsGained: number;
  threeTileSlotsGained: number;
  reason: string;
}

export interface HammerAdvice {
  urgency: HammerUrgency;
  shouldUseNow: boolean;
  headline: string;
  rationale: string;
  recommendedTarget: HammerCandidateTarget | null;
  alternativeTargets: HammerCandidateTarget[];
}

export interface PresetScenario {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  videoTimestamp: string;
  maxUnlockedStar: number;
  boardCells: { col: number; row: number; star: number }[];
  currentPiece: PieceConfig;
  nextPiece: PieceConfig;
  nextPieceKnown: boolean;
}
