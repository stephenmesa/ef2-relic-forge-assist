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
}

export interface PlacedTile {
  tileIndex: number; // 0, 1, or 2
  cellIndex: number; // col * 5 + row (0..24)
  col: number;
  row: number;
  star: number; // 1..10
}

export interface MergeStep {
  stepIndex: number; // 0 = initial merge, 1+ = chain cascade step
  fromStar: number;
  toStar: number;
  mergedCells: number[]; // All cell indices cleared in this merge step
  landingCell: number; // The cell index where toStar spawns
  alternativeLandingCells: number[]; // If 2+ newly placed tiles of same star merged in step 0
}

export interface AmbiguousMergeInfo {
  fromStar: number;
  toStar: number;
  primaryCell: number;
  alternativeCells: number[];
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
  ambiguousMerges: AmbiguousMergeInfo[];
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
