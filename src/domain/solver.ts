import {
  BlueprintProgress,
  CandidateMove,
  HammerAdvice,
  HammerCandidateTarget,
  PieceConfig,
  PlacedTile,
  Ply2Continuation,
  SimulationResult,
  StarAdvice,
  StarCandidateTarget,
} from '../types/forge';
import {
  getMinActiveSpawnStar,
  MAX_HAMMERS,
  MAX_RUN_PLACEMENTS,
  MAX_STAR_UPGRADE_TARGET_GRADE,
  PIECE_SHAPES,
  RELIC_SPECS,
} from './constants';
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
  simulateStarUpgrade,
} from './simulator';

export function normalizeHammerCount(
  hammersAvailable: number | boolean = 1
): number {
  const raw =
    typeof hammersAvailable === 'boolean'
      ? hammersAvailable
        ? 1
        : 0
      : hammersAvailable;
  return Math.max(0, Math.min(MAX_HAMMERS, Math.floor(raw)));
}

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
        row,
        piece.anchorTileIndex
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

      // Build canonical signature: sorted cellIndex:star plus anchor cell (when piece has duplicate stars)
      const cellStarPairs = resolved
        .map((r) => `${r.cellIndex}:${r.star}`)
        .sort()
        .join('|');
      const explicitAnchor = resolved.find((r) => r.isAnchor);
      const hasDuplicateAnchorStar =
        explicitAnchor !== undefined &&
        resolved.filter((r) => r.star === explicitAnchor.star).length >= 2;
      const pivotPart =
        explicitAnchor && hasDuplicateAnchorStar
          ? `@A${explicitAnchor.cellIndex}`
          : resolved.length === 3
          ? `@${resolved[0].cellIndex}`
          : '';
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
 * Computes the transition reward for a single placement (merges, tier unlocks, 5+ hammer earn & chain cascades).
 */
