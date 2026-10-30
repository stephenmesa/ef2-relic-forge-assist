import { describe, expect, it } from 'vitest';
import {
  calculateSolverRating,
  compareEvaluations,
  generateRandomPiece,
  runEvaluationSuite,
  SeededPRNG,
  simulateGame,
} from './evaluator';
import { getActiveSpawnPool } from './constants';

describe('EF2 Relic Forge Evaluation & Rating Framework', () => {
  it('1. PRNG Determinism: Identical seeds produce identical sequence', () => {
    const prng1 = new SeededPRNG(42);
    const prng2 = new SeededPRNG(42);

    for (let i = 0; i < 20; i++) {
      expect(prng1.next()).toBe(prng2.next());
      expect(prng1.nextInt(1, 10)).toBe(prng2.nextInt(1, 10));
    }
  });

  it('2. Piece Generator respects active spawn pool per maxUnlockedStar', () => {
    const prng = new SeededPRNG(12345);

    // At 4★, pool is [1, 2, 3, 4]
    for (let i = 0; i < 10; i++) {
      const piece = generateRandomPiece(4, prng);
      expect(piece.tileStars.length).toBeGreaterThanOrEqual(1);
      for (const s of piece.tileStars) {
        expect(s).toBeGreaterThanOrEqual(1);
        expect(s).toBeLessThanOrEqual(4);
      }
    }

    // At 6★, pool is [3, 4, 5, 6] (1★ and 2★ retired)
    const pool6 = getActiveSpawnPool(6);
    expect(pool6).toEqual([3, 4, 5, 6]);
    for (let i = 0; i < 10; i++) {
      const piece = generateRandomPiece(6, prng);
      for (const s of piece.tileStars) {
        expect(pool6).toContain(s);
      }
    }

    // At 9★, pool is [4, 5, 6, 7] (4★ never retires!)
    const pool9 = getActiveSpawnPool(9);
    expect(pool9).toEqual([4, 5, 6, 7]);
    for (let i = 0; i < 10; i++) {
      const piece = generateRandomPiece(9, prng);
      for (const s of piece.tileStars) {
        expect(pool9).toContain(s);
      }
    }
  });

  it('3. Single Game Simulation: Deterministic game execution from seed', () => {
    const resA = simulateGame(0, { seed: 999, maxPlacements: 50 });
    const resB = simulateGame(0, { seed: 999, maxPlacements: 50 });

    expect(resA.placementsMade).toBe(resB.placementsMade);
    expect(resA.maxStarReached).toBe(resB.maxStarReached);
    expect(resA.tenStarsAchieved).toBe(resB.tenStarsAchieved);
    expect(resA.totalMerges).toBe(resB.totalMerges);
    expect(resA.totalSuperMerges).toBe(resB.totalSuperMerges);
    expect(resA.endReason).toBe(resB.endReason);
  });

  it('4. Solver Rating Calculation: Correctly grades different skill profiles', () => {
    // Grandmaster profile
    const gmRating = calculateSolverRating({
      totalGames: 100,
      winRate: 0.55,
      avgMaxStar: 9.6,
      avgPlacements: 95,
      avgSuperMerges: 3.2,
      avgDeadSpaces: 0.1,
      avgHammersEarned: 3.0,
    });

    expect(gmRating.overallScore).toBeGreaterThanOrEqual(90);
    expect(['S', 'S+']).toContain(gmRating.grade);
    expect(gmRating.elo).toBeGreaterThanOrEqual(2350);

    // Novice profile
    const noviceRating = calculateSolverRating({
      totalGames: 100,
      winRate: 0.05,
      avgMaxStar: 5.8,
      avgPlacements: 22,
      avgSuperMerges: 0.3,
      avgDeadSpaces: 2.5,
      avgHammersEarned: 0.2,
    });

    expect(noviceRating.overallScore).toBeLessThan(60);
    expect(['D', 'F']).toContain(noviceRating.grade);
  });

  it('5. Strategy Comparison & Diff: Detects improvement vs regression', () => {
    const baseline = runEvaluationSuite({ totalGames: 3, baseSeed: 100, maxPlacements: 25 });

    // Mock better candidate
    const candidateBetter = JSON.parse(JSON.stringify(baseline));
    candidateBetter.rating.overallScore += 8;
    candidateBetter.rating.elo += 120;
    candidateBetter.summary.winRatePercent += 15;

    const diffBetter = compareEvaluations(candidateBetter, baseline);
    expect(diffBetter.verdict).toBe('IMPROVEMENT');
    expect(diffBetter.scoreDelta).toBe(8);

    // Mock worse candidate
    const candidateWorse = JSON.parse(JSON.stringify(baseline));
    candidateWorse.rating.overallScore -= 10;
    candidateWorse.rating.elo -= 150;
    candidateWorse.summary.winRatePercent -= 20;

    const diffWorse = compareEvaluations(candidateWorse, baseline);
    expect(diffWorse.verdict).toBe('REGRESSION');
    expect(diffWorse.scoreDelta).toBe(-10);
  });

  it('6. Suite Execution: Simulates batch games and produces complete report', () => {
    const report = runEvaluationSuite({
      totalGames: 4,
      baseSeed: 200,
      maxPlacements: 30,
    });

    expect(report.summary.gamesCompleted).toBe(4);
    expect(report.games.length).toBe(4);
    expect(report.rating.overallScore).toBeGreaterThanOrEqual(0);
    expect(report.rating.overallScore).toBeLessThanOrEqual(100);
    expect(report.summary.movesPerSecond).toBeGreaterThan(0);
    expect(Object.keys(report.tierDistribution)).toHaveLength(7); // 4..10
  });

  it('7. Multi-Strategy Support: Evaluates specific strategies and verifies strategy metadata', () => {
    const mythicRes = simulateGame(0, {
      seed: 555,
      maxPlacements: 30,
      strategyId: 'mythic-climax',
    });
    expect(mythicRes.strategyId).toBe('mythic-climax');

    const survivalRes = simulateGame(0, {
      seed: 555,
      maxPlacements: 30,
      strategyId: 'max-survival',
    });
    expect(survivalRes.strategyId).toBe('max-survival');

    const spaceRes = simulateGame(0, {
      seed: 555,
      maxPlacements: 30,
      strategyId: 'max-space',
    });
    expect(spaceRes.strategyId).toBe('max-space');

    const suite = runEvaluationSuite({
      totalGames: 2,
      baseSeed: 777,
      maxPlacements: 20,
      strategyId: 'max-survival',
    });
    expect(suite.config.strategyId).toBe('max-survival');
    expect(suite.games[0].strategyId).toBe('max-survival');
  });
});

