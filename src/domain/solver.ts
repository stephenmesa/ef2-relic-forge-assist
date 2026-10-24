import {
  CandidateMove,
  PieceConfig,
  PlacedTile,
  Ply2Continuation,
  SimulationResult,
} from '../types/forge';
import { getMinActiveSpawnStar, PIECE_SHAPES } from './constants';
import {
  formatCellCoord,
  getColumnRowCount,
  getPrecomputedNeighbors,
  getValidCellIndices,
  indexToCoord,
  resolvePiecePlacement,
} from './honeycomb';
import {
  analyzeShapeMobility,
  countEmptyCells,
  getConnectedComponent,
  simulatePlacement,
} from './simulator';

interface RawPlacement {
  rotation: number;
  rotationStepsFromComposer: number;
  anchorCol: number;
  anchorRow: number;
  placedTiles: PlacedTile[];
}

/**
 * Generates all unique valid placements of `piece` on `board` across all 6 rotations.
 * Deduplicates placements that put identical star levels on the exact same board cells
 * (keeping the rotation closest to `piece.rotation` in the composer).
 */
export function generateValidPlacements(
  board: Uint8Array,
  piece: PieceConfig
): RawPlacement[] {
  const validIndices = getValidCellIndices();
  const bySignature = new Map<string, RawPlacement>();

  // Order rotations by minimum clicks from current composer rotation
  const rotationsOrder = [0, 1, 2, 3, 4, 5].sort((a, b) => {
    const stepsA = (a - piece.rotation + 6) % 6;
    const distA = Math.min(stepsA, 6 - stepsA);
    const stepsB = (b - piece.rotation + 6) % 6;
    const distB = Math.min(stepsB, 6 - stepsB);
    return distA - distB || stepsA - stepsB;
  });

  for (const rot of rotationsOrder) {
    const stepsCW = (rot - piece.rotation + 6) % 6;
    for (let i = 0; i < validIndices.length; i++) {
      const { col, row } = indexToCoord(validIndices[i]);
      const resolved = resolvePiecePlacement(
        piece.shapeId,
        rot,
        piece.tileStars,
        col,
        row
      );
      if (!resolved) continue;

      // Check all target cells are currently empty
      let allEmpty = true;
      for (let t = 0; t < resolved.length; t++) {
        if (board[resolved[t].cellIndex] !== 0) {
          allEmpty = false;
          break;
        }
      }
      if (!allEmpty) continue;

      // Build canonical signature: sorted cellIndex:star plus pivot cell if 3-tile piece with same stars
      const cellStarPairs = resolved
        .map((r) => `${r.cellIndex}:${r.star}`)
        .sort()
        .join('|');
      const pivotPart =
        resolved.length === 3 ? `@${resolved[0].cellIndex}` : '';
      const sig = `${cellStarPairs}${pivotPart}`;

      if (!bySignature.has(sig)) {
        bySignature.set(sig, {
          rotation: rot,
          rotationStepsFromComposer: stepsCW,
          anchorCol: col,
          anchorRow: row,
          placedTiles: resolved,
        });
      }
    }
  }

  return Array.from(bySignature.values());
}

/**
 * Computes the transition reward for a single placement (merges, tier unlocks & chain cascades).
 */
export function evaluateTransitionReward(
  _preBoard: Uint8Array,
  preMaxStar: number,
  sim: SimulationResult
): {
  score: number;
  mergeScore: number;
  tierUnlockBonus: number;
  chainBonus: number;
  lowStarClearBonus: number;
} {
  let mergeScore = 0;
  let lowStarClearBonus = 0;
  const minActiveBefore = getMinActiveSpawnStar(preMaxStar);

  for (const m of sim.merges) {
    // Base merge value: +450 * 1.7^(L - 1), and extra reward if a 5+ tile merge jumps +2★
    const starJump = m.toStar - m.fromStar;
    mergeScore += Math.round(
      450 * Math.pow(1.7, m.fromStar - 1) * (starJump >= 2 ? 2.2 : 1)
    );

    // Over-merge efficiency when clearing endangered or retired low-star tiles
    if (m.fromStar <= minActiveBefore) {
      const clearedCount = m.mergedCells.length;
      lowStarClearBonus += clearedCount * 320;
      if (clearedCount >= 4) {
        lowStarClearBonus += (clearedCount - 3) * 350;
      }
    }
  }

  // First-time Tier Unlock Bonus: strongly rewards advancing past 4★ -> 5★ -> 6★+
  // instead of stalling at 4★ forever!
  const tierUnlockBonus =
    sim.nextMaxStar > preMaxStar
      ? 2400 * (sim.nextMaxStar - preMaxStar)
      : 0;

  const chainBonus =
    sim.maxChainDepth >= 2 ? 650 * (sim.maxChainDepth - 1) : 0;

  return {
    score: mergeScore + tierUnlockBonus + chainBonus + lowStarClearBonus,
    mergeScore,
    tierUnlockBonus,
    chainBonus,
    lowStarClearBonus,
  };
}

