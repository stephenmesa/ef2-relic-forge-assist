import {
  DEFAULT_STRATEGY_ID,
  getActiveSpawnPool,
  INITIAL_HAMMERS,
  MAX_HAMMERS,
  MAX_RUN_PLACEMENTS,
  PIECE_SHAPES,
  PIECE_SHAPE_ORDER,
} from './constants';
import { countEmptyCells } from './simulator';
import {
  evaluateHammerAdvice,
  evaluateStarAdvice,
  solveBestMoves,
} from './solver';
import {
  PieceConfig,
  PieceShapeId,
  SolverStrategyId,
} from '../types/forge';

/**
 * 32-bit fast, deterministic pseudorandom number generator (Mulberry32).
 * Guarantees identical piece sequences for a given seed across runs and machines.
 */
export class SeededPRNG {
  private state: number;

  constructor(seed: number = 42) {
    this.state = seed >>> 0;
  }

  /**
   * Returns a float in [0, 1).
   */
  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * Returns an integer in [min, max] inclusive.
   */
  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  /**
   * Returns a random element from `array`.
   */
  choice<T>(array: readonly T[]): T {
    return array[Math.floor(this.next() * array.length)];
  }
}

/**
 * Generates a random PieceConfig based on current max unlocked star level.
 */
export function generateRandomPiece(
  maxUnlockedStar: number,
  prng: SeededPRNG,
  shapesPool: readonly PieceShapeId[] = PIECE_SHAPE_ORDER
): PieceConfig {
  const shapeId = prng.choice(shapesPool);
  const activePool = getActiveSpawnPool(maxUnlockedStar);
  const count = PIECE_SHAPES[shapeId].tileCount;
  const tileStars = Array.from({ length: count }, () =>
    prng.choice(activePool)
  );

  return {
    shapeId,
    rotation: 0,
    tileStars,
    anchorTileIndex: 0,
  };
}

export interface SimulationOptions {
  seed?: number;
  maxPlacements?: number;
  initialBoard?: Uint8Array;
  initialMaxStar?: number;
  initialHammers?: number;
  initialStarAvailable?: boolean;
  blueprintMode?: boolean;
  strategyId?: SolverStrategyId;
  nextPieceKnown?: boolean;
  stopOnFirstTenStar?: boolean;
  hammerPolicy?: 'smart' | 'critical-only' | 'never';
  starPolicy?: 'smart' | 'critical-only' | 'never';
}

export interface GameSimulationResult {
  gameIndex: number;
  seed: number;
  strategyId: SolverStrategyId;
  placementsMade: number;
  maxStarReached: number;
  tenStarsAchieved: number;
  won: boolean; // reached >= 1 ten-star relic
  movesToFirstTenStar: number | null;
  totalMerges: number;
  totalSuperMerges: number; // 5+ relic merges
  hammersEarned: number;
  hammersUsed: number;
  starUsed: boolean;
  deadSpacesAtEnd: number;
  emptyCellsAtEnd: number;
  endReason: 'won' | 'board_locked' | 'max_placements';
  elapsedMs: number;
  finalBoard: Uint8Array;
}

/**
 * Simulates a single complete game of Relic Forge from start to finish.
 */
