import {
  MergeStep,
  PlacedTile,
  SimulationResult,
  StragglerCellInfo,
} from '../types/forge';
import {
  getMinActiveSpawnStar,
  MAX_STAR_UPGRADE_TARGET_GRADE,
} from './constants';
import {
  getCellVisualY,
  getPrecomputedNeighbors,
  getValidCellIndices,
  indexToCoord,
  isCellIndexValid,
  resolvePiecePlacement,
} from './honeycomb';

/**
 * Finds the connected component of cells sharing the same star level `targetStar`
 * starting from `startCell`.
 */
export function getConnectedComponent(
  board: Uint8Array,
  startCell: number,
  neighborsTable: number[][]
): number[] {
  const targetStar = board[startCell];
  if (targetStar === 0) return [];

  const visited = new Uint8Array(25);
  const queue: number[] = [startCell];
  visited[startCell] = 1;
  const component: number[] = [];

  while (queue.length > 0) {
    const curr = queue.shift()!;
    component.push(curr);
    const neighbors = neighborsTable[curr];
    for (let i = 0; i < neighbors.length; i++) {
      const nb = neighbors[i];
      if (!visited[nb] && board[nb] === targetStar) {
        visited[nb] = 1;
        queue.push(nb);
      }
    }
  }

  return component;
}

/**
 * Checks if spawning `nextStar` at `candidateCell` after clearing `clearedCells`
 * would immediately form a >= 3 connected component of `nextStar`.
 */
function wouldTriggerDownstreamChain(
  board: Uint8Array,
  clearedCells: number[],
  candidateCell: number,
  nextStar: number,
  neighborsTable: number[][]
): boolean {
  if (nextStar >= 10) return false;
  const tempBoard = new Uint8Array(board);
  for (const c of clearedCells) {
    tempBoard[c] = 0;
  }
  tempBoard[candidateCell] = nextStar;
  const comp = getConnectedComponent(tempBoard, candidateCell, neighborsTable);
  return comp.length >= 3;
}

/**
 * Selects the landing cell when 1 or more newly placed tiles belong to a merging component.
 * Follows Section 2.5.3:
 * 1. Hard rule: always spawns on one of the newly placed piece's cells.
 * 2. If only 1 newly placed tile is in the component, it lands there deterministically.
 * 3. If 2+ newly placed tiles are in the component:
 *    - If `preferredLandingCell` is specified and in the candidate list, use it.
 *    - If this is a cascade step (an upgraded tile from step 0 triggered the merge), keep that upgraded landing cell.
 *    - Check if one candidate triggers a downstream chain cascade (L+1 -> L+2).
 *    - For 3-tile pieces, prioritize center/vertex tile T0 (tileIndex === 0) if it is part of the merge.
 *    - Prioritize the placed tile that directly touches the most pre-existing board tiles of level L.
 *    - Break ties by top-most visual vertical position (r + 0.5 * (c % 2)), then column index.
 */
