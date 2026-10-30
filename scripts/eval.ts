import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_STRATEGY_ID,
  SOLVER_STRATEGIES,
} from '../src/domain/constants';
import {
  compareEvaluations,
  EvalSuiteReport,
  runEvaluationSuite,
} from '../src/domain/evaluator';
import { SolverStrategyId } from '../src/types/forge';

const BASELINE_FILE = path.resolve(process.cwd(), '.eval-baseline.json');

function printHelp(): void {
  console.log(`
⬡ EF2 Relic Forge Strategy Evaluation Runner ⬡

Usage:
  npx vite-node scripts/eval.ts [options]
  npm run eval [-- options]

Options:
  -s, --strategy <id>    Strategy to test ('mythic-climax' | 'max-survival' | 'max-space')
                         Default: 'mythic-climax'
  -n, --games <number>   Number of games to simulate (default: 30)
  --quick                Quick run (15 games, ~2-3 seconds)
  --deep                 Deep evaluation (100 games, high precision)
  --seed <number>        Starting seed for reproducible runs (default: 1000)
  --max-moves <number>   Maximum placements per game (default: 1000)
  --save-baseline        Save this evaluation as the official baseline (.eval-baseline.json)
  --compare              Compare current evaluation against the saved baseline
  --json                 Output results in pure JSON format (for CI/scripts)
  -h, --help             Show this help screen

Available Strategies:
  • mythic-climax: 👑 10★ Climax / Mythic Forge (Default)
  • max-survival:  🛡️ Max Moves & Survivalist
  • max-space:     🧹 Max Empty Space & Board Cleaner
`);
}

function parseArgs(): {
  strategy: SolverStrategyId;
  games: number;
  seed: number;
  maxMoves: number;
  saveBaseline: boolean;
  compare: boolean;
  jsonOutput: boolean;
  help: boolean;
} {
  const args = process.argv.slice(2);
  let strategy: SolverStrategyId = DEFAULT_STRATEGY_ID;
  let games = 30;
  let seed = 1000;
  let maxMoves = 1000;
  let saveBaseline = false;
  let compare = false;
  let jsonOutput = false;
  let help = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-h' || arg === '--help') {
      help = true;
    } else if (arg === '--quick') {
      games = 15;
    } else if (arg === '--deep') {
      games = 100;
    } else if ((arg === '-s' || arg === '--strategy') && args[i + 1]) {
      const val = args[++i] as SolverStrategyId;
      if (val in SOLVER_STRATEGIES) {
        strategy = val;
      } else {
        console.warn(`Unknown strategy '${val}', defaulting to '${DEFAULT_STRATEGY_ID}'`);
      }
    } else if ((arg === '-n' || arg === '--games') && args[i + 1]) {
      games = parseInt(args[++i], 10) || 30;
    } else if (arg === '--seed' && args[i + 1]) {
      seed = parseInt(args[++i], 10) || 1000;
    } else if (arg === '--max-moves' && args[i + 1]) {
      maxMoves = parseInt(args[++i], 10) || 1000;
    } else if (arg === '--save-baseline') {
      saveBaseline = true;
    } else if (arg === '--compare') {
      compare = true;
    } else if (arg === '--json') {
      jsonOutput = true;
    }
  }

  return { strategy, games, seed, maxMoves, saveBaseline, compare, jsonOutput, help };
}

function renderProgressBar(current: number, total: number, width: number = 30): string {
  const ratio = Math.min(1, Math.max(0, current / total));
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  const percent = Math.round(ratio * 100);
  return `[${bar}] ${percent}% (${current}/${total})`;
}

function renderBarChart(percentage: number, maxWidth: number = 24): string {
  const width = Math.round((percentage / 100) * maxWidth);
  return '█'.repeat(Math.max(0, width));
}