export function simulateGame(
  gameIndex: number = 0,
  options: SimulationOptions = {}
): GameSimulationResult {
  const startTime = performance.now();
  const seed = options.seed ?? 1000 + gameIndex;
  const prng = new SeededPRNG(seed);

  const maxPlacements = options.maxPlacements ?? MAX_RUN_PLACEMENTS;
  let board = options.initialBoard
    ? new Uint8Array(options.initialBoard)
    : new Uint8Array(25);
  let maxUnlockedStar = options.initialMaxStar ?? 4;
  let hammers = options.initialHammers ?? INITIAL_HAMMERS;
  let starAvailable = options.initialStarAvailable ?? true;
  const blueprintMode = options.blueprintMode ?? false;
  const strategyId = options.strategyId ?? DEFAULT_STRATEGY_ID;
  const nextPieceKnown = options.nextPieceKnown ?? true;
  const stopOnFirstTenStar = options.stopOnFirstTenStar ?? false;
  const hammerPolicy = options.hammerPolicy ?? 'smart';
  const starPolicy = options.starPolicy ?? 'smart';

  let currentPiece = generateRandomPiece(maxUnlockedStar, prng);
  let nextPiece = generateRandomPiece(maxUnlockedStar, prng);

  let placementsMade = 0;
  let tenStarsAchieved = 0;
  let movesToFirstTenStar: number | null = null;
  let totalMerges = 0;
  let totalSuperMerges = 0;
  let hammersEarned = 0;
  let hammersUsed = 0;
  let starUsed = false;
  let endReason: 'won' | 'board_locked' | 'max_placements' = 'max_placements';

  while (placementsMade < maxPlacements) {
    if (stopOnFirstTenStar && tenStarsAchieved > 0) {
      endReason = 'won';
      break;
    }

    const solverResult = solveBestMoves(
      board,
      maxUnlockedStar,
      currentPiece,
      nextPiece,
      nextPieceKnown,
      hammers,
      maxPlacements - placementsMade,
      blueprintMode,
      strategyId
    );

    // If solver found no valid placements:
    if (solverResult.topRecommendations.length === 0) {
      let unblocked = false;

      // 1. Try Hammer intervention
      if (hammers > 0 && hammerPolicy !== 'never') {
        const hammerAdvice = evaluateHammerAdvice(
          board,
          maxUnlockedStar,
          currentPiece,
          nextPiece,
          nextPieceKnown,
          solverResult,
          hammers
        );
        if (hammerAdvice.recommendedTarget) {
          board[hammerAdvice.recommendedTarget.cellIndex] = 0;
          hammers = Math.max(0, hammers - 1);
          hammersUsed++;
          unblocked = true;
        }
      }

      // 2. Try Star intervention if still blocked
      if (!unblocked && starAvailable && starPolicy !== 'never') {
        const starAdvice = evaluateStarAdvice(
          board,
          maxUnlockedStar,
          currentPiece,
          nextPiece,
          nextPieceKnown,
          solverResult,
          hammers
        );
        if (starAdvice.recommendedTarget) {
          const target = starAdvice.recommendedTarget;
          board = new Uint8Array(target.starSim.nextBoard);
          maxUnlockedStar = Math.max(maxUnlockedStar, target.starSim.nextMaxStar);
          if (target.starSim.tenStarsCreated > 0) {
            tenStarsAchieved += target.starSim.tenStarsCreated;
            if (movesToFirstTenStar === null) {
              movesToFirstTenStar = placementsMade;
            }
            maxUnlockedStar = 10;
          }
          if (target.starSim.hammersEarned > 0) {
            hammers = Math.min(MAX_HAMMERS, hammers + target.starSim.hammersEarned);
            hammersEarned += target.starSim.hammersEarned;
          }
          starAvailable = false;
          starUsed = true;
          unblocked = true;
        }
      }

      if (unblocked) {
        // Re-solve with updated board state
        continue;
      }

      // No move possible and no resources left to unblock
      endReason = tenStarsAchieved > 0 ? 'won' : 'board_locked';
      break;
    }

    // Proactive tactical Hammer usage when safe and highly advantageous (smart policy)
    if (
      hammers > 0 &&
      hammerPolicy === 'smart' &&
      solverResult.topRecommendations.length > 0
    ) {
      const bestMove = solverResult.topRecommendations[0];
      const emptyNow = countEmptyCells(board);
      const isCriticalCrunch = emptyNow <= 4;

      // If the best move is dangerous/lethal, or hammers are capped at 2/2, or board is critically crunched
      if (bestMove.isLethal || hammers === MAX_HAMMERS || (isCriticalCrunch && hammers >= 1)) {
        const hammerAdvice = evaluateHammerAdvice(
          board,
          maxUnlockedStar,
          currentPiece,
          nextPiece,
          nextPieceKnown,
          solverResult,
          hammers
        );
        if (
          hammerAdvice.shouldUseNow &&
          hammerAdvice.recommendedTarget &&
          (hammerAdvice.urgency === 'critical-survival' ||
            (hammers === MAX_HAMMERS && hammerAdvice.recommendedTarget.isDeadRetired) ||
            (isCriticalCrunch && hammerAdvice.recommendedTarget.triangleSlotsGained > 0))
        ) {
          board[hammerAdvice.recommendedTarget.cellIndex] = 0;
          hammers = Math.max(0, hammers - 1);
          hammersUsed++;
          // Re-evaluate move after tactical smash
          continue;
        }
      }
    }

    // Execute the #1 ranked recommendation
    const bestMove = solverResult.topRecommendations[0];
    const ply1Sim = bestMove.ply1Sim;

    board = new Uint8Array(ply1Sim.nextBoard);
    maxUnlockedStar = Math.max(maxUnlockedStar, ply1Sim.nextMaxStar);

    if (ply1Sim.tenStarsCreated > 0) {
      tenStarsAchieved += ply1Sim.tenStarsCreated;
      if (movesToFirstTenStar === null) {
        movesToFirstTenStar = placementsMade + 1;
      }
      maxUnlockedStar = 10;
    }

    totalMerges += ply1Sim.merges.length;
    const superCount = ply1Sim.merges.filter((m) => m.mergedCells.length >= 5).length;
    totalSuperMerges += superCount;

    if (ply1Sim.hammersEarned > 0) {
      hammers = Math.min(MAX_HAMMERS, hammers + ply1Sim.hammersEarned);
      hammersEarned += ply1Sim.hammersEarned;
    }

    placementsMade++;

    // Advance piece queue
    currentPiece = nextPiece;
    nextPiece = generateRandomPiece(maxUnlockedStar, prng);
  }

  if (placementsMade >= maxPlacements) {
    endReason = tenStarsAchieved > 0 ? 'won' : 'max_placements';
  }

  // Count dead spaces remaining on final board
  let deadSpacesAtEnd = 0;
  const minActiveStarAtEnd =
    maxUnlockedStar >= 8
      ? 4
      : Math.min(4, Math.max(1, maxUnlockedStar - 3));
  for (let i = 0; i < board.length; i++) {
    const s = board[i];
    if (s > 0 && s < minActiveStarAtEnd) {
      deadSpacesAtEnd++;
    }
  }

  const elapsedMs = performance.now() - startTime;

  return {
    gameIndex,
    seed,
    strategyId,
    placementsMade,
    maxStarReached: maxUnlockedStar,
    tenStarsAchieved,
    won: tenStarsAchieved > 0,
    movesToFirstTenStar,
    totalMerges,
    totalSuperMerges,
    hammersEarned,
    hammersUsed,
    starUsed,
    deadSpacesAtEnd,
    emptyCellsAtEnd: countEmptyCells(board),
    endReason,
    elapsedMs,
    finalBoard: board,
  };
}