function selectMergeLandingCell(
  candidates: number[],
  component: number[],
  fromStar: number,
  prePlacementBoard: Uint8Array,
  currentBoard: Uint8Array,
  placedByCell: Map<number, PlacedTile>,
  pieceTileCount: number,
  upgradedCells: Set<number>,
  neighborsTable: number[][]
): number {
  if (candidates.length === 1) {
    return candidates[0];
  }

  // If one of the candidates is already an upgraded cascade cell from an earlier step, keep it on that cell
  const cascadedCandidate = candidates.find((c) => upgradedCells.has(c));
  if (cascadedCandidate !== undefined) {
    return cascadedCandidate;
  }

  // If the user/game marked a specific tile of the piece with the Anchor Dot (●) (`isAnchor === true`)
  // and that anchor tile is part of this merging group, the merged relic lands on that anchor tile!
  const explicitAnchorCandidate = candidates.find(
    (c) => placedByCell.get(c)?.isAnchor === true
  );
  if (explicitAnchorCandidate !== undefined) {
    return explicitAnchorCandidate;
  }

  const nextStar = fromStar + 1;
  const compSet = new Set<number>(component);

  const scored = candidates.map((cellIdx) => {
    const placedInfo = placedByCell.get(cellIdx);
    const isPivotT0 = pieceTileCount === 3 && placedInfo?.tileIndex === 0;

    // Count how many pre-existing board neighbors of `fromStar` this cell directly touches,
    // and how many total tiles in the merging component this cell is directly connected to.
    let preExistingTouchCount = 0;
    let componentDegree = 0;
    for (const nb of neighborsTable[cellIdx]) {
      if (prePlacementBoard[nb] === fromStar) {
        preExistingTouchCount++;
      }
      if (compSet.has(nb)) {
        componentDegree++;
      }
    }

    const triggersChain = wouldTriggerDownstreamChain(
      currentBoard,
      component,
      cellIdx,
      nextStar,
      neighborsTable
    );

    const { col, row } = indexToCoord(cellIdx);
    const visualY = getCellVisualY(col, row);

    return {
      cellIdx,
      preExistingTouchCount,
      triggersChain,
      componentDegree,
      isPivotT0,
      visualY,
      col,
    };
  });

  scored.sort((a, b) => {
    // 1. Most pre-existing same-star board neighbors directly touched (bridge to existing board, e.g. B4 touching A4)
    if (a.preExistingTouchCount !== b.preExistingTouchCount) {
      return b.preExistingTouchCount - a.preExistingTouchCount;
    }
    // 2. When tied on pre-existing board connections (e.g. a 3-of-a-kind piece self-merging as in Infographic Col 6-7),
    // rotating the piece 180° in-game moves the preset combo square to the end that triggers a downstream chain!
    if (a.triggersChain !== b.triggersChain) {
      return a.triggersChain ? -1 : 1;
    }
    // 3. Highest adjacency degree within the merging component (center/hub of the merge group)
    if (a.componentDegree !== b.componentDegree) {
      return b.componentDegree - a.componentDegree;
    }
    // 4. For 3-tile pieces, T0 pivot/vertex priority
    if (a.isPivotT0 !== b.isPivotT0) {
      return a.isPivotT0 ? -1 : 1;
    }
    // 5. Top-most visual vertical position
    if (a.visualY !== b.visualY) {
      return a.visualY - b.visualY;
    }
    // 6. Left-most column
    return a.col - b.col;
  });

  return scored[0].cellIdx;
}

/**
 * Pure deterministic placement & recursive chain cascade simulator.
 * - 3 or 4 connected relics evolve +1★
 * - 5+ connected relics evolve +2★ (super evolution)
 */