/**
 * Checks if any newly placed tile in Ply 1 is immediately walled in with 0 empty neighbors.
 */
function findWalledInPlacedTiles(
  boardAfterPly1: Uint8Array,
  placedTiles: PlacedTile[]
): { cellIndex: number; star: number }[] {
  const neighborsTable = getPrecomputedNeighbors();
  const walledIn: { cellIndex: number; star: number }[] = [];
  const visited = new Uint8Array(25);

  for (const pt of placedTiles) {
    const idx = pt.cellIndex;
    if (visited[idx]) continue;
    const star = boardAfterPly1[idx];
    if (star === 0) continue;

    const comp = getConnectedComponent(boardAfterPly1, idx, neighborsTable);
    for (const c of comp) visited[c] = 1;

    const emptyNeighborSet = new Set<number>();
    for (const c of comp) {
      for (const nb of neighborsTable[c]) {
        if (boardAfterPly1[nb] === 0) {
          emptyNeighborSet.add(nb);
        }
      }
    }

    if (emptyNeighborSet.size === 0) {
      walledIn.push({ cellIndex: idx, star });
    }
  }

  return walledIn;
}

/**
 * Evaluates a terminal board state B, balancing:
 * - Straggler Rescue & Proportional Dead-Space Cost (never paralyzing tier progression!)
 * - Anti-Hoarding & Anti-Fragmentation (never scattering multiple unmerged 4★ pairs across the board!)
 * - All-Shape Placeability Protection (including 3-Triangle `compact3`, `line3`, and `bent3`/`chevron3`)
 * - Walled-In / 0-Neighbor Pocket Prevention
 */