export type SolverGrade = 'S+' | 'S' | 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';

export interface SolverRating {
  overallScore: number; // 0 - 100
  grade: SolverGrade;
  title: string;
  elo: number; // 1000 - 2500
  subscores: {
    mythicSuccess: number; // 0 - 100 (40% weight)
    tierProgression: number; // 0 - 100 (25% weight)
    boardSurvival: number; // 0 - 100 (15% weight)
    superMergeEconomy: number; // 0 - 100 (10% weight)
    boardCleanliness: number; // 0 - 100 (10% weight)
  };
  verdictSummary: string;
  strengths: string[];
  areasForImprovement: string[];
}

/**
 * Calculates a standardized Solver Rating (0-100, Grade, and ELO)
 * from an evaluation suite report.
 */
export function calculateSolverRating(
  stats: {
    totalGames: number;
    winRate: number; // 0..1
    avgMaxStar: number; // 4..10
    avgPlacements: number;
    avgSuperMerges: number;
    avgDeadSpaces: number;
    avgHammersEarned: number;
  }
): SolverRating {
  // 1. Mythic Success Score (40% weight):
  // Reaching 10★ is the core win objective. 40%+ win rate represents grandmaster skill.
  const mythicSuccess = Math.min(100, Math.round((stats.winRate / 0.40) * 100));

  // 2. Tier Progression Score (25% weight):
  // Scaling from 4★ (baseline = 0) to 10★ (max = 100).
  const tierProgression = Math.max(
    0,
    Math.min(100, Math.round(((stats.avgMaxStar - 4) / 6) * 100))
  );

  // 3. Board Survival Score (15% weight):
  // Surviving 30 moves is ~45, 60 moves is ~75, 90+ moves is 90+.
  const survivalRaw = Math.pow(Math.min(120, stats.avgPlacements) / 75, 0.75) * 80;
  const boardSurvival = Math.max(0, Math.min(100, Math.round(survivalRaw)));

  // 4. Super-Merge Economy Score (10% weight):
  // 5+ merges (+2★ jump and +1 hammer) are the lifeblood of high-level EF2 play.
  // Averaging 2.5 super-merges per game reaches 100.
  const superMergeEconomy = Math.max(
    0,
    Math.min(100, Math.round((stats.avgSuperMerges / 2.5) * 100))
  );

  // 5. Board Cleanliness Score (10% weight):
  // Low dead spaces (retired tiles) left behind on board.
  const cleanlinessRaw = 100 - stats.avgDeadSpaces * 30;
  const boardCleanliness = Math.max(0, Math.min(100, Math.round(cleanlinessRaw)));

  // Weighted Total
  const overallScore = Math.round(
    mythicSuccess * 0.40 +
    tierProgression * 0.25 +
    boardSurvival * 0.15 +
    superMergeEconomy * 0.10 +
    boardCleanliness * 0.10
  );

  // Compute Grade & Title
  let grade: SolverGrade = 'F';
  let title = 'Needs Tuning';
  if (overallScore >= 95) {
    grade = 'S+';
    title = 'Mythic Grandmaster';
  } else if (overallScore >= 90) {
    grade = 'S';
    title = 'Grandmaster';
  } else if (overallScore >= 85) {
    grade = 'A+';
    title = 'Master Strategist';
  } else if (overallScore >= 80) {
    grade = 'A';
    title = 'Expert Tactician';
  } else if (overallScore >= 70) {
    grade = 'B';
    title = 'Advanced Solver';
  } else if (overallScore >= 60) {
    grade = 'C';
    title = 'Competent Solver';
  } else if (overallScore >= 50) {
    grade = 'D';
    title = 'Novice Solver';
  }

  // ELO Rating: 1000 base + 15 * score
  const elo = Math.round(1000 + overallScore * 15);

  const strengths: string[] = [];
  const areasForImprovement: string[] = [];

  if (stats.winRate >= 0.35) {
    strengths.push(
      `High 10★ Mythic rate (${(stats.winRate * 100).toFixed(1)}% of runs reach 10★)`
    );
  } else {
    areasForImprovement.push(
      `10★ win rate (${(stats.winRate * 100).toFixed(1)}%) could be improved with better endgame anchoring`
    );
  }

  if (stats.avgMaxStar >= 8.5) {
    strengths.push(
      `Consistent late-game tier progression (avg peak ${stats.avgMaxStar.toFixed(1)}★)`
    );
  } else {
    areasForImprovement.push(
      `Peak tier progression stalls early (avg peak ${stats.avgMaxStar.toFixed(1)}★)`
    );
  }

  if (stats.avgSuperMerges >= 1.5) {
    strengths.push(
      `Strong 5+ relic super-merge execution (${stats.avgSuperMerges.toFixed(1)} super-merges/game)`
    );
  } else {
    areasForImprovement.push(
      `Low 5+ super-merge rate (${stats.avgSuperMerges.toFixed(1)}/game); missing hammer refund opportunities`
    );
  }

  if (stats.avgDeadSpaces <= 0.6) {
    strengths.push(
      `Superb straggler discipline with minimal retired dead space (${stats.avgDeadSpaces.toFixed(1)} dead tiles/game)`
    );
  } else {
    areasForImprovement.push(
      `Higher rate of trapped dead relics (${stats.avgDeadSpaces.toFixed(1)} dead tiles/game)`
    );
  }

  if (stats.avgPlacements >= 50) {
    strengths.push(
      `High board survivability (avg ${stats.avgPlacements.toFixed(1)} moves survived per run)`
    );
  }

  const verdictSummary =
    overallScore >= 85
      ? `Elite solver capability with strong late-game conversion and tactical discipline.`
      : overallScore >= 70
      ? `Solid solver with reliable mid-game performance; opportunities exist in endgame 10★ conversion.`
      : `Functional solver requiring tuning on straggler prevention and endgame lookahead.`;

  return {
    overallScore,
    grade,
    title,
    elo,
    subscores: {
      mythicSuccess,
      tierProgression,
      boardSurvival,
      superMergeEconomy,
      boardCleanliness,
    },
    verdictSummary,
    strengths,
    areasForImprovement,
  };
}