export function simulatePlacement(
  board: Uint8Array,
  maxUnlockedStar: number,
  placedTiles: PlacedTile[]
): SimulationResult {
  const neighborsTable = getPrecomputedNeighbors();
  const prePlacementBoard = new Uint8Array(board);
  const nextBoard = new Uint8Array(board);

  const placedByCell = new Map<number, PlacedTile>();
  const activeAnchorCells = new Set<number>();
  const upgradedCells = new Set<number>();

  for (const pt of placedTiles) {
    nextBoard[pt.cellIndex] = pt.star;
    placedByCell.set(pt.cellIndex, pt);
    activeAnchorCells.add(pt.cellIndex);
  }

  const merges: MergeStep[] = [];
  let totalTilesCleared = 0;
  let hammersEarned = 0;
  let tenStarsCreated = 0;

  // Track chain depth per anchor cell
  const chainDepthByCell = new Map<number, number>();
  for (const pt of placedTiles) {
    chainDepthByCell.set(pt.cellIndex, 0);
  }

  // Repeatedly find connected components >= 3 that include at least one activeAnchorCell.
  // Process lowest star level first so lower merges can cascade into adjacent higher placed tiles.
  let safetyCounter = 0;
  while (safetyCounter++ < 25) {
    const visited = new Uint8Array(25);
    const candidateComponents: {
      star: number;
      component: number[];
      anchorsInComp: number[];
    }[] = [];

    for (const anchorCell of activeAnchorCells) {
      if (visited[anchorCell]) continue;
      const star = nextBoard[anchorCell];
      if (star === 0 || star >= 10) continue;

      const comp = getConnectedComponent(nextBoard, anchorCell, neighborsTable);
      for (const c of comp) {
        visited[c] = 1;
      }

      if (comp.length >= 3) {
        const anchorsInComp = comp.filter((c) => activeAnchorCells.has(c));
        candidateComponents.push({
          star,
          component: comp,
          anchorsInComp,
        });
      }
    }

    if (candidateComponents.length === 0) {
      break;
    }

    // Sort by lowest star level first
    candidateComponents.sort((a, b) => a.star - b.star);
    const chosen = candidateComponents[0];
    const fromStar = chosen.star;
    // Super evolution rule: 5+ relics evolve +2 levels AND earn +1 Hammer (up to max 2); 3 or 4 relics evolve +1 level
    const isSuperMerge = chosen.component.length >= 5;
    const starJump = isSuperMerge ? 2 : 1;
    const toStar = Math.min(10, fromStar + starJump);

    if (isSuperMerge) {
      hammersEarned++;
    }

    const landingCell = selectMergeLandingCell(
      chosen.anchorsInComp,
      chosen.component,
      fromStar,
      prePlacementBoard,
      nextBoard,
      placedByCell,
      placedTiles.length,
      upgradedCells,
      neighborsTable
    );

    const prevDepth = Math.max(
      0,
      ...chosen.anchorsInComp.map((c) => chainDepthByCell.get(c) ?? 0)
    );
    const newDepth = prevDepth + 1;

    // Remove all tiles in the merging component
    for (const c of chosen.component) {
      nextBoard[c] = 0;
      if (c !== landingCell) {
        activeAnchorCells.delete(c);
      }
    }

    const disappearedAsTenStar = toStar === 10;
    if (disappearedAsTenStar) {
      // 10-star relics disappear from the board when created and are marked as achieved!
      nextBoard[landingCell] = 0;
      activeAnchorCells.delete(landingCell);
      upgradedCells.delete(landingCell);
      totalTilesCleared += chosen.component.length;
      tenStarsCreated++;
    } else {
      // Spawn upgraded tile on landingCell
      nextBoard[landingCell] = toStar;
      activeAnchorCells.add(landingCell);
      upgradedCells.add(landingCell);
      chainDepthByCell.set(landingCell, newDepth);
      totalTilesCleared += chosen.component.length - 1;
    }

    merges.push({
      stepIndex: prevDepth,
      fromStar,
      toStar,
      mergedCells: chosen.component,
      landingCell,
      earnedHammer: isSuperMerge,
      disappearedAsTenStar,
    });
  }

  let nextMaxStar = Math.max(4, maxUnlockedStar);
  const validIndices = getValidCellIndices();
  for (const idx of validIndices) {
    if (nextBoard[idx] > nextMaxStar) {
      nextMaxStar = nextBoard[idx];
    }
  }
  for (const m of merges) {
    if (m.toStar > nextMaxStar) {
      nextMaxStar = m.toStar;
    }
  }

  const maxChainDepth = merges.reduce(
    (max, m) => Math.max(max, m.stepIndex + 1),
    0
  );

  const newlyRetiredStars: number[] = [];
  if (nextMaxStar > maxUnlockedStar) {
    const oldMinSpawn = getMinActiveSpawnStar(maxUnlockedStar);
    const newMinSpawn = getMinActiveSpawnStar(nextMaxStar);
    for (let s = oldMinSpawn; s < newMinSpawn; s++) {
      newlyRetiredStars.push(s);
    }
  }

  return {
    nextBoard,
    nextMaxStar,
    previousMaxStar: maxUnlockedStar,
    merges,
    maxChainDepth,
    totalTilesCleared,
    unlockedNewMaxTier: nextMaxStar > maxUnlockedStar,
    newlyRetiredStars,
    hammersEarned,
    tenStarsCreated,
  };
}

/**
 * Simulates using the once-per-run Star on a board cell (`cellIndex`).
 * - Raises the relic at `cellIndex` by +1 grade (valid for 1★..8★; cannot be used on 9★ or empty cells).
 * - Applies the exact same merging and cascade rules as placing a tile of that new grade at `cellIndex`
 *   (including 5+ relic super-merges granting +2★ and +1 Hammer, and 10★ relics disappearing from the board).
 */
export function simulateStarUpgrade(
  board: Uint8Array,
  maxUnlockedStar: number,
  cellIndex: number
): SimulationResult | null {
  if (!isCellIndexValid(cellIndex)) return null;
  const currentStar = board[cellIndex];
  if (currentStar < 1 || currentStar > MAX_STAR_UPGRADE_TARGET_GRADE) {
    return null;
  }

  const upgradedStar = currentStar + 1;
  const boardWithoutTarget = new Uint8Array(board);
  boardWithoutTarget[cellIndex] = 0;

  const { col, row } = indexToCoord(cellIndex);
  return simulatePlacement(boardWithoutTarget, maxUnlockedStar, [
    {
      tileIndex: 0,
      cellIndex,
      col,
      row,
      star: upgradedStar,
      isAnchor: true,
    },
  ]);
}

/**
 * Counts empty cells on the board.
 */
export function countEmptyCells(board: Uint8Array): number {
  const valid = getValidCellIndices();
  let empty = 0;
  for (let i = 0; i < valid.length; i++) {
    if (board[valid[i]] === 0) empty++;
  }
  return empty;
}