export function evaluateBoardState(
  board: Uint8Array,
  maxUnlockedStar: number,
  initialBoard: Uint8Array,
  initialMaxStar: number
): {
  totalEval: number;
  deadSpacePenalty: number;
  stragglerRescueBonus: number;
  prematureTierUpPenalty: number;
  hoardingAndFragmentationPenalty: number;
  shapeVulnerabilityPenalty: number;
  walledInPenalty: number;
  emptySpaceScore: number;
  mobilityScore: number;
  organizationScore: number;
  deadSpacesCount: number;
  atRiskCount: number;
  trappedRetiredCount: number;
  trappedStarLevel: number | null;
  rescuedStragglersCount: number;
  walledInTiles: { cellIndex: number; star: number }[];
  vulnerableShapes: string[];
  compact3TriangleSlots: number;
  totalThreeTileSlots: number;
} {
  const validIndices = getValidCellIndices();
  const neighborsTable = getPrecomputedNeighbors();
  const minActiveStar = getMinActiveSpawnStar(maxUnlockedStar);
  const initialMinActive = getMinActiveSpawnStar(initialMaxStar);

  // 1. Dead Space & Straggler Analysis (Only penalize & warn for NEWLY created dead spaces on this turn!)
  let deadSpacesCount = 0;
  let preExistingDeadSpacesCount = 0;
  let atRiskCount = 0;
  let trappedRetiredCount = 0;
  let trappedStarLevel: number | null = null;
  const starCountsOnBoard = new Uint8Array(11);

  for (const idx of validIndices) {
    const s0 = initialBoard[idx];
    if (s0 > 0 && s0 < initialMinActive) {
      preExistingDeadSpacesCount++;
    }

    const s = board[idx];
    if (s === 0) continue;
    starCountsOnBoard[s]++;
    if (s < minActiveStar) {
      deadSpacesCount++;
      if (maxUnlockedStar > initialMaxStar && s >= initialMinActive) {
        trappedRetiredCount++;
        if (trappedStarLevel === null || s < trappedStarLevel) {
          trappedStarLevel = s;
        }
      }
    } else if (s === minActiveStar) {
      atRiskCount++;
    }
  }

  // Newly created dead spaces on this move (either from unlocking a new tier M_new > M_0,
  // or from failing to merge a legacy retired tile that was in the piece queue)
  const newlyCreatedDeadSpaces = Math.max(
    0,
    deadSpacesCount - preExistingDeadSpacesCount
  );

  // Count how many endangered/retired tiles (s <= initialMinActive) existed on initialBoard vs now
  let initialEndangeredCount = 0;
  let remainingEndangeredCount = 0;
  for (const idx of validIndices) {
    const s0 = initialBoard[idx];
    if (s0 > 0 && s0 <= initialMinActive) {
      initialEndangeredCount++;
    }
    const sNow = board[idx];
    if (sNow > 0 && sNow <= initialMinActive) {
      remainingEndangeredCount++;
    }
  }

  const rescuedStragglersCount = Math.max(
    0,
    initialEndangeredCount - remainingEndangeredCount
  );

  // Proportional Dead Space Curve applied only to newly created dead spaces:
  let deadSpacePenalty = 0;
  if (newlyCreatedDeadSpaces === 1) {
    deadSpacePenalty = -1400;
  } else if (newlyCreatedDeadSpaces === 2) {
    deadSpacePenalty = -3200;
  } else if (newlyCreatedDeadSpaces >= 3) {
    deadSpacePenalty = -3200 - (newlyCreatedDeadSpaces - 2) * 2400;
  }

  const stragglerRescueBonus = 3500 * rescuedStragglersCount;
  // Additional gentle caution penalty only when trapping 2+ newly retired tiles while board still has plenty of room
  const emptyCells = countEmptyCells(board);
  const prematureTierUpPenalty =
    trappedRetiredCount >= 2 && emptyCells >= 14
      ? -600 * (trappedRetiredCount - 1)
      : 0;

  // 2. Empty Space Preservation, All-Shape Mobility & 3-Triangle Vulnerability Protection
  let emptySpaceScore = emptyCells * 210;
  if (emptyCells < 9) {
    const deficit = 9 - emptyCells;
    emptySpaceScore -= deficit * deficit * 120;
  }

  const shapeMob = analyzeShapeMobility(board);
  const cappedMobility = Math.min(28, shapeMob.totalThreeTileSlots);
  const excessMobility = Math.max(0, shapeMob.totalThreeTileSlots - 28);
  const mobilityScore =
    cappedMobility * 22 +
    excessMobility * 4 +
    Math.min(10, shapeMob.compact3TriangleSlots) * 35;

  // Shape Vulnerability Penalty: heavily penalize board states where 3-Triangle (`compact3`),
  // `line3`, or `bent3` has 0 or 1 valid placement!
  let shapeVulnerabilityPenalty = 0;
  if (shapeMob.compact3TriangleSlots === 0) {
    shapeVulnerabilityPenalty -= 3600;
  } else if (shapeMob.compact3TriangleSlots === 1) {
    shapeVulnerabilityPenalty -= 1200;
  } else if (shapeMob.compact3TriangleSlots === 2) {
    shapeVulnerabilityPenalty -= 450;
  }

  if (shapeMob.line3Slots === 0) {
    shapeVulnerabilityPenalty -= 3600;
  } else if (shapeMob.line3Slots === 1) {
    shapeVulnerabilityPenalty -= 1100;
  }

  if (shapeMob.bentAndChevronSlots === 0) {
    shapeVulnerabilityPenalty -= 4000;
  } else if (shapeMob.bentAndChevronSlots <= 2) {
    shapeVulnerabilityPenalty -= 1100;
  }

  // 3. Walled-In / Trapped Tile Detection, Anti-Hoarding & Anti-Fragmentation
  let walledInPenalty = 0;
  let organizationScore = 0;
  let hoardingAndFragmentationPenalty = 0;
  const visitedComp = new Uint8Array(25);
  const walledInTiles: { cellIndex: number; star: number }[] = [];

  const compSizeByCell = new Uint8Array(25);
  const compEmptyNeighborsByCell = new Uint8Array(25);
  const islandsByStar = new Map<
    number,
    { size: number; emptyNeighbors: number }[]
  >();

  for (const idx of validIndices) {
    const star = board[idx];
    if (star === 0 || visitedComp[idx]) continue;

    const comp = getConnectedComponent(board, idx, neighborsTable);
    const emptyNeighborSet = new Set<number>();
    let hasLowerOneNeighbor = false;

    for (const c of comp) {
      visitedComp[c] = 1;
      for (const nb of neighborsTable[c]) {
        const nbStar = board[nb];
        if (nbStar === 0) {
          emptyNeighborSet.add(nb);
        } else if (nbStar === star - 1) {
          hasLowerOneNeighbor = true;
        }
      }
    }

    const emptyNeighborCount = emptyNeighborSet.size;
    for (const c of comp) {
      compSizeByCell[c] = comp.length;
      compEmptyNeighborsByCell[c] = emptyNeighborCount;
    }

    const list = islandsByStar.get(star) ?? [];
    list.push({ size: comp.length, emptyNeighbors: emptyNeighborCount });
    islandsByStar.set(star, list);

    // Check if this unmerged ACTIVE component (length 1 or 2, star >= minActiveStar) has ZERO empty neighbors
    if (emptyNeighborCount === 0 && star >= minActiveStar) {
      // Only flag as newly walled-in if it wasn't already walled-in on initialBoard
      let wasAlreadyWalledIn = initialBoard[idx] === star;
      if (wasAlreadyWalledIn) {
        const initComp = getConnectedComponent(
          initialBoard,
          idx,
          neighborsTable
        );
        for (const ic of initComp) {
          for (const nb of neighborsTable[ic]) {
            if (initialBoard[nb] === 0) {
              wasAlreadyWalledIn = false;
              break;
            }
          }
        }
      }
      if (!wasAlreadyWalledIn) {
        for (const c of comp) {
          walledInTiles.push({ cellIndex: c, star });
        }
        if (!hasLowerOneNeighbor) {
          walledInPenalty -= 2400 * comp.length;
        } else {
          walledInPenalty -= 950 * comp.length;
        }
      }
    } else if (comp.length === 1 && star >= minActiveStar) {
      if (emptyNeighborCount === 1 && star < maxUnlockedStar) {
        walledInPenalty -= 360;
      } else if (emptyNeighborCount >= 3) {
        organizationScore += 55;
      }
    }
  }

  // Evaluate Same-Star Pairing & Island Fragmentation per Star Level
  for (const [star, islands] of islandsByStar.entries()) {
    // Sort islands so the best 2-tile pair with open neighbors comes first
    islands.sort(
      (a, b) =>
        b.size - a.size || b.emptyNeighbors - a.emptyNeighbors
    );

    // Only award the Ready Pair Bonus to the SINGLE best 2-tile pair of this star level!
    // (Prevents the solver from creating 3 separate 4★-4★ pairs in different corners!)
    const bestIsland = islands[0];
    if (bestIsland.size === 2 && bestIsland.emptyNeighbors > 0) {
      const pairBonus =
        bestIsland.emptyNeighbors >= 2
          ? Math.round(420 * Math.pow(1.2, star - 1))
          : Math.round(280 * Math.pow(1.2, star - 1));
      organizationScore += pairBonus;
    }

    // Penalize having multiple disconnected islands of the SAME star level (especially for 3★, 4★+)
    if (islands.length > 1) {
      const extraIslands = islands.length - 1;
      const perIslandPen =
        star >= 3
          ? Math.round(360 * Math.pow(1.35, star - 2))
          : 140;
      hoardingAndFragmentationPenalty -= extraIslands * perIslandPen;
    }
  }

  // Penalize hoarding 3+ unmerged tiles of the current max unlocked tier (e.g. hoarding 3, 4, 5+ 4★ tiles instead of merging to 5★!)
  const unmergedMaxStarCount = starCountsOnBoard[initialMaxStar];
  if (unmergedMaxStarCount >= 3) {
    hoardingAndFragmentationPenalty -=
      (unmergedMaxStarCount - 2) * 1050;
  }

  // Sequential Tier Adjacency (Upgrade Gradient: L adjacent to L+1)
  for (const idx of validIndices) {
    const star = board[idx];
    if (star === 0) continue;

    if (compEmptyNeighborsByCell[idx] > 0) {
      for (const nb of neighborsTable[idx]) {
        if (board[nb] === star + 1) {
          const lowerIsPair = compSizeByCell[idx] === 2;
          const upperIsPair = compSizeByCell[nb] === 2;
          if (lowerIsPair && upperIsPair) {
            organizationScore += 220;
          } else if (lowerIsPair) {
            organizationScore += 130;
          } else {
            organizationScore += 40;
          }
        }
      }
    }

    // High-Tier Anchor Perimeter Preference (only for the 1st island of maxUnlockedStar)
    if (
      star >= maxUnlockedStar &&
      compEmptyNeighborsByCell[idx] > 0 &&
      (islandsByStar.get(star)?.length ?? 0) === 1
    ) {
      const { col, row } = indexToCoord(idx);
      const maxRow = getColumnRowCount(col) - 1;
      const isPerimeter = col === 0 || col === 4 || row === 0 || row === maxRow;
      const isCenterHub = col === 2 && row === 2;
      if (isPerimeter) {
        organizationScore += 65;
      } else if (isCenterHub) {
        organizationScore -= 70;
      }
    }
  }

  // Check for "1-Tile Bridge" setups: two separate components of the same star level L
  // that share an empty neighbor cell (so a single L★ tile placed on that empty cell merges them!)
  for (const idx of validIndices) {
    if (board[idx] !== 0) continue;
    const neighborStars = new Map<number, number>();
    for (const nb of neighborsTable[idx]) {
      const s = board[nb];
      if (s > 0) {
        neighborStars.set(s, (neighborStars.get(s) ?? 0) + 1);
      }
    }
    for (const [star, count] of neighborStars.entries()) {
      if (count >= 2) {
        organizationScore += Math.round(160 * Math.pow(1.2, star - 1));
      }
    }
  }

  const totalEval =
    deadSpacePenalty +
    stragglerRescueBonus +
    prematureTierUpPenalty +
    hoardingAndFragmentationPenalty +
    shapeVulnerabilityPenalty +
    walledInPenalty +
    emptySpaceScore +
    mobilityScore +
    organizationScore;

  return {
    totalEval,
    deadSpacePenalty,
    stragglerRescueBonus,
    prematureTierUpPenalty,
    hoardingAndFragmentationPenalty,
    shapeVulnerabilityPenalty,
    walledInPenalty,
    emptySpaceScore,
    mobilityScore,
    organizationScore,
    deadSpacesCount,
    atRiskCount,
    trappedRetiredCount,
    trappedStarLevel,
    rescuedStragglersCount,
    walledInTiles,
    vulnerableShapes: shapeMob.vulnerableShapes,
    compact3TriangleSlots: shapeMob.compact3TriangleSlots,
    totalThreeTileSlots: shapeMob.totalThreeTileSlots,
  };
}