export interface EvalProgress {
  completedGames: number;
  totalGames: number;
  currentSeed: number;
  lastGameResult: GameSimulationResult;
}

export interface EvalSuiteReport {
  timestamp: string;
  config: {
    totalGames: number;
    baseSeed: number;
    maxPlacements: number;
    blueprintMode: boolean;
    strategyId: SolverStrategyId;
  };
  rating: SolverRating;
  summary: {
    gamesCompleted: number;
    winCount: number;
    winRatePercent: number;
    totalTenStarsAchieved: number;
    avgTenStarsPerGame: number;
    avgMaxStarReached: number;
    avgPlacements: number;
    avgMerges: number;
    avgSuperMerges: number;
    avgHammersEarned: number;
    avgHammersUsed: number;
    avgDeadSpaces: number;
    starUsageRatePercent: number;
    totalSimTimeMs: number;
    gamesPerSecond: number;
    movesPerSecond: number;
    avgMsPerMove: number;
  };
  tierDistribution: Record<
    number,
    { count: number; percentage: number }
  >;
  games: GameSimulationResult[];
}

export interface SuiteOptions {
  totalGames?: number;
  baseSeed?: number;
  maxPlacements?: number;
  blueprintMode?: boolean;
  strategyId?: SolverStrategyId;
  stopOnFirstTenStar?: boolean;
  onProgress?: (progress: EvalProgress) => void;
}