export interface ShapeMobilityBreakdown {
  totalThreeTileSlots: number;
  line3Slots: number;
  bentAndChevronSlots: number;
  compact3TriangleSlots: number;
  pairSlots: number;
  vulnerableShapes: string[];
}

interface PrecomputedShapeSlots {
  line3Triplets: Uint8Array;
  bent3Triplets: Uint8Array;
  compact3Triplets: Uint8Array;
  pairDoubles: Uint8Array;
}

let cachedShapeSlots: PrecomputedShapeSlots | null = null;

function getPrecomputedShapeSlots(): PrecomputedShapeSlots {
  if (cachedShapeSlots) return cachedShapeSlots;

  const validIndices = getValidCellIndices();
  const dummy3 = [1, 1, 1];
  const dummy2 = [1, 1];

  const line3List: number[] = [];
  for (let rot = 0; rot < 3; rot++) {
    for (let i = 0; i < validIndices.length; i++) {
      const { col, row } = indexToCoord(validIndices[i]);
      const cells = resolvePiecePlacement('line3', rot, dummy3, col, row);
      if (cells) {
        line3List.push(cells[0].cellIndex, cells[1].cellIndex, cells[2].cellIndex);
      }
    }
  }

  const bent3List: number[] = [];
  for (let rot = 0; rot < 6; rot++) {
    for (let i = 0; i < validIndices.length; i++) {
      const { col, row } = indexToCoord(validIndices[i]);
      const cells = resolvePiecePlacement('bent3', rot, dummy3, col, row);
      if (cells) {
        bent3List.push(cells[0].cellIndex, cells[1].cellIndex, cells[2].cellIndex);
      }
    }
  }

  const compact3List: number[] = [];
  for (let rot = 0; rot < 2; rot++) {
    for (let i = 0; i < validIndices.length; i++) {
      const { col, row } = indexToCoord(validIndices[i]);
      const cells = resolvePiecePlacement('compact3', rot, dummy3, col, row);
      if (cells) {
        compact3List.push(cells[0].cellIndex, cells[1].cellIndex, cells[2].cellIndex);
      }
    }
  }

  const pairList: number[] = [];
  for (let rot = 0; rot < 3; rot++) {
    for (let i = 0; i < validIndices.length; i++) {
      const { col, row } = indexToCoord(validIndices[i]);
      const cells = resolvePiecePlacement('pair', rot, dummy2, col, row);
      if (cells) {
        pairList.push(cells[0].cellIndex, cells[1].cellIndex);
      }
    }
  }

  cachedShapeSlots = {
    line3Triplets: new Uint8Array(line3List),
    bent3Triplets: new Uint8Array(bent3List),
    compact3Triplets: new Uint8Array(compact3List),
    pairDoubles: new Uint8Array(pairList),
  };
  return cachedShapeSlots;
}

/**
 * Computes valid placement counts for each piece family (including 3-Triangle `compact3`,
 * `line3`, `bent3`/`chevron3`, and `pair`) so the solver detects when the board is
 * vulnerable to becoming unplayable for specific piece shapes (especially 3-Triangle!).
 */
export function analyzeShapeMobility(
  board: Uint8Array
): ShapeMobilityBreakdown {
  const { line3Triplets, bent3Triplets, compact3Triplets, pairDoubles } =
    getPrecomputedShapeSlots();

  let line3Slots = 0;
  for (let i = 0; i < line3Triplets.length; i += 3) {
    if (
      board[line3Triplets[i]] === 0 &&
      board[line3Triplets[i + 1]] === 0 &&
      board[line3Triplets[i + 2]] === 0
    ) {
      line3Slots++;
    }
  }

  let bentAndChevronSlots = 0;
  for (let i = 0; i < bent3Triplets.length; i += 3) {
    if (
      board[bent3Triplets[i]] === 0 &&
      board[bent3Triplets[i + 1]] === 0 &&
      board[bent3Triplets[i + 2]] === 0
    ) {
      bentAndChevronSlots++;
    }
  }

  let compact3TriangleSlots = 0;
  for (let i = 0; i < compact3Triplets.length; i += 3) {
    if (
      board[compact3Triplets[i]] === 0 &&
      board[compact3Triplets[i + 1]] === 0 &&
      board[compact3Triplets[i + 2]] === 0
    ) {
      compact3TriangleSlots++;
    }
  }

  let pairSlots = 0;
  for (let i = 0; i < pairDoubles.length; i += 2) {
    if (board[pairDoubles[i]] === 0 && board[pairDoubles[i + 1]] === 0) {
      pairSlots++;
    }
  }

  const vulnerableShapes: string[] = [];
  if (compact3TriangleSlots === 0) {
    vulnerableShapes.push('3-Triangle (0 fits!)');
  } else if (compact3TriangleSlots === 1) {
    vulnerableShapes.push('3-Triangle (1 fit)');
  }
  if (line3Slots === 0) {
    vulnerableShapes.push('3-Line (0 fits!)');
  }
  if (bentAndChevronSlots === 0) {
    vulnerableShapes.push('3-Bent/Arch (0 fits!)');
  }

  return {
    totalThreeTileSlots:
      line3Slots + bentAndChevronSlots + compact3TriangleSlots,
    line3Slots,
    bentAndChevronSlots,
    compact3TriangleSlots,
    pairSlots,
    vulnerableShapes,
  };
}

