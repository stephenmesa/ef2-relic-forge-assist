import { describe, expect, it } from 'vitest';
import {
  INITIAL_HAMMERS,
  MAX_HAMMERS,
  MAX_RUN_PLACEMENTS,
  MAX_STAR_UPGRADE_TARGET_GRADE,
  getMinActiveSpawnStar,
} from './constants';
import {
  cellToIndex,
  cubeToOffset,
  getDirectionalNeighbors,
  offsetToCube,
  resolvePiecePlacement,
  rotateCubeOffset,
} from './honeycomb';
import { buildBoardFromPreset, PRESET_SCENARIOS } from './presets';
import {
  analyzeShapeMobility,
  simulatePlacement,
  simulateStarUpgrade,
} from './simulator';
import {
  evaluateHammerAdvice,
  evaluateStarAdvice,
  solveBestMoves,
} from './solver';

describe('EF2 Relic Forge Domain & Solver Verification Suite', () => {
  it('1. Honeycomb Adjacency Verification: Even and Odd column 6-neighbor lookup matches Section 2.1', () => {
    // Even Column: Col 2, Row 2
    const evenNeighbors = getDirectionalNeighbors(2, 2);
    expect(evenNeighbors).toHaveLength(6);
    const evenByDir = Object.fromEntries(
      evenNeighbors.map((n) => [n.dir, [n.col, n.row]])
    );
    expect(evenByDir.N).toEqual([2, 1]);
    expect(evenByDir.S).toEqual([2, 3]);
    expect(evenByDir.NW).toEqual([1, 1]);
    expect(evenByDir.SW).toEqual([1, 2]);
    expect(evenByDir.NE).toEqual([3, 1]);
    expect(evenByDir.SE).toEqual([3, 2]);

    // Odd Column: Col 1, Row 1
    const oddNeighbors = getDirectionalNeighbors(1, 1);
    expect(oddNeighbors).toHaveLength(6);
    const oddByDir = Object.fromEntries(
      oddNeighbors.map((n) => [n.dir, [n.col, n.row]])
    );
    expect(oddByDir.N).toEqual([1, 0]);
    expect(oddByDir.S).toEqual([1, 2]);
    expect(oddByDir.NW).toEqual([0, 1]);
    expect(oddByDir.SW).toEqual([0, 2]);
    expect(oddByDir.NE).toEqual([2, 1]);
    expect(oddByDir.SE).toEqual([2, 2]);
  });

  it('2. Cube Coordinate Conversion & 60° CW Rotation: Rotates N -> NE -> SE -> S -> SW -> NW', () => {
    const north: [number, number, number] = [0, -1, 1];
    expect(rotateCubeOffset(north, 0)).toEqual([0, -1, 1]); // N
    expect(rotateCubeOffset(north, 1)).toEqual([1, -1, 0]); // NE
    expect(rotateCubeOffset(north, 2)).toEqual([1, 0, -1]); // SE
    expect(rotateCubeOffset(north, 3)).toEqual([0, 1, -1]); // S
    expect(rotateCubeOffset(north, 4)).toEqual([-1, 1, 0]); // SW
    expect(rotateCubeOffset(north, 5)).toEqual([-1, 0, 1]); // NW
    expect(rotateCubeOffset(north, 6)).toEqual([0, -1, 1]); // Full 360°

    // Verify round-trip offset <-> cube across all 25 coordinates
    for (let c = 0; c < 5; c++) {
      for (let r = 0; r < 5; r++) {
        const cube = offsetToCube(c, r);
        expect(cube[0] + cube[1] + cube[2]).toBe(0);
        const back = cubeToOffset(cube);
        expect(back).toEqual({ col: c, row: r });
      }
    }
  });

  it('3. Merge Anchor & Cascade Fidelity: Scenario 2 triggers 2★ -> 3★ -> 4★ double cascade on placed cell', () => {
    const scenario2 = PRESET_SCENARIOS[1];
    const board = buildBoardFromPreset(scenario2);

    // Place Bent-3 [2★, 2★, 3★] with rotation 4 at anchor (Col 2, Row 1)
    // T0 = (2, 1) [2★], T1 = (1, 1) [2★], T2 = (2, 0) [3★]
    const placed = resolvePiecePlacement(
      'bent3',
      4,
      [2, 2, 3],
      2,
      1
    );
    expect(placed).not.toBeNull();
    expect(placed!.map((p) => [p.col, p.row, p.star])).toEqual([
      [2, 1, 2],
      [1, 1, 2],
      [2, 0, 3],
    ]);

    const sim = simulatePlacement(board, 5, placed!);
    expect(sim.maxChainDepth).toBeGreaterThanOrEqual(2);
    expect(sim.merges[0].fromStar).toBe(2);
    expect(sim.merges[0].toStar).toBe(3);
    expect(sim.merges[0].landingCell).toBe(cellToIndex(2, 1));
    expect(sim.merges[1].fromStar).toBe(3);
    expect(sim.merges[1].toStar).toBe(4);
    expect(sim.merges[1].landingCell).toBe(cellToIndex(2, 1));
  });

  it('4. Straggler & Window Shift Protection: Scenario 3 ranks 6★ unlock + 2★ straggler rescue #1 and flags traps', () => {
    const scenario3 = PRESET_SCENARIOS[2];
    const board = buildBoardFromPreset(scenario3);

    const result = solveBestMoves(
      board,
      scenario3.maxUnlockedStar,
      scenario3.currentPiece,
      scenario3.nextPiece,
      true
    );

    expect(result.topRecommendations.length).toBeGreaterThan(0);
    const bestMove = result.topRecommendations[0];

    // Best move should rescue the 2★ straggler and leave 0 dead spaces after Ply 2
    expect(bestMove.deadSpacesAfter).toBe(0);
    expect(bestMove.rescuedStragglersCount).toBeGreaterThan(0);

    // Meanwhile, moves that unlock 6★ without rescuing the 2★ tile should be flagged with a warning
    const trapMoves = result.candidates.filter(
      (c) => c.trapsRetiredTilesCount > 0
    );
    expect(trapMoves.length).toBeGreaterThan(0);
    expect(trapMoves[0].warnings.some((w) => w.includes('traps'))).toBe(true);
    expect(bestMove.totalScore).toBeGreaterThan(trapMoves[0].totalScore);
  });

  it('5. Rotation-Invariant Solver & < 150ms Performance Budget', () => {
    const scenario2 = PRESET_SCENARIOS[1];
    const board = buildBoardFromPreset(scenario2);

    const resRot0 = solveBestMoves(
      board,
      scenario2.maxUnlockedStar,
      { ...scenario2.currentPiece, rotation: 0 },
      scenario2.nextPiece,
      true
    );

    const resRot3 = solveBestMoves(
      board,
      scenario2.maxUnlockedStar,
      { ...scenario2.currentPiece, rotation: 3 },
      scenario2.nextPiece,
      true
    );

    expect(resRot0.topRecommendations[0].totalScore).toBe(
      resRot3.topRecommendations[0].totalScore
    );
    expect(resRot0.elapsedMs).toBeLessThan(150);
  });

  it('6. Walled-In Corner Pocket Protection (User Screenshot Scenario): Never traps 1★ at E1 (4,0) and instead pairs 1★ with Next Piece [1★, 2★, 2★]', () => {
    const board = new Uint8Array(25);
    board[cellToIndex(1, 2)] = 3; // B3 = 3★
    board[cellToIndex(3, 0)] = 4; // D1 = 4★
    board[cellToIndex(4, 1)] = 3; // E2 = 3★

    const res = solveBestMoves(
      board,
      4,
      { shapeId: 'single', rotation: 0, tileStars: [1] },
      { shapeId: 'bent3', rotation: 0, tileStars: [1, 2, 2] },
      true
    );

    const best = res.topRecommendations[0];
    // Best move must NOT be E1 (4, 0)
    expect([best.anchorCol, best.anchorRow]).not.toEqual([4, 0]);
    expect(best.warnings).toHaveLength(0);

    // E1 (4, 0) must be flagged as trapping 1★ with 0 open neighbor spots and ranked last
    const e1Move = res.candidates.find(
      (c) => c.anchorCol === 4 && c.anchorRow === 0
    );
    expect(e1Move).toBeDefined();
    expect(
      e1Move!.warnings.some((w) => w.includes('0 open neighbor spots') || w.includes('Walled-In'))
    ).toBe(true);
    expect(best.totalScore).toBeGreaterThan(e1Move!.totalScore + 2000);
  });

  it('7. Real-Game Multi-Tile Merge Landing Rule (A4-B4-C4 Screenshot): Merged 2★ -> 3★ lands on bridge B4 (1,3), NOT C4 (2,3)', () => {
    const board = new Uint8Array(25);
    board[cellToIndex(0, 1)] = 2; // A2 = 2★
    board[cellToIndex(0, 2)] = 3; // A3 = 3★
    board[cellToIndex(0, 3)] = 2; // A4 = 2★ (pre-existing 2★ that connects to B4!)
    board[cellToIndex(1, 0)] = 2; // B1 = 2★
    board[cellToIndex(1, 1)] = 1; // B2 = 1★
    board[cellToIndex(2, 2)] = 3; // C3 = 3★
    board[cellToIndex(3, 0)] = 4; // D1 = 4★
    board[cellToIndex(3, 1)] = 4; // D2 = 4★

    // Place [2★, 2★, 3★] at B4 (1,3), C4 (2,3), C5 (2,4)
    const placed = [
      { tileIndex: 0, col: 1, row: 3, cellIndex: cellToIndex(1, 3), star: 2 }, // B4
      { tileIndex: 1, col: 2, row: 3, cellIndex: cellToIndex(2, 3), star: 2 }, // C4
      { tileIndex: 2, col: 2, row: 4, cellIndex: cellToIndex(2, 4), star: 3 }, // C5
    ];

    const sim = simulatePlacement(board, 4, placed);

    // The 2★ merge (A4 + B4 + C4) MUST land at B4 (1,3), NOT C4 (2,3)!
    expect(sim.merges).toHaveLength(1);
    expect(sim.merges[0].fromStar).toBe(2);
    expect(sim.merges[0].toStar).toBe(3);
    expect(sim.merges[0].landingCell).toBe(cellToIndex(1, 3)); // B4!
    expect(sim.nextBoard[cellToIndex(1, 3)]).toBe(3); // B4 has the upgraded 3★
    expect(sim.nextBoard[cellToIndex(2, 3)]).toBe(0); // C4 was cleared in the merge
    expect(sim.nextBoard[cellToIndex(2, 4)]).toBe(3); // C5 still has its 3★

    // Also verify chevron3 (^ shape) places T0 at top vertex (2,1), T1 at SW (1,1), T2 at SE (3,1)
    const chevronCells = resolvePiecePlacement(
      'chevron3',
      0,
      [1, 2, 3],
      2,
      1
    );
    expect(chevronCells).not.toBeNull();
    expect(chevronCells!.map((c) => [c.col, c.row])).toEqual([
      [2, 1], // C2 (Top vertex)
      [1, 1], // B2 (Lower-left SW)
      [3, 1], // D2 (Lower-right SE)
    ]);
  });

  it('8. 5-Tile Super Evolution (+2★ Jump): 5+ connected relics evolve +2★ instead of +1★ (3 or 4 relics)', () => {
    const board = new Uint8Array(25);
    board[cellToIndex(1, 1)] = 1; // B2 = 1★
    board[cellToIndex(1, 2)] = 1; // B3 = 1★
    board[cellToIndex(2, 1)] = 3; // C2 = 3★
    board[cellToIndex(2, 2)] = 3; // C3 = 3★

    // Place 3-tile [1★, 1★, 1★] at B4 (1,3), C4 (2,3), C5 (2,4) with Anchor Dot (●) on C4 -> 5 total 1★ tiles!
    const placed5 = [
      { tileIndex: 0, col: 1, row: 3, cellIndex: cellToIndex(1, 3), star: 1, isAnchor: false }, // B4
      { tileIndex: 1, col: 2, row: 3, cellIndex: cellToIndex(2, 3), star: 1, isAnchor: true },  // C4 ●
      { tileIndex: 2, col: 2, row: 4, cellIndex: cellToIndex(2, 4), star: 1, isAnchor: false }, // C5
    ];

    const simSuper = simulatePlacement(board, 4, placed5);
    expect(simSuper.merges[0].fromStar).toBe(1);
    expect(simSuper.merges[0].toStar).toBe(3); // 5× 1★ -> 3★ (+2★ jump!)
    expect(simSuper.merges[0].landingCell).toBe(cellToIndex(2, 3)); // Lands on Anchor Dot ● at C4!
    expect(simSuper.merges[1].fromStar).toBe(3);
    expect(simSuper.merges[1].toStar).toBe(4); // Chains into C2-C3 (3★ -> 4★)!

    // Contrast with 4 connected relics (e.g. [1★, 1★, 2★]), which evolve +1★ (1★ -> 2★)
    const placed4 = [
      { tileIndex: 0, col: 1, row: 3, cellIndex: cellToIndex(1, 3), star: 1, isAnchor: true },  // B4 ●
      { tileIndex: 1, col: 2, row: 3, cellIndex: cellToIndex(2, 3), star: 1, isAnchor: false }, // C4
      { tileIndex: 2, col: 2, row: 4, cellIndex: cellToIndex(2, 4), star: 2, isAnchor: false }, // C5
    ];
    const simFour = simulatePlacement(board, 4, placed4);
    expect(simFour.merges[0].fromStar).toBe(1);
    expect(simFour.merges[0].toStar).toBe(2); // 4× 1★ -> 2★ (+1★ standard evolution)
  });

  it('9. Anti-Hoarding & 3-Triangle Shape Protection: Unlocks 5★ rather than hoarding disconnected 4★ islands even when 1★ remains on board', () => {
    // Board with a 4★-4★ pair at D1-D2, a 3★-3★ pair at C2-C3 adjacent to D1-D2,
    // and two 1★ tiles at A1-A2 that cannot be cleared this turn.
    const board = new Uint8Array(25);
    board[cellToIndex(0, 0)] = 1; // A1 = 1★
    board[cellToIndex(0, 1)] = 1; // A2 = 1★
    board[cellToIndex(3, 0)] = 4; // D1 = 4★
    board[cellToIndex(3, 1)] = 4; // D2 = 4★
    board[cellToIndex(2, 1)] = 3; // C2 = 3★
    board[cellToIndex(2, 2)] = 3; // C3 = 3★
    board[cellToIndex(0, 3)] = 3; // A4 = 3★ (disconnected 3★ in another corner)
    board[cellToIndex(0, 4)] = 3; // A5 = 3★

    // Current Piece has [3★, 2★], Next Piece has [2★, 3★] (no 1★ in queue to rescue A1-A2)
    // Merging 3★ at C1/D3 chains 3★ -> 4★ -> 5★ (unlocking 5★ and clearing D1-D2 + C2-C3!),
    // whereas merging 3★ at A3 only creates a second disconnected 4★ at A3 without unlocking 5★.
    const res = solveBestMoves(
      board,
      4,
      { shapeId: 'pair', rotation: 0, tileStars: [3, 2] },
      { shapeId: 'pair', rotation: 0, tileStars: [2, 3] },
      true
    );

    const best = res.topRecommendations[0];
    // Best move MUST unlock 5★ rather than hoarding unmerged 4★ tiles!
    expect(best.ply1Sim.nextMaxStar).toBe(5);

    // Also verify analyzeShapeMobility detects 0 3-Triangle slots on the user's shared URL board
    const cloggedBoard = new Uint8Array([
      1, 1, 0, 4, 4, 4, 4, 2, 3, 0, 0, 2, 0, 4, 0, 4, 4, 0, 0, 0, 0, 0, 0, 4, 0,
    ]);
    const mob = analyzeShapeMobility(cloggedBoard);
    expect(mob.compact3TriangleSlots).toBe(0);
    expect(mob.vulnerableShapes).toContain('3-Triangle (0 fits!)');
  });

  it('10. Infographic Strategy Alignment: 4★ Retirement Cap at M>=8 & Self-Merging [4★,4★,4★] Combo Square Rotation', () => {
    // 1. Infographic Column 5: 4★ Purple Warhammer never retires at M=8 or M=9
    expect(getMinActiveSpawnStar(4)).toBe(1);
    expect(getMinActiveSpawnStar(5)).toBe(2);
    expect(getMinActiveSpawnStar(6)).toBe(3);
    expect(getMinActiveSpawnStar(7)).toBe(4);
    expect(getMinActiveSpawnStar(8)).toBe(4); // Capped at 4★!
    expect(getMinActiveSpawnStar(9)).toBe(4); // Capped at 4★!

    // 2. Infographic Columns 6 & 7: Triple Purple [4★, 4★, 4★] vertical line3 at C2-C3-C4
    // Board has two 5★ Red Swords at B1 (1,0) and C1 (2,0), which touch C2 (2,1) at the top
    // of the triple-purple bar, but do NOT touch C3 (2,2) or C4 (2,3).
    // When rotated so the combo square lands at C2 (2,1), it chains 4★ -> 5★ -> 6★!
    const board = new Uint8Array(25);
    board[cellToIndex(1, 0)] = 5; // B1 = 5★
    board[cellToIndex(2, 0)] = 5; // C1 = 5★

    const placed = [
      { tileIndex: 0, col: 2, row: 1, cellIndex: cellToIndex(2, 1), star: 4 }, // C2
      { tileIndex: 1, col: 2, row: 2, cellIndex: cellToIndex(2, 2), star: 4 }, // C3
      { tileIndex: 2, col: 2, row: 3, cellIndex: cellToIndex(2, 3), star: 4 }, // C4
    ];

    const sim = simulatePlacement(board, 6, placed);
    expect(sim.merges).toHaveLength(2);
    expect(sim.merges[0].fromStar).toBe(4);
    expect(sim.merges[0].toStar).toBe(5);
    expect(sim.merges[0].landingCell).toBe(cellToIndex(2, 1)); // Lands at C2 to chain with D1-D2!
    expect(sim.merges[1].fromStar).toBe(5);
    expect(sim.merges[1].toStar).toBe(6);
  });

  it('11. Anchor Relic Dot (●) on Piece: Deterministically lands merge on marked anchor tile & rotates 180° to chain', () => {
    // Board has two 5★ Red Swords at B1 (1,0) and C1 (2,0) which touch C2 (2,1), NOT C4 (2,3).
    // Suppose the player has a 3-Line [4★, 4★, 4★] where T2 (initially bottom at rotation 0) has the Anchor Dot (●).
    const board = new Uint8Array(25);
    board[cellToIndex(1, 0)] = 5; // B1 = 5★
    board[cellToIndex(2, 0)] = 5; // C1 = 5★

    // At rotation 0 (T1 at C2, T0 at C3, T2 ● at C4), the merge MUST land on T2 ● at C4 (no chain).
    const placedRot0 = resolvePiecePlacement('line3', 0, [4, 4, 4], 2, 2, 2)!;
    const simRot0 = simulatePlacement(board, 5, placedRot0);
    expect(simRot0.merges).toHaveLength(1);
    expect(simRot0.merges[0].landingCell).toBe(cellToIndex(2, 3)); // Lands on T2 ● at C4!

    // At rotation 3 (180° flip: T2 ● is now at top C2, T0 at C3, T1 at C4), the merge lands on T2 ● at C2 and chains 4★ -> 5★ -> 6★!
    const placedRot3 = resolvePiecePlacement('line3', 3, [4, 4, 4], 2, 2, 2)!;
    const simRot3 = simulatePlacement(board, 5, placedRot3);
    expect(simRot3.merges).toHaveLength(2);
    expect(simRot3.merges[0].landingCell).toBe(cellToIndex(2, 1)); // Lands on T2 ● at C2!
    expect(simRot3.merges[1].toStar).toBe(6);

    // Verify solveBestMoves recommends rotating to put T2 ● at C2 to trigger the 4★ -> 5★ -> 6★ chain!
    const solved = solveBestMoves(
      board,
      5,
      { shapeId: 'line3', rotation: 0, tileStars: [4, 4, 4], anchorTileIndex: 2 },
      { shapeId: 'pair', rotation: 0, tileStars: [3, 4], anchorTileIndex: 0 },
      false
    );
    expect(solved.topRecommendations[0].ply1Sim.nextMaxStar).toBe(6);
  });

  it('12. Single-Use Run Hammer Advisor: Advises HOLD early vs USE NOW for 7★+ final dead space or board lock', () => {
    // Case A: Early game (M=5★), plenty of open space (20 empty cells), 1 corner dead 1★ at A5 -> HOLD HAMMER
    const earlyBoard = new Uint8Array(25);
    earlyBoard[cellToIndex(0, 4)] = 1; // A5 = 1★ (retired at M=5★, but 22 empty cells remain)
    earlyBoard[cellToIndex(2, 2)] = 5; // C3 = 5★
    earlyBoard[cellToIndex(2, 1)] = 3; // C2 = 3★
    const earlyPiece = { shapeId: 'pair' as const, rotation: 0, tileStars: [2, 3], anchorTileIndex: 0 };
    const earlySolved = solveBestMoves(earlyBoard, 5, earlyPiece, earlyPiece, false);
    const earlyAdvice = evaluateHammerAdvice(
      earlyBoard,
      5,
      earlyPiece,
      earlyPiece,
      false,
      earlySolved
    );
    expect(earlyAdvice.shouldUseNow).toBe(false);
    expect(earlyAdvice.urgency).toBe('hold-save');

    // Case B: Late game (M=7★, where 4★ never retires at 8★+) with 1 final retired 2★ tile at C3 -> USE HAMMER NOW (Optimal Cleanup)
    const lateBoard = new Uint8Array(25);
    lateBoard[cellToIndex(2, 2)] = 2; // C3 = 2★ (only retired tile left on board at M=7★)
    lateBoard[cellToIndex(1, 1)] = 7; // B2 = 7★
    lateBoard[cellToIndex(3, 1)] = 5; // D2 = 5★
    const latePiece = { shapeId: 'pair' as const, rotation: 0, tileStars: [4, 5], anchorTileIndex: 0 };
    const lateSolved = solveBestMoves(lateBoard, 7, latePiece, latePiece, false);
    const lateAdvice = evaluateHammerAdvice(
      lateBoard,
      7,
      latePiece,
      latePiece,
      false,
      lateSolved
    );
    expect(lateAdvice.shouldUseNow).toBe(true);
    expect(lateAdvice.urgency).toBe('good-cleanup');
    expect(lateAdvice.recommendedTarget?.cellIndex).toBe(cellToIndex(2, 2));
    expect(lateAdvice.recommendedTarget?.clearsLastPermanentDeadSpace).toBe(true);

    // Case C: Capped at 2/2 Hammers with a retired dead tile -> USE HAMMER PROACTIVELY (to not waste cap)
    const cappedBoard = new Uint8Array(25);
    cappedBoard[cellToIndex(1, 1)] = 1; // B2 = 1★ (retired at M=5★)
    cappedBoard[cellToIndex(2, 2)] = 5; // C3 = 5★
    cappedBoard[cellToIndex(3, 2)] = 4; // D3 = 4★
    const cappedPiece = { shapeId: 'pair' as const, rotation: 0, tileStars: [3, 4], anchorTileIndex: 0 };
    const cappedSolved = solveBestMoves(cappedBoard, 5, cappedPiece, cappedPiece, false, 2);
    const cappedAdvice = evaluateHammerAdvice(
      cappedBoard,
      5,
      cappedPiece,
      cappedPiece,
      false,
      cappedSolved,
      2 // hammerCount = 2 (capped)
    );
    expect(cappedAdvice.shouldUseNow).toBe(true);
    expect(cappedAdvice.headline).toContain('2/2 Capped');
    expect(cappedAdvice.recommendedTarget?.cellIndex).toBe(cellToIndex(1, 1));
  });

  it('13. No-Hammer Dead-Relic Protection: Avoids merging to 8★ while a 3★ relic is on the board when Hammer is already used', () => {
    // Board at M=6★ has four 6★ relics (ready for a 5× 6★ -> 8★ super merge) AND a 3★ relic at A4 (0,3)
    const board = new Uint8Array(25);
    board[cellToIndex(0, 3)] = 3; // A4 = 3★ (will become dead if we jump to 8★!)
    board[cellToIndex(2, 0)] = 6; // C1 = 6★
    board[cellToIndex(2, 1)] = 6; // C2 = 6★
    board[cellToIndex(3, 1)] = 6; // D2 = 6★
    board[cellToIndex(3, 2)] = 6; // D3 = 6★

    // Current Piece has [6★, 4★], Next Piece has [3★, 3★] (which can clear A4 if we wait!)
    const currentPiece = { shapeId: 'pair' as const, rotation: 0, tileStars: [6, 4], anchorTileIndex: 0 };
    const nextPiece = { shapeId: 'pair' as const, rotation: 0, tileStars: [3, 3], anchorTileIndex: 0 };

    // With hammerAvailable = false (hammer already used), the #1 Best Move MUST NOT merge to 8★ and strand the 3★ relic!
    const resNoHammer = solveBestMoves(
      board,
      6,
      currentPiece,
      nextPiece,
      false,
      false // hammerAvailable = false
    );

    const bestMove = resNoHammer.topRecommendations[0];
    expect(bestMove.ply1Sim.nextMaxStar).toBe(6);
    expect(bestMove.trapsRetiredTilesCount).toBe(0);
    expect(bestMove.deadSpacesAfter).toBe(0);
  });

  it('14. Hammer Updates: 5+ relic merge awards +1 Hammer up to MAX_HAMMERS = 2', () => {
    expect(INITIAL_HAMMERS).toBe(1);
    expect(MAX_HAMMERS).toBe(2);

    const board = new Uint8Array(25);
    board[cellToIndex(1, 1)] = 2; // B2 = 2★
    board[cellToIndex(1, 2)] = 2; // B3 = 2★
    board[cellToIndex(2, 1)] = 2; // C2 = 2★
    board[cellToIndex(2, 2)] = 2; // C3 = 2★

    // A 3-piece placement connecting 2 more 2★s creates a 6-relic merge
    const placed5 = [
      { tileIndex: 0, col: 1, row: 3, cellIndex: cellToIndex(1, 3), star: 2, isAnchor: true },
      { tileIndex: 1, col: 2, row: 3, cellIndex: cellToIndex(2, 3), star: 2, isAnchor: false },
    ];
    const simSuper = simulatePlacement(board, 5, placed5);
    expect(simSuper.merges[0].mergedCells).toHaveLength(6);
    expect(simSuper.merges[0].earnedHammer).toBe(true);
    expect(simSuper.hammersEarned).toBe(1);

    // Standard 3-relic merge should NOT earn a hammer
    const board3 = new Uint8Array(25);
    board3[cellToIndex(1, 1)] = 2;
    board3[cellToIndex(1, 2)] = 2;
    const placed3 = [
      { tileIndex: 0, col: 1, row: 3, cellIndex: cellToIndex(1, 3), star: 2, isAnchor: true },
    ];
    const sim3 = simulatePlacement(board3, 5, placed3);
    expect(sim3.merges[0].mergedCells).toHaveLength(3);
    expect(sim3.merges[0].earnedHammer).toBe(false);
    expect(sim3.hammersEarned).toBe(0);
  });

  it('15. 10-Star Relic Disappearance Bug Fix: 10★ clears from board and marks run achievement', () => {
    // 3x 9★ relics merge to form a 10★
    const board = new Uint8Array(25);
    board[cellToIndex(2, 1)] = 9; // C2 = 9★
    board[cellToIndex(2, 2)] = 9; // C3 = 9★

    const placed9 = [
      { tileIndex: 0, col: 2, row: 3, cellIndex: cellToIndex(2, 3), star: 9, isAnchor: true }, // C4 = 9★
    ];
    const sim10 = simulatePlacement(board, 9, placed9);
    expect(sim10.merges).toHaveLength(1);
    expect(sim10.merges[0].fromStar).toBe(9);
    expect(sim10.merges[0].toStar).toBe(10);
    expect(sim10.merges[0].disappearedAsTenStar).toBe(true);
    expect(sim10.tenStarsCreated).toBe(1);
    expect(sim10.nextMaxStar).toBe(10);
    // Landing cell and all merged cells MUST be cleared (value 0)
    expect(sim10.nextBoard[cellToIndex(2, 1)]).toBe(0);
    expect(sim10.nextBoard[cellToIndex(2, 2)]).toBe(0);
    expect(sim10.nextBoard[cellToIndex(2, 3)]).toBe(0);

    // 5x 8★ super-merge into 10★: jumps +2★ to 10★, earns +1 Hammer, and disappears from board
    const board8 = new Uint8Array(25);
    board8[cellToIndex(1, 1)] = 8;
    board8[cellToIndex(1, 2)] = 8;
    board8[cellToIndex(2, 1)] = 8;
    board8[cellToIndex(2, 2)] = 8;
    const placed8 = [
      { tileIndex: 0, col: 2, row: 3, cellIndex: cellToIndex(2, 3), star: 8, isAnchor: true },
    ];
    const simSuper10 = simulatePlacement(board8, 8, placed8);
    expect(simSuper10.merges[0].toStar).toBe(10);
    expect(simSuper10.merges[0].disappearedAsTenStar).toBe(true);
    expect(simSuper10.merges[0].earnedHammer).toBe(true);
    expect(simSuper10.hammersEarned).toBe(1);
    expect(simSuper10.tenStarsCreated).toBe(1);
    expect(simSuper10.nextBoard[cellToIndex(2, 3)]).toBe(0);
  });

  it('16. 1x Run Star Component: Upgrades 1★..8★, cascades merges, and rejects 9★ & empty cells', () => {
    expect(MAX_STAR_UPGRADE_TARGET_GRADE).toBe(8);

    const board = new Uint8Array(25);
    const c2 = cellToIndex(2, 1);
    const c3 = cellToIndex(2, 2);
    const c4 = cellToIndex(2, 3);
    board[c2] = 9;
    board[c3] = 9;
    board[c4] = 8; // Upgrade target: 8★ -> 9★, merging with C2 and C3 into 10★!

    // Empty cell cannot be upgraded
    expect(simulateStarUpgrade(board, 9, cellToIndex(0, 0))).toBeNull();

    // 9★ relic cannot be upgraded
    expect(simulateStarUpgrade(board, 9, c2)).toBeNull();

    // Upgrading C4 (8★) upgrades it to 9★, triggering a merge with C2 & C3 into 10★
    const simStar = simulateStarUpgrade(board, 9, c4);
    expect(simStar).not.toBeNull();
    expect(simStar!.merges).toHaveLength(1);
    expect(simStar!.merges[0].fromStar).toBe(9);
    expect(simStar!.merges[0].toStar).toBe(10);
    expect(simStar!.merges[0].disappearedAsTenStar).toBe(true);
    expect(simStar!.tenStarsCreated).toBe(1);
    expect(simStar!.nextBoard[c4]).toBe(0);

    // evaluateStarAdvice recommends using the Star on this game-winning move
    const advice = evaluateStarAdvice(board, 9);
    expect(advice.shouldUseNow).toBe(true);
    expect(advice.urgency).toBe('high-value-cascade');
    expect(advice.recommendedTarget?.createsTenStar).toBe(true);
    expect(advice.recommendedTarget?.cellIndex).toBe(c4);

    // Negative Case (User Screenshot Scenario): Unmerged 5★ at C3 on an open board
    // Must HOLD the once-per-run Star rather than burning it on a naked 5★ -> 6★ bump
    const holdBoard = new Uint8Array(25);
    holdBoard[cellToIndex(1, 1)] = 3; // B2 = 3★
    holdBoard[cellToIndex(2, 1)] = 3; // C2 = 3★
    holdBoard[cellToIndex(2, 2)] = 5; // C3 = 5★
    holdBoard[cellToIndex(2, 3)] = 4; // C4 = 4★
    holdBoard[cellToIndex(2, 4)] = 2; // C5 = 2★
    holdBoard[cellToIndex(3, 1)] = 3; // D2 = 3★
    holdBoard[cellToIndex(3, 2)] = 2; // D3 = 2★
    holdBoard[cellToIndex(3, 3)] = 2; // D4 = 2★

    const holdAdvice = evaluateStarAdvice(holdBoard, 5);
    expect(holdAdvice.shouldUseNow).toBe(false);
    expect(holdAdvice.urgency).toBe('hold-save');
    expect(holdAdvice.headline).toContain('HOLD 1× STAR');
  });

  it('17. Run Placement Cap (MAX_RUN_PLACEMENTS = 1000): Halts search at 0 remaining and limits lookahead at 1', () => {
    expect(MAX_RUN_PLACEMENTS).toBe(1000);

    const board = new Uint8Array(25);
    const piece = { shapeId: 'single' as const, rotation: 0, tileStars: [1], anchorTileIndex: 0 };

    // At 0 placements remaining (1000 made), solver returns immediately with no recommendations
    const cappedResult = solveBestMoves(
      board,
      4,
      piece,
      piece,
      true,
      1,
      0 // placementsRemaining = 0
    );
    expect(cappedResult.topRecommendations).toHaveLength(0);
    expect(cappedResult.candidates).toHaveLength(0);

    // At 1 placement remaining, solver executes Ply 1 only without evaluating Ply 2
    const lastPlacementResult = solveBestMoves(
      board,
      4,
      piece,
      piece,
      true,
      1,
      1 // placementsRemaining = 1
    );
    expect(lastPlacementResult.topRecommendations.length).toBeGreaterThan(0);
    expect(lastPlacementResult.topRecommendations[0].bestPly2).toBeNull();
  });

  it('18. Hammer Priority (User Screenshot Scenario): Prioritizes 5+ super-merges to stock up to 2 Hammers over 4-relic cascades', () => {
    // Board from user screenshot:
    // B1 (1,0) = 1★, B2 (1,1) = 1★
    // D1 (3,0) = 1★, D2 (3,1) = 1★
    // D4 (3,3) = 2★, D5 (3,4) = 2★
    const board = new Uint8Array(25);
    board[cellToIndex(1, 0)] = 1; // B1
    board[cellToIndex(1, 1)] = 1; // B2
    board[cellToIndex(3, 0)] = 1; // D1
    board[cellToIndex(3, 1)] = 1; // D2
    board[cellToIndex(3, 3)] = 2; // D4
    board[cellToIndex(3, 4)] = 2; // D5

    const currentPiece = { shapeId: 'pair' as const, rotation: 0, tileStars: [1, 1], anchorTileIndex: 0 };
    const nextPiece = { shapeId: 'line3' as const, rotation: 0, tileStars: [1, 1, 1], anchorTileIndex: 2 };

    // With 1 Hammer currently held (1/2), solver should prioritize the 6-relic merge at C1-C2 that generates
    // the 2nd Hammer (stocking up to 2/2) over the 4-relic merge at D3-E3 that only produces a 3★ cascade.
    const res = solveBestMoves(
      board,
      4,
      currentPiece,
      nextPiece,
      true,
      1 // hammerCount = 1 (1/2 Hammers)
    );

    const bestMove = res.topRecommendations[0];
    expect(bestMove.ply1Sim.hammersEarned).toBe(1);
    expect(bestMove.ply1Sim.merges[0].mergedCells.length).toBeGreaterThanOrEqual(5);
    expect(bestMove.strategicTag?.label).toContain('+1 Hammer');
  });

  it('19. Master Blueprint Verification: Column A/E 5-Relic Super-Merge at Center Anchor (A3/E3) & 10★ Climax', () => {
    // 1. Column A 5-Stack Setup: A1, A2, A4, A5 have 6★ relics staged, with center anchor A3 (0,2) empty
    const board = new Uint8Array(25);
    board[cellToIndex(0, 0)] = 6; // A1
    board[cellToIndex(0, 1)] = 6; // A2
    board[cellToIndex(0, 3)] = 6; // A4
    board[cellToIndex(0, 4)] = 6; // A5

    const singlePiece = {
      shapeId: 'single' as const,
      rotation: 0,
      tileStars: [6],
    };

    const res = solveBestMoves(
      board,
      6,
      singlePiece,
      singlePiece,
      false,
      1 // 1 hammer held
    );

    const bestMove = res.topRecommendations[0];
    // Dropping the 5th 6★ at A3 (col 0, row 2) links all 5 together
    expect(bestMove.anchorCol).toBe(0);
    expect(bestMove.anchorRow).toBe(2); // A3
    expect(bestMove.ply1Sim.merges).toHaveLength(1);
    expect(bestMove.ply1Sim.merges[0].mergedCells).toHaveLength(5);
    expect(bestMove.ply1Sim.merges[0].fromStar).toBe(6);
    expect(bestMove.ply1Sim.merges[0].toStar).toBe(8); // +2★ jump
    expect(bestMove.ply1Sim.merges[0].landingCell).toBe(cellToIndex(0, 2)); // A3
    expect(bestMove.ply1Sim.hammersEarned).toBe(1);
    expect(bestMove.strategicTag?.label).toContain('Blueprint 5-Super-Merge → 8★ at A3');
    expect(bestMove.highlights.some((h) => h.includes('Master Blueprint'))).toBe(true);

    // 2. Grand Climax: 5x 8★ relics super-merging directly into 10★ Mythic at C3
    const climaxBoard = new Uint8Array(25);
    climaxBoard[cellToIndex(1, 2)] = 8; // B3
    climaxBoard[cellToIndex(1, 3)] = 8; // B4
    climaxBoard[cellToIndex(3, 2)] = 8; // D3
    climaxBoard[cellToIndex(3, 3)] = 8; // D4

    const single8 = {
      shapeId: 'single' as const,
      rotation: 0,
      tileStars: [8],
    };

    const climaxRes = solveBestMoves(
      climaxBoard,
      8,
      single8,
      single8,
      false,
      2 // 2 hammers
    );

    const climaxBest = climaxRes.topRecommendations[0];
    // Placing 8★ at C3 (2,2) or C4 (2,3) unites the 5 relics into 10★ Mythic
    expect(climaxBest.anchorCol).toBe(2);
    expect(climaxBest.ply1Sim.tenStarsCreated).toBe(1);
    expect(climaxBest.ply1Sim.nextBoard[cellToIndex(2, 2)]).toBe(0); // 10★ cleared from board
    expect(climaxBest.strategicTag?.label).toContain('10★ Mythic Relic');
  });

  it('20. Endgame Blueprint Mode Hyper-Focus: Directs placements into Col A -> Col E -> Climax and blocks premature drops', () => {
    // Board has a generic 3-tile merge in the center (Col 2, 3★ relics), and Col A is open
    const board = new Uint8Array(25);
    board[cellToIndex(2, 0)] = 3; // C1
    board[cellToIndex(2, 1)] = 3; // C2

    // Piece has a 6★ and a 3★: [6★, 3★]
    const piece = {
      shapeId: 'pair' as const,
      rotation: 0,
      tileStars: [6, 3],
    };

    // 1. With Blueprint Mode OFF: Standard solver balances center merge
    const normalRes = solveBestMoves(board, 6, piece, piece, false, 1, 1000, false);
    expect(normalRes.blueprintProgress.activePhase).toBe(1);

    // 2. With Blueprint Mode ON: Hyper-focuses on Phase 1 (Col A perimeter)
    const bpRes = solveBestMoves(board, 6, piece, piece, false, 1, 1000, true);
    const topMove = bpRes.topRecommendations[0];
    // Must place the 6★ into Col A (col 0)!
    const placesInColA = topMove.placedTiles.some((pt) => pt.col === 0 && pt.star === 6);
    expect(placesInColA).toBe(true);
    expect(topMove.strategicTag?.label).toContain('[Blueprint P1]');

    // 3. When Col A is already completed (A3 has 8★), Blueprint Mode advances to Phase 2 (Col E)
    board[cellToIndex(0, 2)] = 8; // A3 anchor achieved!
    const bpPhase2Res = solveBestMoves(board, 8, piece, piece, false, 1, 1000, true);
    expect(bpPhase2Res.blueprintProgress.activePhase).toBe(2);
    const topP2Move = bpPhase2Res.topRecommendations[0];
    const placesInColE = topP2Move.placedTiles.some((pt) => pt.col === 4 && pt.star === 6);
    expect(placesInColE).toBe(true);
    expect(topP2Move.strategicTag?.label).toContain('[Blueprint P2]');
  });
});