/**
 * Runs a complete evaluation suite across multiple games and computes
 * aggregate statistics, tier distributions, speed benchmarks, and the Solver Rating.
 */
export function runEvaluationSuite(options: SuiteOptions = {}): EvalSuiteReport {
  const totalGames = options.totalGames ?? 30;
  const baseSeed = options.baseSeed ?? 1000;
  const maxPlacements = options.maxPlacements ?? MAX_RUN_PLACEMENTS;
  const blueprintMode = options.blueprintMode ?? false;
  const strategyId = options.strategyId ?? DEFAULT_STRATEGY_ID;

  const suiteStartTime = performance.now();
  const games: GameSimulationResult[] = [];

  const tierCounts: Record<number, number> = {
    4: 0,
    5: 0,
    6: 0,
    7: 0,
    8: 0,
    9: 0,
    10: 0,
  };

  for (let i = 0; i < totalGames; i++) {
    const seed = baseSeed + i;
    const result = simulateGame(i, {
      seed,
      maxPlacements,
      blueprintMode,
      strategyId,
      stopOnFirstTenStar: options.stopOnFirstTenStar ?? false,
    });
    games.push(result);

    const peakTier = Math.min(10, Math.max(4, result.maxStarReached));
    tierCounts[peakTier] = (tierCounts[peakTier] ?? 0) + 1;

    if (options.onProgress) {
      options.onProgress({
        completedGames: i + 1,
        totalGames,
        currentSeed: seed,
        lastGameResult: result,
      });
    }
  }

  const totalSimTimeMs = performance.now() - suiteStartTime;

  // Calculate aggregates
  const winCount = games.filter((g) => g.won).length;
  const winRate = winCount / totalGames;
  const totalTenStars = games.reduce((acc, g) => acc + g.tenStarsAchieved, 0);
  const totalPlacements = games.reduce((acc, g) => acc + g.placementsMade, 0);
  const totalMaxStars = games.reduce((acc, g) => acc + g.maxStarReached, 0);
  const totalMerges = games.reduce((acc, g) => acc + g.totalMerges, 0);
  const totalSuperMerges = games.reduce((acc, g) => acc + g.totalSuperMerges, 0);
  const totalHammersEarned = games.reduce((acc, g) => acc + g.hammersEarned, 0);
  const totalHammersUsed = games.reduce((acc, g) => acc + g.hammersUsed, 0);
  const totalDeadSpaces = games.reduce((acc, g) => acc + g.deadSpacesAtEnd, 0);
  const totalStarsUsed = games.filter((g) => g.starUsed).length;

  const avgMaxStarReached = totalMaxStars / totalGames;
  const avgPlacements = totalPlacements / totalGames;
  const avgSuperMerges = totalSuperMerges / totalGames;
  const avgDeadSpaces = totalDeadSpaces / totalGames;
  const avgHammersEarned = totalHammersEarned / totalGames;

  const rating = calculateSolverRating({
    totalGames,
    winRate,
    avgMaxStar: avgMaxStarReached,
    avgPlacements,
    avgSuperMerges,
    avgDeadSpaces,
    avgHammersEarned,
  });

  const tierDistribution: Record<number, { count: number; percentage: number }> =
    {};
  for (let t = 4; t <= 10; t++) {
    const count = tierCounts[t] ?? 0;
    tierDistribution[t] = {
      count,
      percentage: Math.round((count / totalGames) * 100),
    };
  }

  const gamesPerSecond =
    totalSimTimeMs > 0 ? (totalGames / totalSimTimeMs) * 1000 : 0;
  const movesPerSecond =
    totalSimTimeMs > 0 ? (totalPlacements / totalSimTimeMs) * 1000 : 0;
  const avgMsPerMove =
    totalPlacements > 0 ? totalSimTimeMs / totalPlacements : 0;

  return {
    timestamp: new Date().toISOString(),
    config: {
      totalGames,
      baseSeed,
      maxPlacements,
      blueprintMode,
      strategyId,
    },
    rating,
    summary: {
      gamesCompleted: totalGames,
      winCount,
      winRatePercent: Math.round(winRate * 1000) / 10,
      totalTenStarsAchieved: totalTenStars,
      avgTenStarsPerGame: Math.round((totalTenStars / totalGames) * 100) / 100,
      avgMaxStarReached: Math.round(avgMaxStarReached * 10) / 10,
      avgPlacements: Math.round(avgPlacements * 10) / 10,
      avgMerges: Math.round((totalMerges / totalGames) * 10) / 10,
      avgSuperMerges: Math.round((totalSuperMerges / totalGames) * 10) / 10,
      avgHammersEarned: Math.round((totalHammersEarned / totalGames) * 10) / 10,
      avgHammersUsed: Math.round((totalHammersUsed / totalGames) * 10) / 10,
      avgDeadSpaces: Math.round((totalDeadSpaces / totalGames) * 10) / 10,
      starUsageRatePercent:
        Math.round((totalStarsUsed / totalGames) * 1000) / 10,
      totalSimTimeMs: Math.round(totalSimTimeMs),
      gamesPerSecond: Math.round(gamesPerSecond * 10) / 10,
      movesPerSecond: Math.round(movesPerSecond * 10) / 10,
      avgMsPerMove: Math.round(avgMsPerMove * 100) / 100,
    },
    tierDistribution,
    games,
  };
}