/**
 * Counts how many valid placement slots exist on `board` for standard 3-tile pieces
 * (`line3`, `bent3`, and `compact3`).
 */
export function countThreeTileMobility(board: Uint8Array): number {
  return analyzeShapeMobility(board).totalThreeTileSlots;
}

/**
 * Analyzes all occupied cells on `board` for Dead Spaces (retired star tiers that can no longer spawn)
 * and At-Risk Stragglers (lowest active spawn tier M-3 that will retire on the next tier-up).
 */
export function analyzeBoardStragglers(
  board: Uint8Array,
  maxUnlockedStar: number,
  unplacedQueueStars: number[] = []
): StragglerCellInfo[] {
  const validIndices = getValidCellIndices();
  const neighborsTable = getPrecomputedNeighbors();
  const minActiveStar = getMinActiveSpawnStar(maxUnlockedStar);

  // Count how many tiles of each star exist in the unplaced piece queue (Current + Next piece)
  const queueStarCounts = new Uint8Array(11);
  for (const s of unplacedQueueStars) {
    if (s >= 1 && s <= 10) queueStarCounts[s]++;
  }

  // Also count total board tiles of each star
  const boardStarCounts = new Uint8Array(11);
  for (const idx of validIndices) {
    const s = board[idx];
    if (s >= 1 && s <= 10) boardStarCounts[s]++;
  }

  const stragglers: StragglerCellInfo[] = [];

  for (const idx of validIndices) {
    const star = board[idx];
    if (star === 0) continue;
    const { col, row } = indexToCoord(idx);

    if (star < minActiveStar) {
      // Retired star level! Check if it can possibly be rescued by unplaced queue tiles
      // or by an adjacent lower-tier merge (which itself is only possible if star - 1 is not dead).
      const comp = getConnectedComponent(board, idx, neighborsTable);
      let emptyNeighborCount = 0;
      for (const c of comp) {
        for (const nb of neighborsTable[c]) {
          if (board[nb] === 0) emptyNeighborCount++;
        }
      }

      const neededToMerge = Math.max(0, 3 - comp.length);
      const availableInQueue = queueStarCounts[star];
      const canRescueFromQueue =
        availableInQueue >= neededToMerge && emptyNeighborCount > 0;

      if (!canRescueFromQueue) {
        stragglers.push({
          cellIndex: idx,
          col,
          row,
          star,
          status: 'dead',
          reason: `${star}★ is permanently retired (Max tier is ${maxUnlockedStar}★; active pool is ${minActiveStar}★–${maxUnlockedStar}★) and no matching ${star}★ tiles remain in queue.`,
        });
      } else {
        stragglers.push({
          cellIndex: idx,
          col,
          row,
          star,
          status: 'at-risk',
          reason: `${star}★ is retired! Must be cleared immediately using the ${star}★ tile in your piece queue or it becomes permanent dead space.`,
        });
      }
    } else if (star === minActiveStar && maxUnlockedStar >= 4 && maxUnlockedStar < 7) {
      // Endangered tier: 1★, 2★, 3★ will be retired as soon as 5★, 6★, 7★ is unlocked (4★ never retires!)
      stragglers.push({
        cellIndex: idx,
        col,
        row,
        star,
        status: 'at-risk',
        reason: `${star}★ is at the bottom of the spawn window (${minActiveStar}★–${maxUnlockedStar}★). Unlocking ${maxUnlockedStar + 1}★ will permanently retire ${star}★!`,
      });
    }
  }

  return stragglers;
}
