import { describe, expect, it } from 'vitest';
import { getMinActiveSpawnStar } from './constants';
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
  applyPostMergeStarAdjustment,
  simulatePlacement,
} from './simulator';
import { solveBestMoves } from './solver';

describe('EF2 Relic Forge Domain & Solver Verification Suite', () => {
  it('1. Honeycomb Adjacency Verification: Even and Odd column 6-neighbor lookup matches Section 2.1', () => {
    // Even Column: Col 2, Row 2
    const evenNeighbors = getDirectionalNeighbors(2, 2, '23-cell');
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
    const oddNeighbors = getDirectionalNeighbors(1, 1, '23-cell');
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
      1,
      '23-cell'
    );
    expect(placed).not.toBeNull();
    expect(placed!.map((p) => [p.col, p.row, p.star])).toEqual([
      [2, 1, 2],
      [1, 1, 2],
      [2, 0, 3],
    ]);

    const sim = simulatePlacement(board, 5, placed!, '23-cell');
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
      true,
      '23-cell'
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
      true,
      '23-cell'
    );

    const resRot3 = solveBestMoves(
      board,
      scenario2.maxUnlockedStar,
      { ...scenario2.currentPiece, rotation: 3 },
      scenario2.nextPiece,
      true,
      '23-cell'
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
      true,
      '23-cell'
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
      e1Move!.warnings.some((w) => w.includes('0 open neighbor spots'))
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

    const sim = simulatePlacement(board, 4, placed, '23-cell');

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
      1,
      '23-cell'
    );
    expect(chevronCells).not.toBeNull();
    expect(chevronCells!.map((c) => [c.col, c.row])).toEqual([
      [2, 1], // C2 (Top vertex)
      [1, 1], // B2 (Lower-left SW)
      [3, 1], // D2 (Lower-right SE)
    ]);
  });

  it('8. 5-Tile Super Merge (+2★ Jump) & Post-Merge Lucky +1★ Evolution Adjustment', () => {
    const board = new Uint8Array(25);
    board[cellToIndex(1, 1)] = 1; // B2 = 1★
    board[cellToIndex(1, 2)] = 1; // B3 = 1★
    board[cellToIndex(2, 1)] = 3; // C2 = 3★
    board[cellToIndex(2, 2)] = 3; // C3 = 3★

    // Place 3-tile [1★, 1★, 1★] at B4 (1,3), C4 (2,3), C5 (2,4) -> 5 total 1★ tiles!
    const placed = [
      { tileIndex: 0, col: 1, row: 3, cellIndex: cellToIndex(1, 3), star: 1 }, // B4
      { tileIndex: 1, col: 2, row: 3, cellIndex: cellToIndex(2, 3), star: 1 }, // C4
      { tileIndex: 2, col: 2, row: 4, cellIndex: cellToIndex(2, 4), star: 1 }, // C5
    ];

    const simSuper = simulatePlacement(board, 4, placed, '23-cell', undefined, true);
    expect(simSuper.merges[0].fromStar).toBe(1);
    expect(simSuper.merges[0].toStar).toBe(3); // 5× 1★ -> 3★ (+2★ jump!)
    expect(simSuper.merges[0].landingCell).toBe(cellToIndex(1, 3)); // Lands at B4!

    // Also test +1★ Lucky Evolution helper on a standard +1★ merge
    const simStd = simulatePlacement(board, 4, placed, '23-cell', undefined, false);
    expect(simStd.merges[0].toStar).toBe(2);
    const lucky = applyPostMergeStarAdjustment(
      simStd.nextBoard,
      4,
      cellToIndex(1, 3),
      1,
      '23-cell'
    );
    expect(lucky.finalStar).toBe(3);
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
      true,
      '23-cell'
    );

    const best = res.topRecommendations[0];
    // Best move MUST unlock 5★ rather than hoarding unmerged 4★ tiles!
    expect(best.ply1Sim.nextMaxStar).toBe(5);

    // Also verify analyzeShapeMobility detects 0 3-Triangle slots on the user's shared URL board
    const cloggedBoard = new Uint8Array([
      1, 1, 0, 4, 4, 4, 4, 2, 3, 0, 0, 2, 0, 4, 0, 4, 4, 0, 0, 0, 0, 0, 0, 4, 0,
    ]);
    const mob = analyzeShapeMobility(cloggedBoard, '23-cell');
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

    const sim = simulatePlacement(board, 6, placed, '23-cell');
    expect(sim.merges).toHaveLength(2);
    expect(sim.merges[0].fromStar).toBe(4);
    expect(sim.merges[0].toStar).toBe(5);
    expect(sim.merges[0].landingCell).toBe(cellToIndex(2, 1)); // Lands at C2 to chain with D1-D2!
    expect(sim.merges[1].fromStar).toBe(5);
    expect(sim.merges[1].toStar).toBe(6);
  });
});