export interface MetricComparisonItem {
  metric: string;
  baseline: string | number;
  candidate: string | number;
  delta: string | number;
  status: 'better' | 'worse' | 'neutral';
  higherIsBetter: boolean;
}

export interface EvalComparison {
  baselineScore: number;
  candidateScore: number;
  scoreDelta: number;
  baselineElo: number;
  candidateElo: number;
  eloDelta: number;
  baselineGrade: SolverGrade;
  candidateGrade: SolverGrade;
  baselineWinRate: number;
  candidateWinRate: number;
  winRateDelta: number;
  avgMaxStarDelta: number;
  avgPlacementsDelta: number;
  avgSuperMergesDelta: number;
  avgDeadSpacesDelta: number;
  verdict: 'IMPROVEMENT' | 'REGRESSION' | 'NEUTRAL';
  verdictHeadline: string;
  details: MetricComparisonItem[];
}

/**
 * Compares a candidate evaluation report against a baseline evaluation report
 * and determines if changes made to the solver strategy are for better or worse.
 */
export function compareEvaluations(
  candidate: EvalSuiteReport,
  baseline: EvalSuiteReport
): EvalComparison {
  const cScore = candidate.rating.overallScore;
  const bScore = baseline.rating.overallScore;
  const scoreDelta = cScore - bScore;

  const cElo = candidate.rating.elo;
  const bElo = baseline.rating.elo;
  const eloDelta = cElo - bElo;

  const cWin = candidate.summary.winRatePercent;
  const bWin = baseline.summary.winRatePercent;
  const winRateDelta = Math.round((cWin - bWin) * 10) / 10;

  const cMaxStar = candidate.summary.avgMaxStarReached;
  const bMaxStar = baseline.summary.avgMaxStarReached;
  const avgMaxStarDelta = Math.round((cMaxStar - bMaxStar) * 10) / 10;

  const cPlacements = candidate.summary.avgPlacements;
  const bPlacements = baseline.summary.avgPlacements;
  const avgPlacementsDelta = Math.round((cPlacements - bPlacements) * 10) / 10;

  const cSuper = candidate.summary.avgSuperMerges;
  const bSuper = baseline.summary.avgSuperMerges;
  const avgSuperMergesDelta = Math.round((cSuper - bSuper) * 10) / 10;

  const cDead = candidate.summary.avgDeadSpaces;
  const bDead = baseline.summary.avgDeadSpaces;
  const avgDeadSpacesDelta = Math.round((cDead - bDead) * 10) / 10;

  // Decide Verdict
  let verdict: 'IMPROVEMENT' | 'REGRESSION' | 'NEUTRAL' = 'NEUTRAL';
  let verdictHeadline = '';

  if (scoreDelta >= 2.0 || (scoreDelta >= 0.5 && winRateDelta > 0)) {
    verdict = 'IMPROVEMENT';
    verdictHeadline = `✅ IMPROVEMENT (Better!): Rating +${scoreDelta > 0 ? scoreDelta : 0} pts (${bScore} → ${cScore}), Win Rate ${bWin}% → ${cWin}%`;
  } else if (scoreDelta <= -2.0 || (scoreDelta <= -0.5 && winRateDelta < 0)) {
    verdict = 'REGRESSION';
    verdictHeadline = `❌ REGRESSION (Worse!): Rating ${scoreDelta} pts (${bScore} → ${cScore}), Win Rate ${bWin}% → ${cWin}%`;
  } else {
    verdict = 'NEUTRAL';
    verdictHeadline = `➖ NEUTRAL: Strategy performance is statistically comparable (${bScore} vs ${cScore} pts)`;
  }

  const formatDelta = (delta: number, suffix = '', reverse = false): { deltaStr: string; status: 'better' | 'worse' | 'neutral' } => {
    if (Math.abs(delta) < 0.01) {
      return { deltaStr: `0.0${suffix}`, status: 'neutral' };
    }
    const sign = delta > 0 ? '+' : '';
    const deltaStr = `${sign}${delta}${suffix}`;
    const isGood = reverse ? delta < 0 : delta > 0;
    return { deltaStr, status: isGood ? 'better' : 'worse' };
  };

  const details: MetricComparisonItem[] = [
    {
      metric: 'Overall Rating',
      baseline: `${bScore} (${baseline.rating.grade})`,
      candidate: `${cScore} (${candidate.rating.grade})`,
      delta: formatDelta(scoreDelta).deltaStr,
      status: formatDelta(scoreDelta).status,
      higherIsBetter: true,
    },
    {
      metric: 'Relic ELO',
      baseline: bElo,
      candidate: cElo,
      delta: formatDelta(eloDelta).deltaStr,
      status: formatDelta(eloDelta).status,
      higherIsBetter: true,
    },
    {
      metric: '10★ Win Rate',
      baseline: `${bWin}%`,
      candidate: `${cWin}%`,
      delta: formatDelta(winRateDelta, '%').deltaStr,
      status: formatDelta(winRateDelta).status,
      higherIsBetter: true,
    },
    {
      metric: 'Avg Peak Star',
      baseline: `${bMaxStar}★`,
      candidate: `${cMaxStar}★`,
      delta: formatDelta(avgMaxStarDelta, '★').deltaStr,
      status: formatDelta(avgMaxStarDelta).status,
      higherIsBetter: true,
    },
    {
      metric: 'Avg Moves Survived',
      baseline: bPlacements,
      candidate: cPlacements,
      delta: formatDelta(avgPlacementsDelta).deltaStr,
      status: formatDelta(avgPlacementsDelta).status,
      higherIsBetter: true,
    },
    {
      metric: '5+ Super-Merges/Game',
      baseline: bSuper,
      candidate: cSuper,
      delta: formatDelta(avgSuperMergesDelta).deltaStr,
      status: formatDelta(avgSuperMergesDelta).status,
      higherIsBetter: true,
    },
    {
      metric: 'Avg Dead Spaces at End',
      baseline: bDead,
      candidate: cDead,
      delta: formatDelta(avgDeadSpacesDelta, '', true).deltaStr,
      status: formatDelta(avgDeadSpacesDelta, '', true).status,
      higherIsBetter: false,
    },
  ];

  return {
    baselineScore: bScore,
    candidateScore: cScore,
    scoreDelta,
    baselineElo: bElo,
    candidateElo: cElo,
    eloDelta,
    baselineGrade: baseline.rating.grade,
    candidateGrade: candidate.rating.grade,
    baselineWinRate: bWin,
    candidateWinRate: cWin,
    winRateDelta,
    avgMaxStarDelta,
    avgPlacementsDelta,
    avgSuperMergesDelta,
    avgDeadSpacesDelta,
    verdict,
    verdictHeadline,
    details,
  };
}