export function evaluateTransitionReward(
  _preBoard: Uint8Array,
  preMaxStar: number,
  sim: SimulationResult,
  currentHammers: number = 1
): {
  score: number;
  mergeScore: number;
  tierUnlockBonus: number;
  chainBonus: number;
  lowStarClearBonus: number;
  hammerEarnBonus: number;
  blueprintAnchorBonus: number;
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

    // Extra bonus when a merge creates a 10★ relic (which disappears from the board and is marked as achieved!)
    if (m.toStar === 10) {
      // 5-relic super-merge jumping +2★ directly from 8★ -> 10★ is the Grand Finale of the Master Blueprint!
      mergeScore += starJump >= 2 ? 14000 : 4500;
    }

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

  // Extra Hammer Bonus: Merging 5+ relics awards +1 Hammer (up to a maximum of 2 Hammers)
  let hammerEarnBonus = 0;
  if (sim.hammersEarned > 0) {
    const clampedCurrent = normalizeHammerCount(currentHammers);
    const effectiveGained = Math.max(
      0,
      Math.min(MAX_HAMMERS, clampedCurrent + sim.hammersEarned) - clampedCurrent
    );
    if (effectiveGained > 0) {
      // Replenishing 0 -> 1 is life-saving (+12000); stocking up 1 -> 2 reaches maximum tactical reserve (+11000)
      hammerEarnBonus =
        clampedCurrent === 0
          ? effectiveGained * 12000
          : effectiveGained * 11000;
    } else {
      // Already capped at 2/2 hammers, but still reward 5+ relic super-merges (+2★ jump)
      hammerEarnBonus = sim.hammersEarned * 1500;
    }
  }

  // Master Blueprint Center Anchor Landing Bonus:
  // When a 5+ super-merge occurs, landing the resulting relic at row 2 of outer columns
  // (A3 or E3) or center column (C3) matches the optimal anchor positioning from the guide!
  let blueprintAnchorBonus = 0;
  for (const m of sim.merges) {
    if (m.mergedCells.length >= 5) {
      const { col: landCol, row: landRow } = indexToCoord(m.landingCell);
      if ((landCol === 0 || landCol === 4) && landRow === 2) {
        // Outer column center anchor (A3 or E3)
        blueprintAnchorBonus += 3200;
      } else if (landCol === 2 && (landRow === 2 || landRow === 3)) {
        // Center spine climax anchor (C3 or C4)
        blueprintAnchorBonus += 3600;
      }
    }
  }

  return {
    score:
      mergeScore +
      tierUnlockBonus +
      chainBonus +
      lowStarClearBonus +
      hammerEarnBonus +
      blueprintAnchorBonus,
    mergeScore,
    tierUnlockBonus,
    chainBonus,
    lowStarClearBonus,
    hammerEarnBonus,
    blueprintAnchorBonus,
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
  initialMaxStar: number,
  hammersAvailable: number | boolean = 1,
  queueStars: number[] = [],
  cachedInitialShapeMob?: ReturnType<typeof analyzeShapeMobility>
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
  perimeterStackBonus: number;
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

  // Count initial board stars and unplaced queue stars so we know if a retired tile on initialBoard
  // is still rescueable during this turn!
  const initialStarCounts = new Uint8Array(11);
  for (const idx of validIndices) {
    const s0 = initialBoard[idx];
    if (s0 > 0) initialStarCounts[s0]++;
  }
  const queueStarCounts = new Uint8Array(11);
  for (const qs of queueStars) {
    if (qs >= 1 && qs <= 10) queueStarCounts[qs]++;
  }

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
      // Only treat as pre-existing dead space if it CANNOT be rescued by the current piece queue!
      const canRescueFromQueue = initialStarCounts[s0] + queueStarCounts[s0] >= 3;
      if (!canRescueFromQueue) {
        preExistingDeadSpacesCount++;
      }
    }

    const s = board[idx];
    if (s === 0) continue;
    starCountsOnBoard[s]++;
    if (s < minActiveStar) {
      deadSpacesCount++;
      if (
        (maxUnlockedStar > initialMaxStar && s >= initialMinActive) ||
        (s < initialMinActive && initialStarCounts[s] + queueStarCounts[s] >= 3)
      ) {
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
  // or from failing to merge a rescueable retired tile that was in the piece queue)
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

  const emptyCells = countEmptyCells(board);
  const emptyCellsBefore = countEmptyCells(initialBoard);
  const initialShapeMob =
    cachedInitialShapeMob ?? analyzeShapeMobility(initialBoard);

  // Scale dead-space penalty and straggler-rescue bonus with the tier level (1.7^L) so high-tier
  // merges (6★ -> 7★, 6★ -> 8★, 7★ -> 8★) never dwarf the cost of leaving dead relics behind!
  const tierScale = Math.pow(1.75, Math.max(0, maxUnlockedStar - 4));
  const rescueScale = Math.pow(1.65, Math.max(0, initialMaxStar - 4));

  // Detect whether the initial board is in a true survival/congestion emergency
  const isSurvivalEmergency =
    emptyCellsBefore <= 7 ||
    (initialShapeMob.compact3TriangleSlots === 0 && emptyCellsBefore <= 11) ||
    initialShapeMob.totalThreeTileSlots <= 6;

  const hammerCount = normalizeHammerCount(hammersAvailable);
  const hammerAvailable = hammerCount > 0;
  let deadSpacePenalty = 0;
  let prematureTierUpPenalty = 0;

  if (newlyCreatedDeadSpaces > 0) {
    if (!hammerAvailable) {
      // NO HAMMER LEFT currently (though a 5+ merge could earn one later):
      // Strongly avoid merges that leave dead relics on the board unless the board is in a survival emergency.
      if (isSurvivalEmergency) {
        deadSpacePenalty =
          -Math.round(1100 * tierScale) * newlyCreatedDeadSpaces;
      } else {
        deadSpacePenalty =
          -Math.round(5500 * tierScale) * newlyCreatedDeadSpaces;
        if (trappedRetiredCount > 0) {
          prematureTierUpPenalty =
            -Math.round(4500 * tierScale) * trappedRetiredCount;
        }
      }
    } else {
      // HAMMER(S) AVAILABLE (1 or 2 held, max 2):
      // Even with a hammer available, scale penalty with tierScale so high-tier merges (7★, 8★)
      // stay proportional, and penalize harder when 2+ dead spaces are created on an open board.
      const singleDeadBase = hammerCount >= 2 ? 1050 : 1400;
      if (newlyCreatedDeadSpaces === 1) {
        deadSpacePenalty = -Math.round(singleDeadBase * tierScale);
      } else if (newlyCreatedDeadSpaces === 2) {
        deadSpacePenalty = -Math.round(3200 * tierScale);
      } else {
        deadSpacePenalty = -Math.round(
          (3200 + (newlyCreatedDeadSpaces - 2) * 2400) * tierScale
        );
      }

      if (trappedRetiredCount >= 2 && emptyCells >= 14) {
        prematureTierUpPenalty =
          -Math.round(600 * tierScale) * (trappedRetiredCount - 1);
      }
    }
  }

  const stragglerRescueBonus = Math.round(
    3500 *
      rescueScale *
      (hammerAvailable ? 1.0 : 1.5) *
      rescuedStragglersCount
  );

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
    { size: number; emptyNeighbors: number; cells: number[] }[]
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
    list.push({ size: comp.length, emptyNeighbors: emptyNeighborCount, cells: comp });
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
    // EXCEPTION: If star >= 5 and the islands are co-located in the same outer column (Col 0 or Col 4),
    // they are intentionally staged for a 5-relic column super-merge (Guide Blueprint), NOT fragmented hoarding!
    // Also, 8★ tiles being assembled for the 10★ Climax (Phase 4) are exempt from fragmentation penalties.
    if (islands.length > 1 && star !== 8) {
      let penalizableExtraIslands = 0;
      for (let i = 1; i < islands.length; i++) {
        const island = islands[i];
        // Check if all cells of this island share an outer column with the first island
        const islandCols = new Set(island.cells.map((c) => indexToCoord(c).col));
        const firstCols = new Set(bestIsland.cells.map((c) => indexToCoord(c).col));
        const isCoLocatedInOuterCol =
          star >= 5 &&
          islandCols.size === 1 &&
          firstCols.size === 1 &&
          ((islandCols.has(0) && firstCols.has(0)) || (islandCols.has(4) && firstCols.has(4)));
        if (!isCoLocatedInOuterCol) {
          penalizableExtraIslands++;
        }
      }
      if (penalizableExtraIslands > 0) {
        const perIslandPen =
          star >= 3
            ? Math.round(360 * Math.pow(1.35, star - 2))
            : 140;
        hoardingAndFragmentationPenalty -= penalizableExtraIslands * perIslandPen;
      }
    }
  }

  // Penalize hoarding 3+ unmerged tiles of the current max unlocked tier (e.g. hoarding 3, 4, 5+ 4★ tiles instead of merging to 5★!)
  // EXCEPTION: High-tier tiles (M >= 6★) staged in outer columns (Col 0/4) or 8★ tiles prepared for 10★
  // are deliberately staged for 5-relic super-merges and should not be penalized as hoarding.
  let unmergedMaxStarCount = starCountsOnBoard[initialMaxStar];
  if (initialMaxStar >= 6 && unmergedMaxStarCount >= 3) {
    let outerStagedMaxStar = 0;
    for (const idx of validIndices) {
      if (board[idx] === initialMaxStar) {
        const { col } = indexToCoord(idx);
        if (col === 0 || col === 4) outerStagedMaxStar++;
      }
    }
    unmergedMaxStarCount = Math.max(0, unmergedMaxStarCount - outerStagedMaxStar);
  }
  if (unmergedMaxStarCount >= 3 && initialMaxStar !== 8) {
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

  // 4. Master Blueprint: Perimeter 5-Stack Staging & 8★ Center Climax
  // Evaluates deliberate staging in Column A (col 0) and Column E (col 4) for 5-relic super-merges
  let perimeterStackBonus = 0;
  for (const outerCol of [0, 4]) {
    const starInColCounts = new Uint8Array(11);
    for (let r = 0; r < 5; r++) {
      const idx = outerCol * 5 + r;
      const s = board[idx];
      if (s > 0) starInColCounts[s]++;
    }

    for (let s = 5; s <= 9; s++) {
      const count = starInColCounts[s];
      if (count >= 2) {
        // Progressive bonus for assembling 2, 3, or 4 tiles in the outer column
        const baseBonus = count === 2 ? 450 : count === 3 ? 1100 : 2200;
        const tierMultiplier = s >= 6 ? 1.3 : 1.0;
        perimeterStackBonus += Math.round(baseBonus * tierMultiplier);

        // Center Anchor Preservation: If row 2 (A3 or E3) is open, it provides the perfect anchor drop slot!
        const anchorIdx = outerCol * 5 + 2;
        if (board[anchorIdx] === 0) {
          perimeterStackBonus += 400;
        }

        // End-First Staging: Rewarding having row 0 (A1/E1) and row 4 (A5/E5) occupied first
        const topIdx = outerCol * 5 + 0;
        const botIdx = outerCol * 5 + 4;
        if (board[topIdx] === s && board[botIdx] === s) {
          perimeterStackBonus += 350;
        }
      }
    }
  }

  // Phase 4: Center Climax Surround Setup (8★ relics clustered around C3/C4)
  const count8 = starCountsOnBoard[8];
  if (count8 >= 2) {
    // Reward 8★ relics positioned at flank / surround coordinates (B3, B4, C5, D3, D4, C3, C4)
    const climaxCells = [
      1 * 5 + 2, // B3
      1 * 5 + 3, // B4
      2 * 5 + 4, // C5
      3 * 5 + 2, // D3
      3 * 5 + 3, // D4
      2 * 5 + 2, // C3
      2 * 5 + 3, // C4
    ];
    let climaxClusterCount = 0;
    for (const cIdx of climaxCells) {
      if (board[cIdx] === 8) climaxClusterCount++;
    }
    if (climaxClusterCount >= 2) {
      perimeterStackBonus += climaxClusterCount * 600;
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
    organizationScore +
    perimeterStackBonus;

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
    perimeterStackBonus,
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
 * Analyzes the current board to determine which phase of the Master Endgame Blueprint
 * (Column A 5-Stack -> Column E 5-Stack -> Flank Anchors -> Center 10★ Climax) is active.
 */
export function analyzeBlueprintProgress(board: Uint8Array): BlueprintProgress {
  // Col A anchor is A3 (col 0, row 2) -> index 2
  const a3Star = board[0 * 5 + 2];
  const hasA3Anchor = a3Star >= 8;
  // Col E anchor is E3 (col 4, row 2) -> index 22
  const e3Star = board[4 * 5 + 2];
  const hasE3Anchor = e3Star >= 8;

  // Flank checks: B2/B3/B4 (col 1) and D2/D3/D4 (col 3)
  const flankIndices = [
    1 * 5 + 1, // B2
    1 * 5 + 2, // B3
    1 * 5 + 3, // B4
    3 * 5 + 1, // D2
    3 * 5 + 2, // D3
    3 * 5 + 3, // D4
  ];
  const flankCount8 = flankIndices.filter((idx) => board[idx] >= 8).length;

  // Climax ready: 4+ 8★ relics surrounding C3 (col 2, row 2) or C4 (col 2, row 3)
  const climaxSurroundIndices = [
    1 * 5 + 2, // B3
    1 * 5 + 3, // B4
    2 * 5 + 4, // C5
    3 * 5 + 2, // D3
    3 * 5 + 3, // D4
  ];
  const surroundCount8 = climaxSurroundIndices.filter((idx) => board[idx] >= 8).length;
  const climaxReady = surroundCount8 >= 4;
  const flanksCompleted = hasA3Anchor && hasE3Anchor && (flankCount8 >= 2 || surroundCount8 >= 3);

  if (!hasA3Anchor) {
    // Phase 1: Left Column A
    let nextTarget = { col: 0, row: 0, label: 'A1 (Top Outer Corner)' };
    if (board[0 * 5 + 0] !== 0) {
      if (board[0 * 5 + 4] === 0) nextTarget = { col: 0, row: 4, label: 'A5 (Bottom Outer Corner)' };
      else if (board[0 * 5 + 1] === 0) nextTarget = { col: 0, row: 1, label: 'A2 (Inner Top)' };
      else if (board[0 * 5 + 3] === 0) nextTarget = { col: 0, row: 3, label: 'A4 (Inner Bottom)' };
      else nextTarget = { col: 0, row: 2, label: 'A3 (CENTER ANCHOR - Merge 5× 6★ → 8★)' };
    }
    return {
      activePhase: 1,
      phaseTitle: 'Phase 1: Left Perimeter Column A 5-Stack',
      phaseGoal: 'Stage 5× 6★ relics in Col A (A1 → A5 → A2 → A4 → Anchor A3). Merging at A3 spawns an 8★ anchor and earns +1 Hammer!',
      colACompleted: false,
      colECompleted: hasE3Anchor,
      flanksCompleted: false,
      climaxReady: false,
      recommendedCell: nextTarget,
    };
  } else if (!hasE3Anchor) {
    // Phase 2: Right Column E
    let nextTarget = { col: 4, row: 0, label: 'E1 (Top Outer Corner)' };
    if (board[4 * 5 + 0] !== 0) {
      if (board[4 * 5 + 4] === 0) nextTarget = { col: 4, row: 4, label: 'E5 (Bottom Outer Corner)' };
      else if (board[4 * 5 + 1] === 0) nextTarget = { col: 4, row: 1, label: 'E2 (Inner Top)' };
      else if (board[4 * 5 + 3] === 0) nextTarget = { col: 4, row: 3, label: 'E4 (Inner Bottom)' };
      else nextTarget = { col: 4, row: 2, label: 'E3 (CENTER ANCHOR - Merge 5× 6★ → 8★)' };
    }
    return {
      activePhase: 2,
      phaseTitle: 'Phase 2: Right Perimeter Column E 5-Stack',
      phaseGoal: 'Stage 5× 6★ relics in Col E (E1 → E5 → E2 → E4 → Anchor E3). Merging at E3 spawns your 2nd 8★ anchor and earns +1 Hammer!',
      colACompleted: true,
      colECompleted: false,
      flanksCompleted: false,
      climaxReady: false,
      recommendedCell: nextTarget,
    };
  } else if (!climaxReady) {
    // Phase 3: Flank Anchors in Cols B & D
    return {
      activePhase: 3,
      phaseTitle: 'Phase 3: Flank Anchors (Cols B & D)',
      phaseGoal: 'Both outer anchors (A3 & E3) are locked! Build 8★ relics at B3/B4 and D3/D4 and stage C5 to prepare the 5-relic surround.',
      colACompleted: true,
      colECompleted: true,
      flanksCompleted: true,
      climaxReady: false,
      recommendedCell: { col: 2, row: 4, label: 'C5 / Flanks B, D' },
    };
  } else {
    // Phase 4: Grand Climax
    return {
      activePhase: 4,
      phaseTitle: 'Phase 4: Grand Climax (5× 8★ Super-Merge into 10★ Mythic)',
      phaseGoal: 'Drop the final 8★ relic into C3! Unites 5× 8★ relics into a +2★ super-merge directly creating the 10★ Mythic Relic!',
      colACompleted: true,
      colECompleted: true,
      flanksCompleted: true,
      climaxReady: true,
      recommendedCell: { col: 2, row: 2, label: 'C3 (THE WINNING DROP)' },
    };
  }
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
  hammersAvailable: number | boolean = 1,
  placementsRemaining: number = MAX_RUN_PLACEMENTS,
  blueprintMode: boolean = false
): {
  candidates: CandidateMove[];
  topRecommendations: CandidateMove[];
  lethalMoves: CandidateMove[];
  elapsedMs: number;
  blueprintProgress: BlueprintProgress;
} {
  const startTime = performance.now();
  const bpProgress = analyzeBlueprintProgress(board);
  if (placementsRemaining <= 0) {
    return {
      candidates: [],
      topRecommendations: [],
      lethalMoves: [],
      elapsedMs: 0,
      blueprintProgress: bpProgress,
    };
  }

  const hammerCount = normalizeHammerCount(hammersAvailable);
  const canPlayPly2 = nextPieceKnown && placementsRemaining >= 2;
  const emptyCellsBefore = countEmptyCells(board);
  const initialShapeMob = analyzeShapeMobility(board);
  const ply1Placements = generateValidPlacements(board, currentPiece);
  const queueStars = [
    ...currentPiece.tileStars,
    ...(canPlayPly2 ? nextPiece.tileStars : []),
  ];

  const candidates: CandidateMove[] = [];

  for (const p1 of ply1Placements) {
    const moveId = `rot${p1.rotation}-c${p1.anchorCol}-r${p1.anchorRow}`;

    const ply1Sim = simulatePlacement(
      board,
      maxUnlockedStar,
      p1.placedTiles
    );

    const ply1Trans = evaluateTransitionReward(
      board,
      maxUnlockedStar,
      ply1Sim,
      hammerCount
    );
    const hammersAfterPly1 = Math.min(
      MAX_HAMMERS,
      hammerCount + ply1Sim.hammersEarned
    );

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
      maxUnlockedStar,
      hammerCount,
      queueStars,
      initialShapeMob
    );
    let emptyCellsAfterPly2 = emptyCellsAfterPly1;
    let threeTileMobilityAfter = terminalEval.totalThreeTileSlots;

    if (canPlayPly2) {
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
            p2.placedTiles
          );
          const ply2Trans = evaluateTransitionReward(
            ply1Sim.nextBoard,
            ply1Sim.nextMaxStar,
            ply2Sim,
            hammersAfterPly1
          );
          const hammersAfterPly2 = Math.min(
            MAX_HAMMERS,
            hammersAfterPly1 + ply2Sim.hammersEarned
          );
          const boardEval = evaluateBoardState(
            ply2Sim.nextBoard,
            ply2Sim.nextMaxStar,
            board,
            maxUnlockedStar,
            hammersAfterPly2,
            queueStars,
            initialShapeMob
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

    // Immediate Hammer Generation Priority: Guaranteeing a hammer on the current move (Ply 1) stocks the player
    // up to 2/2 Hammers immediately, providing maximum tactical safety now rather than deferring to Ply 2.
    let immediateHammerBonus = 0;
    if (ply1Sim.hammersEarned > 0 && hammerCount < MAX_HAMMERS) {
      immediateHammerBonus = hammerCount === 0 ? 8000 : 6000;
      totalScore += immediateHammerBonus;
    }

    // 🏛️ Master Endgame Blueprint Mode Priority
    let blueprintPriorityBonus = 0;
    let blueprintMoveDesc: string | null = null;

    if (blueprintMode) {
      if (bpProgress.activePhase === 1) {
        // Phase 1: Column A focus (col 0)
        const colATiles = p1.placedTiles.filter((pt) => pt.col === 0);
        if (colATiles.length > 0) {
          for (const pt of colATiles) {
            if (pt.star >= 5) {
              if (pt.row === 0 || pt.row === 4) {
                blueprintPriorityBonus += 25000;
                blueprintMoveDesc = `Drop ${pt.star}★ at ${formatCellCoord(pt.col, pt.row)} (Outer Corner)`;
              } else if (pt.row === 1 || pt.row === 3) {
                blueprintPriorityBonus += 22000;
                blueprintMoveDesc = `Drop ${pt.star}★ at ${formatCellCoord(pt.col, pt.row)} (Inner Perimeter)`;
              } else if (pt.row === 2) {
                // Anchor cell A3
                const triggers5Merge = ply1Sim.merges.some(
                  (m) =>
                    m.mergedCells.length >= 5 &&
                    indexToCoord(m.landingCell).col === 0 &&
                    indexToCoord(m.landingCell).row === 2
                );
                if (triggers5Merge) {
                  blueprintPriorityBonus += 75000;
                  blueprintMoveDesc = `Anchor Drop ${pt.star}★ at A3 → 5-Super-Merge into 8★ (+1 Hammer)!`;
                } else {
                  // Premature anchor placement before other cells are staged
                  blueprintPriorityBonus -= 45000;
                }
              }
            } else {
              // Contamination of Col A with low-star relic (< 5★)
              blueprintPriorityBonus -= 35000;
            }
          }
        }
      } else if (bpProgress.activePhase === 2) {
        // Phase 2: Column E focus (col 4)
        const colETiles = p1.placedTiles.filter((pt) => pt.col === 4);
        if (colETiles.length > 0) {
          for (const pt of colETiles) {
            if (pt.star >= 5) {
              if (pt.row === 0 || pt.row === 4) {
                blueprintPriorityBonus += 25000;
                blueprintMoveDesc = `Drop ${pt.star}★ at ${formatCellCoord(pt.col, pt.row)} (Outer Corner)`;
              } else if (pt.row === 1 || pt.row === 3) {
                blueprintPriorityBonus += 22000;
                blueprintMoveDesc = `Drop ${pt.star}★ at ${formatCellCoord(pt.col, pt.row)} (Inner Perimeter)`;
              } else if (pt.row === 2) {
                // Anchor cell E3
                const triggers5Merge = ply1Sim.merges.some(
                  (m) =>
                    m.mergedCells.length >= 5 &&
                    indexToCoord(m.landingCell).col === 4 &&
                    indexToCoord(m.landingCell).row === 2
                );
                if (triggers5Merge) {
                  blueprintPriorityBonus += 75000;
                  blueprintMoveDesc = `Anchor Drop ${pt.star}★ at E3 → 5-Super-Merge into 8★ (+1 Hammer)!`;
                } else {
                  blueprintPriorityBonus -= 45000;
                }
              }
            } else {
              blueprintPriorityBonus -= 35000;
            }
          }
        }
      } else if (bpProgress.activePhase === 3) {
        // Phase 3: Flanks B & D, C5
        for (const pt of p1.placedTiles) {
          if (pt.star >= 7) {
            if (
              (pt.col === 1 && (pt.row === 2 || pt.row === 3)) ||
              (pt.col === 3 && (pt.row === 2 || pt.row === 3)) ||
              (pt.col === 2 && pt.row === 4)
            ) {
              blueprintPriorityBonus += 28000;
              blueprintMoveDesc = `Stage ${pt.star}★ at ${formatCellCoord(pt.col, pt.row)} for Center Surround`;
            }
          }
        }
      } else if (bpProgress.activePhase === 4) {
        // Phase 4: Center Climax at C3
        const has10StarClimax = ply1Sim.merges.some(
          (m) =>
            m.toStar === 10 &&
            m.mergedCells.length >= 5 &&
            indexToCoord(m.landingCell).col === 2 &&
            indexToCoord(m.landingCell).row === 2
        );
        if (has10StarClimax) {
          blueprintPriorityBonus += 120000;
          blueprintMoveDesc = `CLIMAX DROP at C3 → 5-Super-Merge into 10★ Mythic Relic!`;
        } else {
          for (const pt of p1.placedTiles) {
            if (pt.col === 2 && pt.row === 2 && pt.star >= 8) {
              blueprintPriorityBonus += 85000;
              blueprintMoveDesc = `Drop 8★ at C3 (Climax Anchor)`;
            }
          }
        }
      }

      totalScore += blueprintPriorityBonus;
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

    if (ply1Sim.tenStarsCreated > 0) {
      highlights.push(
        `👑 Forges ${ply1Sim.tenStarsCreated}x 10★ Mythic Relic (Achieved & Cleared from Board)!`
      );
    }

    if (ply1Sim.hammersEarned > 0) {
      highlights.push(
        hammerCount < MAX_HAMMERS
          ? `🔨 5+ Relic Super-Merge grants +1 Extra Hammer (${hammerCount} → ${hammersAfterPly1}/${MAX_HAMMERS})!`
          : `🔨 5+ Relic Super-Merge (+2★ Jump)!`
      );
    }

    const ply1SuperMerge = ply1Sim.merges.find((m) => m.mergedCells.length >= 5);
    if (ply1SuperMerge) {
      const { col: landCol, row: landRow } = indexToCoord(ply1SuperMerge.landingCell);
      const isOuterCenter = (landCol === 0 || landCol === 4) && landRow === 2;
      const isCenterClimax = landCol === 2 && (landRow === 2 || landRow === 3);
      const anchorName = formatCellCoord(landCol, landRow);
      if (isOuterCenter) {
        highlights.push(
          `🏛️ Master Blueprint: 5-Relic Super-Merge lands ${ply1SuperMerge.toStar}★ at Center Anchor ${anchorName} (+1 Hammer)!`
        );
      } else if (isCenterClimax && ply1SuperMerge.toStar === 10) {
        highlights.push(
          `👑 Master Blueprint Climax: 5× 8★ Super-Merge evolves +2★ directly into 10★ Mythic Relic at ${anchorName}!`
        );
      }
    }

    if (terminalEval.perimeterStackBonus >= 800) {
      highlights.push(
        '🏛️ Advances Perimeter 5-Stack Blueprint in Col A/E towards 8★ super-merge!'
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
    if (blueprintMode && blueprintPriorityBonus > 0 && blueprintMoveDesc) {
      strategicTag = {
        label: `🏛️ [Blueprint P${bpProgress.activePhase}] ${blueprintMoveDesc}`,
        tone: 'chain',
      };
    } else if (isLethal) {
      strategicTag = {
        label: '💀 Lethal Move (Blocks Next Piece)',
        tone: 'lethal',
      };
    } else if (ply1Sim.tenStarsCreated > 0) {
      const isClimaxSuperMerge = ply1Sim.merges.some(
        (m) => m.toStar === 10 && m.mergedCells.length >= 5
      );
      strategicTag = {
        label: isClimaxSuperMerge
          ? `👑 5-Super-Merge into 10★ Mythic Relic (Grand Finale)!`
          : `👑 Achieves 10★ Mythic Relic (Cleared from Board)!`,
        tone: 'chain',
      };
    } else if (ply1Sim.hammersEarned > 0) {
      const m0 = ply1Sim.merges.find((m) => m.mergedCells.length >= 5) ?? ply1Sim.merges[0];
      const { col: landCol, row: landRow } = indexToCoord(m0.landingCell);
      const isOuterCenter = (landCol === 0 || landCol === 4) && landRow === 2;
      const anchorName = formatCellCoord(landCol, landRow);
      if (isOuterCenter) {
        strategicTag = {
          label: `🏛️ Blueprint 5-Super-Merge → ${m0.toStar}★ at ${anchorName} + 🔨 Hammer (${hammersAfterPly1}/${MAX_HAMMERS})`,
          tone: 'chain',
        };
      } else if (hammerCount < MAX_HAMMERS) {
        const chainSuffix =
          ply1Sim.maxChainDepth >= 2
            ? ` + 🔥 ${ply1Sim.maxChainDepth}-Step Chain`
            : '';
        strategicTag = {
          label: `🔨 +1 Hammer (${hammersAfterPly1}/${MAX_HAMMERS}) • 5+ Super-Merge (${m0.fromStar}★ → ${m0.toStar}★)${chainSuffix}`,
          tone: 'chain',
        };
      } else {
        strategicTag = {
          label: `🔨 5+ Super-Merge (${m0.fromStar}★ → ${m0.toStar}★) • Max Hammers Held (2/2)`,
          tone: 'chain',
        };
      }
    } else if (terminalEval.perimeterStackBonus >= 800) {
      strategicTag = {
        label: `🏛️ Perimeter 5-Stack Setup (Col A/E)`,
        tone: 'setup',
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
    if (ply1Trans.hammerEarnBonus > 0) {
      scoreBreakdown.push({
        label: `🔨 +1 Extra Hammer Stock Bonus (${hammersAfterPly1}/${MAX_HAMMERS})`,
        value: ply1Trans.hammerEarnBonus,
      });
    }
    if (immediateHammerBonus > 0) {
      scoreBreakdown.push({
        label: `🔨 Immediate Hammer Stock Guarantee (${hammersAfterPly1}/${MAX_HAMMERS})`,
        value: immediateHammerBonus,
      });
    }
    if (canPlayPly2 && bestPly2) {
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
    if (blueprintMode && blueprintPriorityBonus !== 0) {
      scoreBreakdown.push({
        label: `🏛️ Endgame Blueprint Hyper-Focus (${bpProgress.phaseTitle})`,
        value: blueprintPriorityBonus,
      });
    }
    if (ply1Trans.blueprintAnchorBonus > 0) {
      scoreBreakdown.push({
        label: '🏛️ Master Blueprint Anchor Landing Bonus',
        value: ply1Trans.blueprintAnchorBonus,
      });
    }
    if (terminalEval.perimeterStackBonus > 0) {
      scoreBreakdown.push({
        label: '🏛️ Perimeter 5-Stack Staging Bonus (Col A/E)',
        value: terminalEval.perimeterStackBonus,
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
    blueprintProgress: bpProgress,
  };
}

export function formatPlacedTilesSummary(placedTiles: PlacedTile[]): string {
  return placedTiles
    .map((pt) => `${formatCellCoord(pt.col, pt.row)} (${pt.star}★)`)
    .join(', ');
}

/**
 * Evaluates when and where to best use a Hammer (destroys 1 relic on the board).
 * Players start with 1 Hammer and can earn an extra Hammer when merging 5+ relics (for a max of 2).
 * Balances the opportunity cost of spending a Hammer now vs saving it for:
 * 1. Emergency survival (0 legal/non-lethal moves or 0 3-Triangle slots)
 * 2. Unblocking an immediate multi-step cascade, 5+ merge (which refunds +1 Hammer!), or new Max Tier unlock
 * 3. Permanent dead-space cleanup in mid/late game (especially M >= 7★ where 4★ never retires at 8★+, or when sitting at 2/2 Hammers)
 */
export function evaluateHammerAdvice(
  board: Uint8Array,
  maxUnlockedStar: number,
  currentPiece: PieceConfig,
  nextPiece: PieceConfig,
  nextPieceKnown: boolean,
  baselineResult: {
    candidates: CandidateMove[];
    topRecommendations: CandidateMove[];
    lethalMoves: CandidateMove[];
  },
  hammersAvailable: number | boolean = 1
): HammerAdvice {
  const hammerCount = normalizeHammerCount(hammersAvailable);
  const validIndices = getValidCellIndices();
  const neighborsTable = getPrecomputedNeighbors();
  const minActiveStar = getMinActiveSpawnStar(maxUnlockedStar);

  const occupiedCells: number[] = [];
  let totalDeadCount = 0;
  let totalAtRiskCount = 0;

  for (const idx of validIndices) {
    const s = board[idx];
    if (s > 0) {
      occupiedCells.push(idx);
      if (s < minActiveStar) totalDeadCount++;
      else if (s === minActiveStar) totalAtRiskCount++;
    }
  }

  if (occupiedCells.length === 0) {
    return {
      urgency: 'hold-save',
      shouldUseNow: false,
      headline: `🛡️ HOLD HAMMER (${hammerCount}/${MAX_HAMMERS}) — Board is Clean`,
      rationale:
        'Start with 1 Hammer and earn +1 on any 5+ relic merge (max 2). Save your Hammer for permanently retired dead relics (1★–3★) or late-game board crunches.',
      recommendedTarget: null,
      alternativeTargets: [],
    };
  }

  const emptyCellsNow = countEmptyCells(board);
  const baselineMobility = analyzeShapeMobility(board);
  const baselineBest = baselineResult.topRecommendations[0] ?? null;
  const baselineScore = baselineBest ? baselineBest.totalScore : -25000;
  const baselineIsGameOverOrLethal =
    baselineResult.candidates.length === 0 ||
    baselineResult.candidates.every((c) => c.isLethal);

  const baselineMaxTierReached = baselineBest
    ? Math.max(
        baselineBest.ply1Sim.nextMaxStar,
        baselineBest.bestPly2?.sim.nextMaxStar ?? 0
      )
    : maxUnlockedStar;
  const baselineMaxChain = baselineBest
    ? Math.max(
        baselineBest.ply1Sim.maxChainDepth,
        baselineBest.bestPly2?.sim.maxChainDepth ?? 0
      )
    : 0;

  const remainingHammersAfterUse = Math.max(0, hammerCount - 1);

  // Pre-score all occupied cells to pick the top 6 Hammer candidates for counterfactual simulation
  const preScored = occupiedCells.map((cellIdx) => {
    const star = board[cellIdx];
    const { col, row } = indexToCoord(cellIdx);
    const isDeadRetired = star < minActiveStar;
    const isAtRisk = star === minActiveStar;
    const isCentralCol = col >= 1 && col <= 3;

    // Count distinct adjacent higher-star pairs/clusters this tile might be wedged between
    let adjacentOccupied = 0;
    let adjacentDifferentPairs = 0;
    const neighborStars = new Uint8Array(11);
    for (const nb of neighborsTable[cellIdx]) {
      const nbStar = board[nb];
      if (nbStar > 0) {
        adjacentOccupied++;
        neighborStars[nbStar]++;
        if (neighborStars[nbStar] === 2 && nbStar !== star) {
          adjacentDifferentPairs++;
        }
      }
    }

    // Priority heuristic: Dead retired tiles first, then At-Risk, then low-star central blockers;
    // strongly avoid destroying high-tier relics (star >= maxUnlockedStar)
    const priorityScore =
      (isDeadRetired ? 10000 : isAtRisk ? 4500 : 0) +
      (isCentralCol ? 600 : 0) +
      adjacentOccupied * 180 +
      adjacentDifferentPairs * 900 -
      star * 700;

    return { cellIdx, star, col, row, isDeadRetired, isAtRisk, priorityScore };
  });

  preScored.sort((a, b) => b.priorityScore - a.priorityScore);
  const candidatePool = preScored.slice(0, 6);

  // Step 1: Fast 1-ply screening across the top 6 candidate cells
  const screened = candidatePool.map((item) => {
    const boardAfter = new Uint8Array(board);
    boardAfter[item.cellIdx] = 0;
    const mobAfter = analyzeShapeMobility(boardAfter);
    const fastSim = solveBestMoves(
      boardAfter,
      maxUnlockedStar,
      currentPiece,
      nextPiece,
      false,
      remainingHammersAfterUse
    );
    const fastBest = fastSim.topRecommendations[0] ?? null;
    // Deduct intrinsic relic value if smashing an active non-retired relic
    const relicLossCost = item.isDeadRetired
      ? -1800 // Bonus for permanently removing unmergeable dead space
      : Math.round(650 * Math.pow(2.0, item.star - 1));

    const rawFastScore = (fastBest ? fastBest.totalScore : -20000) - relicLossCost;
    return {
      ...item,
      boardAfter,
      mobAfter,
      rawFastScore,
    };
  });

  screened.sort((a, b) => b.rawFastScore - a.rawFastScore);
  const topCandidates = screened.slice(0, 3);

  // Step 2: Full 2-ply counterfactual evaluation on the top 3 Hammer targets
  const evaluatedTargets: HammerCandidateTarget[] = topCandidates.map((item) => {
    const fullSim = solveBestMoves(
      item.boardAfter,
      maxUnlockedStar,
      currentPiece,
      nextPiece,
      nextPieceKnown,
      remainingHammersAfterUse
    );
    const bestMoveAfterHammer = fullSim.topRecommendations[0] ?? null;
    const afterScore = bestMoveAfterHammer
      ? bestMoveAfterHammer.totalScore
      : -25000;

    // Intrinsic cost of destroying an active relic vs bonus for clearing a permanent dead relic
    const relicDestructionPenalty = item.isDeadRetired
      ? -2500
      : item.isAtRisk
      ? -600
      : item.star === 1
      ? 200
      : item.star === 2
      ? 600
      : item.star === 3
      ? 1400
      : Math.round(1000 * Math.pow(1.8, item.star - 3));

    const netGainScore = Math.round(
      afterScore - baselineScore - relicDestructionPenalty
    );

    const savesFromGameOver =
      baselineIsGameOverOrLethal &&
      bestMoveAfterHammer !== null &&
      !bestMoveAfterHammer.isLethal;

    const unblocksHammerRefund = Boolean(
      bestMoveAfterHammer && bestMoveAfterHammer.ply1Sim.hammersEarned > 0
    );

    const afterMaxTier = bestMoveAfterHammer
      ? Math.max(
           bestMoveAfterHammer.ply1Sim.nextMaxStar,
          bestMoveAfterHammer.bestPly2?.sim.nextMaxStar ?? 0
        )
      : maxUnlockedStar;
    const afterMaxChain = bestMoveAfterHammer
      ? Math.max(
          bestMoveAfterHammer.ply1Sim.maxChainDepth,
          bestMoveAfterHammer.bestPly2?.sim.maxChainDepth ?? 0
        )
      : 0;

    const unlocksNewTierOrCascade =
      !item.isDeadRetired && item.star >= maxUnlockedStar
        ? false
        : (afterMaxTier > baselineMaxTierReached &&
            afterMaxTier > maxUnlockedStar) ||
          (afterMaxChain >= 2 &&
            afterMaxChain > baselineMaxChain &&
            netGainScore >= 1400);

    // Once M >= 7★, 1★, 2★, and 3★ are retired and 4★ NEVER retires at 8★+!
    // So if M >= 7★ and there is only 1 dead retired tile left, smashing it permanently cleans the board for the rest of the run!
    const clearsLastPermanentDeadSpace =
      item.isDeadRetired && totalDeadCount === 1 && maxUnlockedStar >= 7;

    const triangleSlotsGained = Math.max(
      0,
      item.mobAfter.compact3TriangleSlots - baselineMobility.compact3TriangleSlots
    );
    const threeTileSlotsGained = Math.max(
      0,
      item.mobAfter.totalThreeTileSlots - baselineMobility.totalThreeTileSlots
    );

    const coordLabel = formatCellCoord(item.col, item.row);
    const relicName = RELIC_SPECS[item.star]?.shortName ?? `${item.star}★`;

    const reasons: string[] = [];
    if (savesFromGameOver) {
      reasons.push(`Prevents immediate Game Over and opens safe placement`);
    }
    if (unblocksHammerRefund) {
      reasons.push(`Unblocks an immediate 5+ relic merge that refunds +1 Hammer`);
    }
    if (clearsLastPermanentDeadSpace) {
      reasons.push(
        `Clears the final retired ${item.star}★ dead space (at ${maxUnlockedStar}★+, 4★ never retires so 0 new dead spaces will spawn!)`
      );
    } else if (item.isDeadRetired) {
      reasons.push(
        `Removes permanently retired ${item.star}★ (${relicName}) dead space at ${coordLabel}`
      );
    } else if (item.isAtRisk) {
      reasons.push(
        `Clears endangered ${item.star}★ (${relicName}) at ${coordLabel}`
      );
    } else {
      reasons.push(`Clears blocking ${item.star}★ (${relicName}) at ${coordLabel}`);
    }

    if (afterMaxTier > baselineMaxTierReached && afterMaxTier > maxUnlockedStar) {
      reasons.push(`Unlocks New Tier ${afterMaxTier}★ on this turn`);
    } else if (afterMaxChain > baselineMaxChain && afterMaxChain >= 2) {
      reasons.push(`Unblocks a ${afterMaxChain}-step chain cascade`);
    }

    if (triangleSlotsGained > 0) {
      reasons.push(`Opens +${triangleSlotsGained} 3-Triangle placement(s)`);
    } else if (threeTileSlotsGained > 0) {
      reasons.push(`Opens +${threeTileSlotsGained} 3-Tile placement(s)`);
    }

    return {
      cellIndex: item.cellIdx,
      col: item.col,
      row: item.row,
      star: item.star,
      isDeadRetired: item.isDeadRetired,
      isAtRisk: item.isAtRisk,
      netGainScore,
      bestMoveAfterHammer,
      savesFromGameOver,
      unlocksNewTierOrCascade,
      unblocksHammerRefund,
      clearsLastPermanentDeadSpace,
      triangleSlotsGained,
      threeTileSlotsGained,
      reason: reasons.join(' • '),
    };
  });

  evaluatedTargets.sort((a, b) => {
    if (a.savesFromGameOver !== b.savesFromGameOver) {
      return a.savesFromGameOver ? -1 : 1;
    }
    if (a.unblocksHammerRefund !== b.unblocksHammerRefund) {
      return a.unblocksHammerRefund ? -1 : 1;
    }
    if (a.clearsLastPermanentDeadSpace !== b.clearsLastPermanentDeadSpace) {
      return a.clearsLastPermanentDeadSpace ? -1 : 1;
    }
    if (a.isDeadRetired !== b.isDeadRetired) {
      return a.isDeadRetired ? -1 : 1;
    }
    return b.netGainScore - a.netGainScore;
  });

  const bestTarget = evaluatedTargets[0] ?? null;
  const alternativeTargets = evaluatedTargets.slice(1);

  if (!bestTarget) {
    return {
      urgency: 'hold-save',
      shouldUseNow: false,
      headline: `🛡️ HOLD HAMMER (${hammerCount}/${MAX_HAMMERS}) — Save for Later`,
      rationale: 'No beneficial Hammer targets on the current board.',
      recommendedTarget: null,
      alternativeTargets: [],
    };
  }

  const targetCoord = formatCellCoord(bestTarget.col, bestTarget.row);

  // Proactive Hammer Decision Tree:
  // 1. Critical Survival: Game Over without hammer, or 0 3-Triangle slots with tight space
  if (
    bestTarget.savesFromGameOver ||
    (baselineMobility.compact3TriangleSlots === 0 &&
      bestTarget.triangleSlotsGained > 0 &&
      (bestTarget.isDeadRetired || bestTarget.isAtRisk || emptyCellsNow <= 8))
  ) {
    return {
      urgency: 'critical-survival',
      shouldUseNow: true,
      headline: `🚨 USE HAMMER NOW — Smash ${targetCoord} (${bestTarget.star}★) to Prevent Board Lock!`,
      rationale: bestTarget.savesFromGameOver
        ? `All current placements are lethal/blocked. Smashing ${targetCoord} (${bestTarget.star}★) immediately saves your run!`
        : `Board currently has 0 valid 3-Triangle spots. Smashing ${targetCoord} (${bestTarget.star}★) restores +${bestTarget.triangleSlotsGained} 3-Triangle placement(s) and prevents a shape lock.`,
      recommendedTarget: bestTarget,
      alternativeTargets,
    };
  }

  // 2. Self-Refunding 5+ Relic Super-Merge: smashing unblocks an immediate 5+ merge that earns back the hammer!
  if (
    bestTarget.unblocksHammerRefund &&
    (bestTarget.isDeadRetired || bestTarget.isAtRisk || bestTarget.star <= 4)
  ) {
    return {
      urgency: 'high-value-cascade',
      shouldUseNow: true,
      headline: `🔨 USE HAMMER NOW — Smash ${targetCoord} (${bestTarget.star}★) to Unblock 5+ Merge (Refunds Hammer!)`,
      rationale: `Smashing ${targetCoord} (${bestTarget.star}★) allows your current piece to execute a 5+ relic super-merge. This immediately refunds +1 Hammer back to your inventory and triggers a +2★ evolution!`,
      recommendedTarget: bestTarget,
      alternativeTargets,
    };
  }

  // 3. High-Value Cascade / Tier Unlock Unblocker
  if (
    bestTarget.unlocksNewTierOrCascade &&
    (bestTarget.isDeadRetired || bestTarget.isAtRisk || bestTarget.star <= 4)
  ) {
    return {
      urgency: 'high-value-cascade',
      shouldUseNow: true,
      headline: `🔥 USE HAMMER NOW — Smash ${targetCoord} (${bestTarget.star}★) to Unblock Cascade!`,
      rationale: `${bestTarget.reason}. Spending a Hammer here converts a blocked board into an immediate high-tier breakthrough.`,
      recommendedTarget: bestTarget,
      alternativeTargets,
    };
  }

  // 4. Capped at 2/2 Hammers: Proactively spend a hammer to keep room for future +1 Hammer gains
  if (
    hammerCount >= MAX_HAMMERS &&
    (bestTarget.isDeadRetired ||
      bestTarget.isAtRisk ||
      (bestTarget.star <= 3 && (bestTarget.triangleSlotsGained > 0 || bestTarget.netGainScore >= 600)))
  ) {
    return {
      urgency: 'good-cleanup',
      shouldUseNow: true,
      headline: `🔨 USE HAMMER (2/2 Capped) — Smash ${targetCoord} (${bestTarget.star}★) to Keep Inventory Open`,
      rationale: `You are holding the maximum ${MAX_HAMMERS}/${MAX_HAMMERS} Hammers! Smashing this ${
        bestTarget.isDeadRetired ? 'permanently retired dead relic' : 'low-star blocker'
      } clears valuable space and re-opens room to earn another Hammer on your next 5+ relic merge.`,
      recommendedTarget: bestTarget,
      alternativeTargets,
    };
  }

  // 5. Optimal Permanent Dead-Space Cleanup (Late game 7★+)
  if (bestTarget.clearsLastPermanentDeadSpace) {
    return {
      urgency: 'good-cleanup',
      shouldUseNow: true,
      headline: `✨ OPTIMAL HAMMER WINDOW — Smash Final Retired ${bestTarget.star}★ at ${targetCoord}`,
      rationale: `At ${maxUnlockedStar}★+, 1★–3★ are retired and 4★ Purple never retires at 8★+. Smashing your last retired ${bestTarget.star}★ at ${targetCoord} permanently gives you 0 dead spaces!`,
      recommendedTarget: bestTarget,
      alternativeTargets,
    };
  }

  // 6. Proactive Mid-Game Dead Tile Removal: don't let dead tiles sit around when hammers can replenish
  if (
    bestTarget.isDeadRetired &&
    (emptyCellsNow <= 15 ||
      (baselineMobility.compact3TriangleSlots <= 2 && bestTarget.triangleSlotsGained > 0) ||
      (bestTarget.col >= 1 && bestTarget.col <= 3 && emptyCellsNow <= 18))
  ) {
    return {
      urgency: 'good-cleanup',
      shouldUseNow: true,
      headline: `🔨 PROACTIVE CLEANUP — Smash Retired ${bestTarget.star}★ at ${targetCoord}`,
      rationale: `Smashing this retired dead space eliminates unmergeable clutter and protects 3-tile shape mobility. Since hammers replenish on 5+ relic merges, using a Hammer proactively keeps your board fluid.`,
      recommendedTarget: bestTarget,
      alternativeTargets,
    };
  }

  // 7. Proactive Awkward Wedged Blocker Removal: smash low-star tiles wedging high-tier lanes
  if (
    bestTarget.star <= 2 &&
    bestTarget.col >= 1 &&
    bestTarget.col <= 3 &&
    bestTarget.triangleSlotsGained >= 1 &&
    bestTarget.netGainScore >= 1000 &&
    emptyCellsNow <= 15
  ) {
    return {
      urgency: 'good-cleanup',
      shouldUseNow: true,
      headline: `🔨 PROACTIVE HAMMER — Clear Wedged ${bestTarget.star}★ at ${targetCoord}`,
      rationale: `This ${bestTarget.star}★ relic is wedging higher-tier pairs apart in a central lane. Smashing it restores +${bestTarget.triangleSlotsGained} 3-Triangle placement(s) and connects your merge pipeline.`,
      recommendedTarget: bestTarget,
      alternativeTargets,
    };
  }

  // 8. Otherwise: Board is clean and healthy; hold hammer
  const holdReason =
    totalDeadCount === 0
      ? totalAtRiskCount > 0
        ? `You have 0 retired dead tiles right now (your ${minActiveStar}★ tile${
            totalAtRiskCount > 1 ? 's are' : ' is'
          } still in the active spawn pool and can be merged naturally). Save your Hammer (${hammerCount}/${MAX_HAMMERS})!`
        : `Board space is open (${emptyCellsNow} empty cells) and flowing cleanly. Keep your Hammer (${hammerCount}/${MAX_HAMMERS}) in reserve until an awkward blocker forms or a 5+ super-merge can be unblocked.`
      : `You have 1 retired ${bestTarget.star}★ in outer column ${formatCellCoord(bestTarget.col, bestTarget.row)}, with plenty of open space (${emptyCellsNow} empty cells). Hold your Hammer (${hammerCount}/${MAX_HAMMERS}) until the board tightens or another hammer is earned.`;

  return {
    urgency: 'hold-save',
    shouldUseNow: false,
    headline: `🛡️ HOLD HAMMER (${hammerCount}/${MAX_HAMMERS}) — Board is Flowing Smoothly`,
    rationale: holdReason,
    recommendedTarget: bestTarget,
    alternativeTargets,
  };
}

/**
 * Evaluates when and where to best use the once-per-run Star component:
 * - Raises 1 relic on the board by +1 grade (valid for 1★..8★; cannot be used on 9★).
 * - Applies the exact same merging and cascade rules (including 5+ relic super-merges granting +2★ and +1 Hammer,
 *   and 10★ relics disappearing from the board when achieved).
 */
export function evaluateStarAdvice(
  board: Uint8Array,
  maxUnlockedStar: number,
  currentPiece?: PieceConfig,
  nextPiece?: PieceConfig,
  nextPieceKnown: boolean = false,
  baselineResult?: {
    candidates: CandidateMove[];
    topRecommendations: CandidateMove[];
    lethalMoves: CandidateMove[];
  },
  hammersAvailable: number | boolean = 1
): StarAdvice {
  const hammerCount = normalizeHammerCount(hammersAvailable);
  const validIndices = getValidCellIndices();
  const minActiveStar = getMinActiveSpawnStar(maxUnlockedStar);

  const eligibleCells: number[] = [];
  for (const idx of validIndices) {
    const s = board[idx];
    if (s >= 1 && s <= MAX_STAR_UPGRADE_TARGET_GRADE) {
      eligibleCells.push(idx);
    }
  }

  if (eligibleCells.length === 0) {
    return {
      urgency: 'hold-save',
      shouldUseNow: false,
      headline: '⭐ HOLD 1× STAR — No Eligible 1★–8★ Relics on Board',
      rationale:
        'You get 1 Star per run to raise any 1★–8★ relic by +1 grade (cannot be used on 9★). Save it for a high-tier cascade, a 5+ merge (+1 Hammer), or rescuing a retired straggler.',
      recommendedTarget: null,
      alternativeTargets: [],
    };
  }

  const effectiveCurrentPiece: PieceConfig = currentPiece ?? {
    shapeId: 'single',
    rotation: 0,
    tileStars: [Math.min(9, maxUnlockedStar)],
  };
  const effectiveNextPiece: PieceConfig = nextPiece ?? effectiveCurrentPiece;
  const effectiveBaseline =
    baselineResult ??
    solveBestMoves(
      board,
      maxUnlockedStar,
      effectiveCurrentPiece,
      effectiveNextPiece,
      nextPieceKnown,
      hammerCount
    );

  const emptyCellsNow = countEmptyCells(board);
  const baselineBest = effectiveBaseline.topRecommendations[0] ?? null;
  const baselineScore = baselineBest ? baselineBest.totalScore : -25000;
  const baselineIsGameOverOrLethal =
    effectiveBaseline.candidates.length === 0 ||
    effectiveBaseline.candidates.every((c) => c.isLethal);

  // Pre-evaluate immediate Star upgrade simulation on all eligible cells (1★..8★)
  const preScored = eligibleCells
    .map((cellIdx) => {
      const fromStar = board[cellIdx];
      const toStar = fromStar + 1;
      const { col, row } = indexToCoord(cellIdx);
      const isDeadRetired = fromStar < minActiveStar;
      const isAtRisk = fromStar === minActiveStar;
      const starSim = simulateStarUpgrade(board, maxUnlockedStar, cellIdx);
      if (!starSim) return null;

      const starTrans = evaluateTransitionReward(
        board,
        maxUnlockedStar,
        starSim,
        hammerCount
      );
      const triggersImmediateMerge = starSim.merges.length > 0;

      // Priority heuristic for candidate screening:
      const priorityScore =
        starTrans.score +
        (starSim.tenStarsCreated > 0 ? 25000 : 0) +
        (starSim.hammersEarned > 0 ? 6000 : 0) +
        (triggersImmediateMerge ? 3500 + starSim.maxChainDepth * 1500 : 0) +
        (isDeadRetired ? 4000 : isAtRisk ? 1800 : 0) +
        fromStar * 450;

      return {
        cellIdx,
        col,
        row,
        fromStar,
        toStar,
        isDeadRetired,
        isAtRisk,
        starSim,
        starTransScore: starTrans.score,
        triggersImmediateMerge,
        priorityScore,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  preScored.sort((a, b) => b.priorityScore - a.priorityScore);
  const candidatePool = preScored.slice(0, 6);

  // Fast 1-ply screening across top 6 Star candidates
  const screened = candidatePool.map((item) => {
    const hammersAfterStar = Math.min(
      MAX_HAMMERS,
      hammerCount + item.starSim.hammersEarned
    );
    const fastSim = solveBestMoves(
      item.starSim.nextBoard,
      item.starSim.nextMaxStar,
      effectiveCurrentPiece,
      effectiveNextPiece,
      false,
      hammersAfterStar
    );
    const fastBest = fastSim.topRecommendations[0] ?? null;
    const rawFastScore =
      item.starTransScore + (fastBest ? fastBest.totalScore : -20000);
    return {
      ...item,
      hammersAfterStar,
      rawFastScore,
    };
  });

  screened.sort((a, b) => b.rawFastScore - a.rawFastScore);
  const topCandidates = screened.slice(0, 3);

  // Full 2-ply counterfactual evaluation on top 3 Star candidates
  const evaluatedTargets: StarCandidateTarget[] = topCandidates.map((item) => {
    const fullSim = solveBestMoves(
      item.starSim.nextBoard,
      item.starSim.nextMaxStar,
      effectiveCurrentPiece,
      effectiveNextPiece,
      nextPieceKnown,
      item.hammersAfterStar
    );
    const bestMoveAfterStar = fullSim.topRecommendations[0] ?? null;
    const afterMoveScore = bestMoveAfterStar
      ? bestMoveAfterStar.totalScore
      : -25000;

    const netGainScore = Math.round(
      item.starTransScore + afterMoveScore - baselineScore
    );

    const savesFromGameOver =
      baselineIsGameOverOrLethal &&
      bestMoveAfterStar !== null &&
      !bestMoveAfterStar.isLethal;

    const createsTenStar =
      item.starSim.tenStarsCreated > 0 ||
      (bestMoveAfterStar?.ply1Sim.tenStarsCreated ?? 0) > 0;

    const earnsExtraHammer =
      item.starSim.hammersEarned > 0 && hammerCount < MAX_HAMMERS;

    // A cascade MUST trigger an actual immediate multi-step chain clearing multiple tiles on an advanced relic (5★+)
    const isMajorCascade =
      item.triggersImmediateMerge &&
      item.starSim.maxChainDepth >= 2 &&
      item.fromStar >= 5 &&
      item.starSim.totalTilesCleared >= 4;

    const rescuesDeadOrAtRisk =
      item.isDeadRetired && item.triggersImmediateMerge;

    const coordLabel = formatCellCoord(item.col, item.row);
    const reasons: string[] = [
      `Raises ${coordLabel} from ${item.fromStar}★ → ${item.toStar}★`,
    ];

    if (item.starSim.tenStarsCreated > 0) {
      reasons.push(`Immediately forges a 10★ Mythic Relic (Achieved & Cleared from board!)`);
    } else if (item.triggersImmediateMerge) {
      const chainPath = [
        `${item.starSim.merges[0].fromStar}★`,
        ...item.starSim.merges.map((m) => `${m.toStar}★`),
      ].join(' → ');
      reasons.push(
        `Immediately triggers ${
          item.starSim.maxChainDepth >= 2
            ? `${item.starSim.maxChainDepth}-step cascade (${chainPath})`
            : `merge (${chainPath})`
        } clearing ${item.starSim.totalTilesCleared} tile(s)`
      );
    }

    if (earnsExtraHammer) {
      reasons.push(
        `Triggers 5+ relic super-merge (+1 Extra Hammer → ${item.hammersAfterStar}/${MAX_HAMMERS})`
      );
    }

    if (item.isDeadRetired && item.triggersImmediateMerge) {
      reasons.push(`Eliminates retired ${item.fromStar}★ dead space via immediate merge`);
    }

    if (savesFromGameOver) {
      reasons.push(`Prevents immediate Game Over`);
    }

    return {
      cellIndex: item.cellIdx,
      col: item.col,
      row: item.row,
      fromStar: item.fromStar,
      toStar: item.toStar,
      starSim: item.starSim,
      isDeadRetired: item.isDeadRetired,
      isAtRisk: item.isAtRisk,
      netGainScore,
      bestMoveAfterStar,
      savesFromGameOver,
      triggersImmediateMerge: item.triggersImmediateMerge,
      unlocksNewTierOrCascade: isMajorCascade,
      earnsExtraHammer,
      createsTenStar,
      rescuesDeadOrAtRisk,
      reason: reasons.join(' • '),
    };
  });

  evaluatedTargets.sort((a, b) => {
    if (a.savesFromGameOver !== b.savesFromGameOver) {
      return a.savesFromGameOver ? -1 : 1;
    }
    if (a.createsTenStar !== b.createsTenStar) {
      return a.createsTenStar ? -1 : 1;
    }
    if (a.earnsExtraHammer !== b.earnsExtraHammer) {
      return a.earnsExtraHammer ? -1 : 1;
    }
    if (a.unlocksNewTierOrCascade !== b.unlocksNewTierOrCascade) {
      return a.unlocksNewTierOrCascade ? -1 : 1;
    }
    return b.netGainScore - a.netGainScore;
  });

  const bestTarget = evaluatedTargets[0] ?? null;
  const alternativeTargets = evaluatedTargets.slice(1);

  if (!bestTarget) {
    return {
      urgency: 'hold-save',
      shouldUseNow: false,
      headline: '⭐ HOLD 1× STAR — Save for Later',
      rationale: 'No high-impact Star upgrade target on the current board.',
      recommendedTarget: null,
      alternativeTargets: [],
    };
  }

  const targetCoord = formatCellCoord(bestTarget.col, bestTarget.row);

  // 1. Critical Survival: player is blocked / lethal
  if (bestTarget.savesFromGameOver) {
    return {
      urgency: 'critical-survival',
      shouldUseNow: true,
      headline: `🚨 USE 1× STAR NOW — Upgrade ${targetCoord} (${bestTarget.fromStar}★ → ${bestTarget.toStar}★) to Save Run!`,
      rationale: `All current piece placements are lethal/blocked. Using your 1× Star on ${targetCoord} (${bestTarget.fromStar}★ → ${bestTarget.toStar}★) clears space and saves your run!`,
      recommendedTarget: bestTarget,
      alternativeTargets,
    };
  }

  // 2. High-Value Payoffs: 10★ Finisher, +1 Hammer from 5+ Super-Merge, or Major Multi-Step Cascade
  if (bestTarget.createsTenStar) {
    return {
      urgency: 'high-value-cascade',
      shouldUseNow: true,
      headline: `👑 USE 1× STAR NOW — Upgrade ${targetCoord} (${bestTarget.fromStar}★ → ${bestTarget.toStar}★) to Forge 10★!`,
      rationale: `${bestTarget.reason}. This completes your 10★ Mythic achievement and clears the tile from the board!`,
      recommendedTarget: bestTarget,
      alternativeTargets,
    };
  }

  if (bestTarget.earnsExtraHammer) {
    return {
      urgency: 'high-value-cascade',
      shouldUseNow: true,
      headline: `🔨 USE 1× STAR NOW — Upgrade ${targetCoord} (${bestTarget.fromStar}★ → ${bestTarget.toStar}★) for 5+ Merge & +1 Hammer!`,
      rationale: `${bestTarget.reason}. Earning an extra Hammer increases your tactical reserve to ${bestTarget.starSim.hammersEarned + hammerCount}/${MAX_HAMMERS}!`,
      recommendedTarget: bestTarget,
      alternativeTargets,
    };
  }

  if (bestTarget.unlocksNewTierOrCascade) {
    return {
      urgency: 'high-value-cascade',
      shouldUseNow: true,
      headline: `⭐ USE 1× STAR NOW — Upgrade ${targetCoord} (${bestTarget.fromStar}★ → ${bestTarget.toStar}★) for Multi-Step Cascade!`,
      rationale: `${bestTarget.reason}. Triggering this high-tier cascade clears multiple tiles and reorganizes your board.`,
      recommendedTarget: bestTarget,
      alternativeTargets,
    };
  }

  // 3. Retired Dead-Space Promotion: only if it immediately merges away dead space in congested/late-game board
  if (
    bestTarget.rescuesDeadOrAtRisk &&
    (emptyCellsNow <= 8 || maxUnlockedStar >= 7)
  ) {
    return {
      urgency: 'straggler-rescue',
      shouldUseNow: true,
      headline: `✨ GOOD TIME FOR 1× STAR — Rescue Retired ${bestTarget.fromStar}★ at ${targetCoord} (→ ${bestTarget.toStar}★)`,
      rationale: `${bestTarget.reason}. Eliminating permanently retired dead space keeps your board open without spending a Hammer.`,
      recommendedTarget: bestTarget,
      alternativeTargets,
    };
  }

  // 4. Default: HOLD 1× Star (Save for 10★ finisher, +1 Hammer, or emergency)
  const previewTargetDesc = bestTarget
    ? `Best target if used later: ${targetCoord} (${bestTarget.fromStar}★ → ${bestTarget.toStar}★${
        bestTarget.triggersImmediateMerge ? ', immediate merge' : ', no immediate merge'
      }).`
    : '';

  return {
    urgency: 'hold-save',
    shouldUseNow: false,
    headline: `🛡️ HOLD 1× STAR — Save Your 1× Run Star for Later`,
    rationale: `You only get 1 Star for the entire run. Do not spend it on an unmerged tile or low-stakes upgrade. Save it for a 10★ finisher, a 5+ super-merge (+1 Hammer), or saving your run from a game-over block. ${previewTargetDesc}`.trim(),
    recommendedTarget: bestTarget,
    alternativeTargets,
  };
}