async function main() {
  const options = parseArgs();

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  if (!options.jsonOutput) {
    const stratSpec = SOLVER_STRATEGIES[options.strategy];
    console.log('\n================================================================');
    console.log('       ⬡ EF2 RELIC FORGE STRATEGY EVALUATION RUNNER ⬡');
    console.log('================================================================');
    console.log(`Active Strategy: ${stratSpec.icon} ${stratSpec.name} (${stratSpec.badge})`);
    console.log(`                 "${stratSpec.description}"`);
    console.log(
      `Simulating ${options.games} games | Base Seed: ${options.seed} | Max Moves: ${options.maxMoves}`
    );
    if (options.compare) {
      console.log('Mode: Comparison against .eval-baseline.json');
    }
    console.log('----------------------------------------------------------------\n');
  }

  let lastProgressLen = 0;

  const report = runEvaluationSuite({
    strategyId: options.strategy,
    totalGames: options.games,
    baseSeed: options.seed,
    maxPlacements: options.maxMoves,
    onProgress: (p) => {
      if (!options.jsonOutput && process.stdout.isTTY) {
        const line = `Simulating: ${renderProgressBar(
          p.completedGames,
          p.totalGames
        )} | Last: ${p.lastGameResult.maxStarReached}★ (${
          p.lastGameResult.won ? '👑 WIN' : `${p.lastGameResult.placementsMade} moves`
        })`;
        process.stdout.write('\r' + line.padEnd(lastProgressLen));
        lastProgressLen = line.length;
      }
    },
  });

  if (!options.jsonOutput && process.stdout.isTTY) {
    process.stdout.write('\r' + ' '.repeat(lastProgressLen) + '\r');
  }

  if (options.jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(0);
  }

  const { rating, summary, tierDistribution } = report;

  // Grade color badges
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log(
    `║   SOLVER RATING: ${String(rating.overallScore).padStart(3)} / 100  [GRADE: ${rating.grade.padEnd(2)} - ${rating.title.toUpperCase().padEnd(20)}]   ║`
  );
  console.log(
    `║   RELIC ELO:     ${String(rating.elo).padStart(4)}        [BENCHMARK: ${
      rating.overallScore >= 85 ? 'ELITE STRATEGY' : rating.overallScore >= 70 ? 'STRONG COMPETITIVE' : 'REQUIRES TUNING'
    }]       ║`
  );
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  console.log('📊 RATING FACTOR SUBSCORES:');
  console.log(
    `  • 👑 10★ Mythic Success:    ${String(rating.subscores.mythicSuccess).padStart(3)} / 100  (40% weight)`
  );
  console.log(
    `  • 📈 Tier Progression:       ${String(rating.subscores.tierProgression).padStart(3)} / 100  (25% weight)`
  );
  console.log(
    `  • 🛡️  Board Survivability:    ${String(rating.subscores.boardSurvival).padStart(3)} / 100  (15% weight)`
  );
  console.log(
    `  • 🔨 Super-Merge Economy:    ${String(rating.subscores.superMergeEconomy).padStart(3)} / 100  (10% weight)`
  );
  console.log(
    `  • ✨ Board Cleanliness:      ${String(rating.subscores.boardCleanliness).padStart(3)} / 100  (10% weight)\n`
  );

  console.log('📈 KEY AGGREGATE METRICS:');
  console.log(`  • Games Simulated:          ${summary.gamesCompleted}`);
  console.log(
    `  • 10★ Mythic Win Rate:      ${summary.winRatePercent}% (${summary.winCount}/${summary.gamesCompleted} runs)`
  );
  console.log(`  • Total 10★ Relics Forged:  ${summary.totalTenStarsAchieved}`);
  console.log(`  • Avg Peak Tier Reached:    ${summary.avgMaxStarReached}★`);
  console.log(`  • Avg Placements Survived:  ${summary.avgPlacements} moves`);
  console.log(`  • Avg Merges per Game:      ${summary.avgMerges}`);
  console.log(
    `  • Avg 5+ Super-Merges:      ${summary.avgSuperMerges} (Jump +2★ & Hammer Refill)`
  );
  console.log(`  • Avg Hammers Earned/Used:  ${summary.avgHammersEarned} / ${summary.avgHammersUsed}`);
  console.log(`  • Avg Dead Spaces at End:   ${summary.avgDeadSpaces}`);
  console.log(`  • 1x Star Usage Rate:       ${summary.starUsageRatePercent}%\n`);

  console.log('🏔️  PEAK TIER DISTRIBUTION:');
  for (let star = 10; star >= 4; star--) {
    const data = tierDistribution[star] ?? { count: 0, percentage: 0 };
    const bar = renderBarChart(data.percentage);
    const starLabel = star === 10 ? '10★ (Mythic)' : `${star}★         `;
    console.log(
      `  ${starLabel} | ${bar.padEnd(24)} | ${String(data.percentage).padStart(3)}% (${data.count} games)`
    );
  }
  console.log('');

  console.log('⚡ PERFORMANCE & SPEED BENCHMARK:');
  console.log(`  • Total Eval Time:          ${summary.totalSimTimeMs} ms`);
  console.log(`  • Game Throughput:          ${summary.gamesPerSecond} games/sec`);
  console.log(`  • Move Throughput:          ${summary.movesPerSecond} moves/sec`);
  console.log(`  • Average Time per Move:    ${summary.avgMsPerMove} ms/move\n`);

  if (rating.strengths.length > 0) {
    console.log('🌟 KEY STRENGTHS:');
    for (const s of rating.strengths) {
      console.log(`  [+] ${s}`);
    }
    console.log('');
  }

  if (rating.areasForImprovement.length > 0) {
    console.log('⚠️  AREAS FOR TUNING:');
    for (const a of rating.areasForImprovement) {
      console.log(`  [-] ${a}`);
    }
    console.log('');
  }

  // Handle Comparison Mode
  if (options.compare) {
    if (!fs.existsSync(BASELINE_FILE)) {
      console.log(
        '⚠️  No baseline file found at .eval-baseline.json! Run with --save-baseline first to save a baseline.'
      );
    } else {
      try {
        const baselineData: EvalSuiteReport = JSON.parse(
          fs.readFileSync(BASELINE_FILE, 'utf-8')
        );
        const comparison = compareEvaluations(report, baselineData);

        console.log('════════════════════════════════════════════════════════════════');
        console.log('           🔍 CANDIDATE vs BASELINE COMPARISON REPORT           ');
        console.log('════════════════════════════════════════════════════════════════');
        console.log(`\nVERDICT: ${comparison.verdictHeadline}\n`);

        console.log(
          'Metric                      Baseline      Candidate      Delta       Status'
        );
        console.log(
          '---------------------------------------------------------------------------'
        );
        for (const item of comparison.details) {
          const metricStr = item.metric.padEnd(26);
          const baseStr = String(item.baseline).padEnd(13);
          const candStr = String(item.candidate).padEnd(14);
          const deltaStr = String(item.delta).padEnd(11);
          const statusStr =
            item.status === 'better'
              ? '✅ BETTER'
              : item.status === 'worse'
              ? '❌ WORSE'
              : '➖ NEUTRAL';
          console.log(`${metricStr} ${baseStr} ${candStr} ${deltaStr} ${statusStr}`);
        }
        console.log(
          '---------------------------------------------------------------------------\n'
        );
      } catch (err) {
        console.error('Error reading baseline file:', err);
      }
    }
  }

  // Handle Save Baseline Mode
  if (options.saveBaseline) {
    fs.writeFileSync(BASELINE_FILE, JSON.stringify(report, null, 2), 'utf-8');
    console.log(`💾 Saved evaluation as baseline to: ${BASELINE_FILE}\n`);
  }
}

main().catch((err) => {
  console.error('Evaluation run failed:', err);
  process.exit(1);
});