function buildRotationInstruction(
  shapeId: PieceConfig['shapeId'],
  targetRotation: number,
  composerRotation: number
): string {
  const shapeSpec = PIECE_SHAPES[shapeId];
  if (shapeId === 'single') {
    return 'No rotation needed (Single Tile)';
  }
  const stepsCW = (targetRotation - composerRotation + 6) % 6;
  const label = shapeSpec.rotationLabels[targetRotation];
  if (stepsCW === 0) {
    return `Keep current rotation — ${label}`;
  }
  if (stepsCW <= 3) {
    return `Rotate ${stepsCW}x CW (↻ ${stepsCW * 60}°) → ${label}`;
  }
  const stepsCCW = 6 - stepsCW;
  return `Rotate ${stepsCCW}x CCW (↺ ${stepsCCW * 60}° / or ${stepsCW}x CW) → ${label}`;
}

/**
 * Runs the 2-Ply Lookahead Solver (Current Piece -> Next Piece) across all valid placements
 * and rotations, returning ranked candidate moves.
 */
export function solveBestMoves(
  board: Uint8Array,
  maxUnlockedStar: number,
  currentPiece: PieceConfig,
  nextPiece: PieceConfig,
  nextPieceKnown: boolean,
  landingOverrides?: Record<string, number>,
  fiveTileSuperMerge: boolean = true
): {
  candidates: CandidateMove[];
  topRecommendations: CandidateMove[];
  lethalMoves: CandidateMove[];
  elapsedMs: number;
} {
  const startTime = performance.now();
  const emptyCellsBefore = countEmptyCells(board);
  const ply1Placements = generateValidPlacements(board, currentPiece);

  const candidates: CandidateMove[] = [];

  for (const p1 of ply1Placements) {
    const moveId = `rot${p1.rotation}-c${p1.anchorCol}-r${p1.anchorRow}`;
    const preferredLanding = landingOverrides?.[moveId];

    const ply1Sim = simulatePlacement(
      board,
      maxUnlockedStar,
      p1.placedTiles,
      preferredLanding,
      fiveTileSuperMerge
    );

    const ply1Trans = evaluateTransitionReward(board, maxUnlockedStar, ply1Sim);
    const ply1WalledIn = findWalledInPlacedTiles(
      ply1Sim.nextBoard,
      p1.placedTiles
    );
    const ply1ImmediateTrapPenalty = ply1WalledIn.length * -1200;

    const emptyCellsAfterPly1 = countEmptyCells(ply1Sim.nextBoard);

    let bestPly2: Ply2Continuation | null = null;
    let isLethal = false;
    let totalScore = 0;
    let ply2ContinuationScore = 0;
    let terminalEval = evaluateBoardState(
      ply1Sim.nextBoard,
      ply1Sim.nextMaxStar,
      board,
      maxUnlockedStar
    );
    let emptyCellsAfterPly2 = emptyCellsAfterPly1;
    let threeTileMobilityAfter = terminalEval.totalThreeTileSlots;

    if (nextPieceKnown) {
      const ply2Placements = generateValidPlacements(
        ply1Sim.nextBoard,
        nextPiece
      );

      if (ply2Placements.length === 0) {
        isLethal = true;
        ply2ContinuationScore = -1000000;
        totalScore =
          ply1Trans.score + ply1ImmediateTrapPenalty + ply2ContinuationScore;
      } else {
        const ply2Scores: number[] = [];
        let bestPly2Eval = terminalEval;

        for (const p2 of ply2Placements) {
          const ply2Sim = simulatePlacement(
            ply1Sim.nextBoard,
            ply1Sim.nextMaxStar,
            p2.placedTiles,
            undefined,
            fiveTileSuperMerge
          );
          const ply2Trans = evaluateTransitionReward(
            ply1Sim.nextBoard,
            ply1Sim.nextMaxStar,
            ply2Sim
          );
          const boardEval = evaluateBoardState(
            ply2Sim.nextBoard,
            ply2Sim.nextMaxStar,
            board,
            maxUnlockedStar
          );

          const combinedPly2 = ply2Trans.score + boardEval.totalEval;
          ply2Scores.push(combinedPly2);

          if (!bestPly2 || combinedPly2 > bestPly2.totalPly2Score) {
            bestPly2 = {
              rotation: p2.rotation,
              rotationStepsFromComposer: p2.rotationStepsFromComposer,
              rotationDescription: buildRotationInstruction(
                nextPiece.shapeId,
                p2.rotation,
                nextPiece.rotation
              ),
              anchorCol: p2.anchorCol,
              anchorRow: p2.anchorRow,
              placedTiles: p2.placedTiles,
              sim: ply2Sim,
              transitionScore: ply2Trans.score,
              boardEvalScore: boardEval.totalEval,
              totalPly2Score: combinedPly2,
            };
            bestPly2Eval = boardEval;
          }
        }

        // Robustness blend: 92% best continuation + 8% average of top-5 continuations
        ply2Scores.sort((a, b) => b - a);
        const topK = ply2Scores.slice(0, Math.min(5, ply2Scores.length));
        const avgTopK = topK.reduce((s, v) => s + v, 0) / topK.length;

        ply2ContinuationScore = Math.round(
          0.92 * bestPly2!.totalPly2Score + 0.08 * avgTopK
        );
        totalScore =
          ply1Trans.score + ply1ImmediateTrapPenalty + ply2ContinuationScore;
        terminalEval = bestPly2Eval;
        emptyCellsAfterPly2 = countEmptyCells(bestPly2!.sim.nextBoard);
        threeTileMobilityAfter = terminalEval.totalThreeTileSlots;
      }
    } else {
      totalScore =
        ply1Trans.score + ply1ImmediateTrapPenalty + terminalEval.totalEval;
      ply2ContinuationScore = terminalEval.totalEval;
    }

    // Build human-readable warnings, highlights & strategic tag
    const warnings: string[] = [];
    const highlights: string[] = [];

    if (isLethal) {
      warnings.push(
        'LETHAL MOVE: Leaves zero valid placement spaces for the Next Piece (Immediate Game Over)!'
      );
    }

    if (terminalEval.vulnerableShapes.length > 0) {
      warnings.push(
        `⚠️ Shape Vulnerability: ${terminalEval.vulnerableShapes.join(', ')} on resulting board!`
      );
    }

    if (ply1WalledIn.length > 0) {
      const coords = ply1WalledIn
        .map((w) => {
          const { col, row } = indexToCoord(w.cellIndex);
          return `${w.star}★ at ${formatCellCoord(col, row)}`;
        })
        .join(', ');
      warnings.push(
        `⚠️ Traps ${coords} with 0 open neighbor spots (walled in by existing tiles)!`
      );
    } else if (terminalEval.walledInTiles.length > 0) {
      const coords = terminalEval.walledInTiles
        .map((w) => {
          const { col, row } = indexToCoord(w.cellIndex);
          return `${w.star}★ at ${formatCellCoord(col, row)}`;
        })
        .join(', ');
      warnings.push(`⚠️ Leaves ${coords} walled in with 0 open neighbor spots.`);
    }

    const finalMaxStar = bestPly2
      ? bestPly2.sim.nextMaxStar
      : ply1Sim.nextMaxStar;

    if (
      terminalEval.trappedRetiredCount > 0 &&
      terminalEval.trappedStarLevel !== null
    ) {
      warnings.push(
        `⚠️ Unlocking ★${finalMaxStar} traps ${terminalEval.trappedRetiredCount}x ★${terminalEval.trappedStarLevel} as dead space (acceptable if clearing board congestion).`
      );
    }

    if (ply1Sim.maxChainDepth >= 2) {
      const chainPath = [
        `${ply1Sim.merges[0].fromStar}★`,
        ...ply1Sim.merges.map((m) => `${m.toStar}★`),
      ].join(' → ');
      highlights.push(
        `Immediate ${ply1Sim.maxChainDepth}-Step Chain Cascade (${chainPath})!`
      );
    } else if (ply1Sim.merges.length > 0) {
      const mergeDesc = ply1Sim.merges
        .map((m) => `${m.mergedCells.length}x ${m.fromStar}★ → ${m.toStar}★`)
        .join(', ');
      highlights.push(`Immediate Merge: ${mergeDesc}`);
    }

    if (bestPly2 && bestPly2.sim.merges.length > 0) {
      const ply2Chain =
        bestPly2.sim.maxChainDepth >= 2
          ? `${bestPly2.sim.maxChainDepth}-step chain (${bestPly2.sim.merges[0].fromStar}★ → ${bestPly2.sim.merges[bestPly2.sim.merges.length - 1].toStar}★)`
          : bestPly2.sim.merges
              .map(
                (m) => `${m.mergedCells.length}x ${m.fromStar}★ → ${m.toStar}★`
              )
              .join(', ');
      highlights.push(`Next Piece Follow-Up: ${ply2Chain}`);
    }

    if (terminalEval.rescuedStragglersCount > 0) {
      const minActive0 = Math.max(1, maxUnlockedStar - 3);
      highlights.push(
        `Rescues ${terminalEval.rescuedStragglersCount}x endangered/retired (${minActive0}★ or lower) straggler tile(s)!`
      );
    }

    // Determine primary Strategic Tag
    let strategicTag: CandidateMove['strategicTag'];
    if (isLethal) {
      strategicTag = {
        label: '💀 Lethal Move (Blocks Next Piece)',
        tone: 'lethal',
      };
    } else if (
      terminalEval.rescuedStragglersCount > 0 &&
      ply1Sim.maxChainDepth >= 2
    ) {
      const firstFrom = ply1Sim.merges[0].fromStar;
      const lastTo = ply1Sim.merges[ply1Sim.merges.length - 1].toStar;
      strategicTag = {
        label: `🔥 Chain (${firstFrom}★ → ${lastTo}★) + 🛡️ Straggler Rescue`,
        tone: 'chain',
      };
    } else if (ply1Sim.unlockedNewMaxTier) {
      strategicTag = {
        label: `🚀 Unlocks New Tier ${ply1Sim.nextMaxStar}★!`,
        tone: 'chain',
      };
    } else if (terminalEval.rescuedStragglersCount > 0) {
      const minActive0 = Math.max(1, maxUnlockedStar - 3);
      strategicTag = {
        label: `🛡️ Rescues ${terminalEval.rescuedStragglersCount}x Low-Star (${minActive0}★) Straggler`,
        tone: 'rescue',
      };
    } else if (ply1Sim.maxChainDepth >= 2) {
      const chainStr = [
        `${ply1Sim.merges[0].fromStar}★`,
        ...ply1Sim.merges.map((m) => `${m.toStar}★`),
      ].join(' → ');
      strategicTag = {
        label: `🔥 Chain Cascade (${chainStr})`,
        tone: 'chain',
      };
    } else if (bestPly2 && bestPly2.sim.maxChainDepth >= 2) {
      const chainStr = [
        `${bestPly2.sim.merges[0].fromStar}★`,
        ...bestPly2.sim.merges.map((m) => `${m.toStar}★`),
      ].join(' → ');
      strategicTag = {
        label: `📐 Sets Up Next-Turn Chain (${chainStr})`,
        tone: 'chain',
      };
    } else if (
      terminalEval.trappedRetiredCount > 0 &&
      terminalEval.trappedStarLevel !== null
    ) {
      strategicTag = {
        label: `⚠️ Unlocks ${finalMaxStar}★ (${terminalEval.trappedRetiredCount}x ${terminalEval.trappedStarLevel}★ Stranded)`,
        tone: 'warning',
      };
    } else if (ply1WalledIn.length > 0) {
      strategicTag = {
        label: `⚠️ Traps Tile in 0-Neighbor Pocket`,
        tone: 'warning',
      };
    } else if (ply1Sim.merges.length > 0) {
      const m0 = ply1Sim.merges[0];
      strategicTag = {
        label: `✨ Clean Merge (${m0.mergedCells.length}x ${m0.fromStar}★ → ${m0.toStar}★)`,
        tone: 'merge',
      };
    } else if (bestPly2 && bestPly2.sim.merges.length > 0) {
      const m0 = bestPly2.sim.merges[0];
      strategicTag = {
        label: `📐 Best Setup for Next Piece (${m0.fromStar}★ → ${m0.toStar}★)`,
        tone: 'setup',
      };
    } else {
      strategicTag = {
        label: `📐 Pair & Chain Pipeline Setup (${emptyCellsAfterPly2} open cells)`,
        tone: 'setup',
      };
    }

    const scoreBreakdown: { label: string; value: number }[] = [
      { label: 'Ply-1 Merge & Tier Unlock Reward', value: ply1Trans.score },
    ];
    if (nextPieceKnown && bestPly2) {
      scoreBreakdown.push({
        label: 'Ply-2 Next Piece Merge Reward',
        value: bestPly2.transitionScore,
      });
    }
    if (terminalEval.stragglerRescueBonus !== 0) {
      scoreBreakdown.push({
        label: 'Straggler Rescue Bonus',
        value: terminalEval.stragglerRescueBonus,
      });
    }
    if (terminalEval.deadSpacePenalty !== 0) {
      scoreBreakdown.push({
        label: 'Proportional Dead Space Cost',
        value: terminalEval.deadSpacePenalty,
      });
    }
    if (terminalEval.hoardingAndFragmentationPenalty !== 0) {
      scoreBreakdown.push({
        label: 'High-Tier Hoarding / Fragmentation Penalty',
        value: terminalEval.hoardingAndFragmentationPenalty,
      });
    }
    if (terminalEval.shapeVulnerabilityPenalty !== 0) {
      scoreBreakdown.push({
        label: 'Shape Vulnerability Penalty (3-Triangle / Line)',
        value: terminalEval.shapeVulnerabilityPenalty,
      });
    }
    if (
      ply1ImmediateTrapPenalty !== 0 ||
      terminalEval.walledInPenalty !== 0
    ) {
      scoreBreakdown.push({
        label: 'Walled-In / 0-Neighbor Trap Penalty',
        value: ply1ImmediateTrapPenalty + terminalEval.walledInPenalty,
      });
    }
    scoreBreakdown.push({
      label: 'Pair Adjacency & Chain Pipeline',
      value: terminalEval.organizationScore,
    });
    scoreBreakdown.push({
      label: 'Empty Space & Scarcity Score',
      value: terminalEval.emptySpaceScore,
    });
    scoreBreakdown.push({
      label: 'All-Shape Mobility (incl. 3-Triangle)',
      value: terminalEval.mobilityScore,
    });

    candidates.push({
      id: moveId,
      rotation: p1.rotation,
      rotationStepsFromComposer: p1.rotationStepsFromComposer,
      rotationDescription: buildRotationInstruction(
        currentPiece.shapeId,
        p1.rotation,
        currentPiece.rotation
      ),
      anchorCol: p1.anchorCol,
      anchorRow: p1.anchorRow,
      placedTiles: p1.placedTiles,
      ply1Sim,
      bestPly2,
      totalScore,
      ply1TransitionScore: ply1Trans.score,
      ply2ContinuationScore,
      isLethal,
      trapsRetiredTilesCount: terminalEval.trappedRetiredCount,
      trappedStarLevel: terminalEval.trappedStarLevel,
      rescuedStragglersCount: terminalEval.rescuedStragglersCount,
      deadSpacesAfter: terminalEval.deadSpacesCount,
      atRiskSpacesAfter: terminalEval.atRiskCount,
      emptyCellsBefore,
      emptyCellsAfterPly1,
      emptyCellsAfterPly2,
      threeTileMobilityAfter,
      strategicTag,
      warnings,
      highlights,
      scoreBreakdown,
    });
  }

  candidates.sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    return a.rotationStepsFromComposer - b.rotationStepsFromComposer;
  });

  const nonLethal = candidates.filter((c) => !c.isLethal);
  const lethalMoves = candidates.filter((c) => c.isLethal);
  const pool = nonLethal.length > 0 ? nonLethal : candidates;
  const topRecommendations = pool.slice(0, 3);

  // Infographic Columns 3 & 4 Strategy ("Wait 1 Turn to Clear Stragglers"):
  // If the #1 move unlocks a new tier while stranding a retiring tile (`trapsRetiredTilesCount > 0`),
  // ensure that at least one of the Top 3 Recommendation cards is the highest-scoring
  // "Wait / Delay Tier-Up" move (`trapsRetiredTilesCount === 0`) so the player can choose whether to wait!
  if (
    topRecommendations.length === 3 &&
    topRecommendations.every((m) => m.trapsRetiredTilesCount > 0)
  ) {
    const bestWaitMove = pool.find((m) => m.trapsRetiredTilesCount === 0);
    if (bestWaitMove) {
      topRecommendations[2] = {
        ...bestWaitMove,
        strategicTag: {
          label: `⏳ Wait Option: Keep Window Open (0 Stranded)`,
          tone: 'setup',
        },
      };
    }
  }

  const elapsedMs = Math.round((performance.now() - startTime) * 10) / 10;

  return {
    candidates,
    topRecommendations,
    lethalMoves,
    elapsedMs,
  };
}

export function formatPlacedTilesSummary(placedTiles: PlacedTile[]): string {
  return placedTiles
    .map((pt) => `${formatCellCoord(pt.col, pt.row)} (${pt.star}★)`)
    .join(', ');
}
