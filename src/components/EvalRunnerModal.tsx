import React, { useState, useRef, useEffect } from 'react';
import {
  Activity,
  AlertTriangle,
  Award,
  BarChart3,
  CheckCircle2,
  ChevronRight,
  Crown,
  Download,
  Flame,
  Hammer,
  Play,
  RotateCcw,
  Shield,
  Sparkles,
  Star,
  TrendingDown,
  TrendingUp,
  X,
  Zap,
} from 'lucide-react';
import {
  compareEvaluations,
  EvalComparison,
  EvalProgress,
  EvalSuiteReport,
  runEvaluationSuite,
} from '../domain/evaluator';

interface EvalRunnerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const LOCAL_STORAGE_KEY = 'ef2_forge_eval_baseline';

export const EvalRunnerModal: React.FC<EvalRunnerModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [gameCount, setGameCount] = useState<number>(15);
  const [baseSeed, setBaseSeed] = useState<number>(1000);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [progress, setProgress] = useState<EvalProgress | null>(null);
  const [currentReport, setCurrentReport] = useState<EvalSuiteReport | null>(null);
  const [baselineReport, setBaselineReport] = useState<EvalSuiteReport | null>(null);
  const [comparison, setComparison] = useState<EvalComparison | null>(null);
  const [showGamesLog, setShowGamesLog] = useState<boolean>(false);

  // Load baseline from localStorage if available
  useEffect(() => {
    try {
      const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (stored) {
        setBaselineReport(JSON.parse(stored));
      }
    } catch {
      // Ignore
    }
  }, []);

  // Update comparison whenever currentReport or baselineReport changes
  useEffect(() => {
    if (currentReport && baselineReport) {
      setComparison(compareEvaluations(currentReport, baselineReport));
    } else {
      setComparison(null);
    }
  }, [currentReport, baselineReport]);

  const handleStartEval = async () => {
    setIsRunning(true);
    setProgress(null);
    setShowGamesLog(false);

    // Run asynchronously to allow React state updates for the progress bar
    await new Promise((resolve) => setTimeout(resolve, 50));

    try {
      const report = runEvaluationSuite({
        totalGames: gameCount,
        baseSeed,
        onProgress: (p) => {
          setProgress(p);
        },
      });

      setCurrentReport(report);
    } catch (err) {
      console.error('Eval error:', err);
    } finally {
      setIsRunning(false);
    }
  };

  const handleSaveAsBaseline = () => {
    if (!currentReport) return;
    setBaselineReport(currentReport);
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(currentReport));
    } catch (err) {
      console.error('Failed to save baseline:', err);
    }
  };

  const handleClearBaseline = () => {
    setBaselineReport(null);
    setComparison(null);
    localStorage.removeItem(LOCAL_STORAGE_KEY);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-[#10141f] border border-[#2b3248] rounded-2xl w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl text-slate-100 overflow-hidden">
        {/* Modal Header */}
        <div className="p-4 bg-[#141826] border-b border-[#242b3d] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center border border-amber-500/30">
              <Activity className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                Solver Strategy Evaluation & Rating Lab
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  Automated Monte Carlo
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Simulate full games to evaluate solver strategy quality, 10★ win rate, and catch regressions.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto flex-1 flex flex-col gap-5">
          {/* Controls Bar */}
          <div className="bg-[#171c2c] border border-[#283149] rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1.5 bg-[#0f121d] px-2.5 py-1.5 rounded-lg border border-[#283149]">
                <span className="text-xs font-semibold text-slate-400">Preset:</span>
                <button
                  type="button"
                  disabled={isRunning}
                  onClick={() => setGameCount(10)}
                  className={`px-2 py-0.5 rounded text-xs font-bold transition-colors ${
                    gameCount === 10
                      ? 'bg-amber-500 text-slate-950'
                      : 'text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  Quick (10)
                </button>
                <button
                  type="button"
                  disabled={isRunning}
                  onClick={() => setGameCount(25)}
                  className={`px-2 py-0.5 rounded text-xs font-bold transition-colors ${
                    gameCount === 25
                      ? 'bg-amber-500 text-slate-950'
                      : 'text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  Standard (25)
                </button>
                <button
                  type="button"
                  disabled={isRunning}
                  onClick={() => setGameCount(50)}
                  className={`px-2 py-0.5 rounded text-xs font-bold transition-colors ${
                    gameCount === 50
                      ? 'bg-amber-500 text-slate-950'
                      : 'text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  Deep (50)
                </button>
              </div>

              <div className="flex items-center gap-1.5 bg-[#0f121d] px-2.5 py-1.5 rounded-lg border border-[#283149]">
                <span className="text-xs font-semibold text-slate-400">Base Seed:</span>
                <input
                  type="number"
                  disabled={isRunning}
                  value={baseSeed}
                  onChange={(e) => setBaseSeed(parseInt(e.target.value, 10) || 1000)}
                  className="w-16 bg-[#1a2032] border border-slate-700 rounded px-1.5 py-0.5 text-xs text-white text-center font-mono focus:outline-none focus:border-amber-400"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={isRunning}
                onClick={handleStartEval}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-xs shadow-md transition-all disabled:opacity-50"
              >
                {isRunning ? (
                  <>
                    <RotateCcw className="w-3.5 h-3.5 animate-spin" />
                    Simulating...
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 fill-current" />
                    Run Evaluation
                  </>
                )}
              </button>

              {currentReport && (
                <button
                  type="button"
                  disabled={isRunning}
                  onClick={handleSaveAsBaseline}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition-colors"
                  title="Save current run as the baseline to compare against future changes"
                >
                  <Download className="w-3.5 h-3.5 text-slate-400" />
                  Save as Baseline
                </button>
              )}

              {baselineReport && (
                <button
                  type="button"
                  disabled={isRunning}
                  onClick={handleClearBaseline}
                  className="px-2 py-2 text-xs text-slate-500 hover:text-rose-400 transition-colors"
                  title="Clear saved baseline"
                >
                  Clear Baseline
                </button>
              )}
            </div>
          </div>

          {/* Running Progress Bar */}
          {isRunning && progress && (
            <div className="bg-[#141826] border border-amber-500/30 rounded-xl p-4 flex flex-col gap-2 shadow-inner animate-pulse">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-amber-400 flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 animate-spin" />
                  Simulating Games ({progress.completedGames} / {progress.totalGames})...
                </span>
                <span className="text-slate-400 font-mono">
                  Last: {progress.lastGameResult.maxStarReached}★ (
                  {progress.lastGameResult.won ? '👑 WIN' : `${progress.lastGameResult.placementsMade} moves`})
                </span>
              </div>
              <div className="w-full bg-slate-900 rounded-full h-2.5 overflow-hidden border border-slate-800">
                <div
                  className="bg-gradient-to-r from-amber-500 to-amber-300 h-full rounded-full transition-all duration-150"
                  style={{
                    width: `${Math.round((progress.completedGames / progress.totalGames) * 100)}%`,
                  }}
                />
              </div>
            </div>
          )}

          {/* Comparison Verdict Banner (if comparing with baseline) */}
          {comparison && (
            <div
              className={`rounded-xl p-3.5 border flex items-center justify-between gap-3 ${
                comparison.verdict === 'IMPROVEMENT'
                  ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
                  : comparison.verdict === 'REGRESSION'
                  ? 'bg-rose-950/40 border-rose-500/40 text-rose-300'
                  : 'bg-slate-900 border-slate-700 text-slate-300'
              }`}
            >
              <div className="flex items-center gap-2.5">
                {comparison.verdict === 'IMPROVEMENT' ? (
                  <TrendingUp className="w-5 h-5 text-emerald-400" />
                ) : comparison.verdict === 'REGRESSION' ? (
                  <TrendingDown className="w-5 h-5 text-rose-400" />
                ) : (
                  <Activity className="w-5 h-5 text-slate-400" />
                )}
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider">
                    {comparison.verdictHeadline}
                  </h4>
                  <p className="text-[11px] opacity-80">
                    Baseline: Score {comparison.baselineScore} ({comparison.baselineGrade}) | ELO {comparison.baselineElo} | Win Rate {comparison.baselineWinRate}%
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Current Evaluation Report */}
          {currentReport ? (
            <div className="flex flex-col gap-4">
              {/* Rating Card */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {/* Score & Grade */}
                <div className="bg-gradient-to-br from-[#1b2135] to-[#121624] border border-[#2b3552] rounded-xl p-4 flex flex-col justify-between shadow-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                      Strategy Rating
                    </span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-amber-500/20 text-amber-300 border border-amber-500/30">
                      ELO: {currentReport.rating.elo}
                    </span>
                  </div>

                  <div className="my-2 flex items-baseline gap-2">
                    <span className="text-4xl font-black text-amber-400">
                      {currentReport.rating.overallScore}
                    </span>
                    <span className="text-slate-400 text-sm font-bold">/ 100</span>
                    <span
                      className={`ml-auto px-3 py-1 rounded-lg text-lg font-black border ${
                        currentReport.rating.overallScore >= 90
                          ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                          : currentReport.rating.overallScore >= 80
                          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                          : 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40'
                      }`}
                    >
                      {currentReport.rating.grade}
                    </span>
                  </div>

                  <div>
                    <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                      {currentReport.rating.title}
                    </h4>
                    <p className="text-[11px] text-slate-400 line-clamp-2">
                      {currentReport.rating.verdictSummary}
                    </p>
                  </div>
                </div>

                {/* Subscores Breakdown */}
                <div className="md:col-span-2 bg-[#141826] border border-[#242b3d] rounded-xl p-4 flex flex-col justify-between">
                  <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                    Rating Subscores (0–100)
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    <div>
                      <div className="flex justify-between mb-1">
                        <span className="text-slate-300 flex items-center gap-1">
                          👑 10★ Win Rate (40%)
                        </span>
                        <span className="font-bold text-amber-400">
                          {currentReport.rating.subscores.mythicSuccess}
                        </span>
                      </div>
                      <div className="w-full bg-slate-800 rounded-full h-1.5">
                        <div
                          className="bg-amber-400 h-full rounded-full"
                          style={{
                            width: `${currentReport.rating.subscores.mythicSuccess}%`,
                          }}
                        />
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between mb-1">
                        <span className="text-slate-300 flex items-center gap-1">
                          📈 Peak Progression (25%)
                        </span>
                        <span className="font-bold text-indigo-400">
                          {currentReport.rating.subscores.tierProgression}
                        </span>
                      </div>
                      <div className="w-full bg-slate-800 rounded-full h-1.5">
                        <div
                          className="bg-indigo-400 h-full rounded-full"
                          style={{
                            width: `${currentReport.rating.subscores.tierProgression}%`,
                          }}
                        />
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between mb-1">
                        <span className="text-slate-300 flex items-center gap-1">
                          🛡️ Board Survival (15%)
                        </span>
                        <span className="font-bold text-cyan-400">
                          {currentReport.rating.subscores.boardSurvival}
                        </span>
                      </div>
                      <div className="w-full bg-slate-800 rounded-full h-1.5">
                        <div
                          className="bg-cyan-400 h-full rounded-full"
                          style={{
                            width: `${currentReport.rating.subscores.boardSurvival}%`,
                          }}
                        />
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between mb-1">
                        <span className="text-slate-300 flex items-center gap-1">
                          🔨 Super-Merge Economy (10%)
                        </span>
                        <span className="font-bold text-purple-400">
                          {currentReport.rating.subscores.superMergeEconomy}
                        </span>
                      </div>
                      <div className="w-full bg-slate-800 rounded-full h-1.5">
                        <div
                          className="bg-purple-400 h-full rounded-full"
                          style={{
                            width: `${currentReport.rating.subscores.superMergeEconomy}%`,
                          }}
                        />
                      </div>
                    </div>

                    <div className="sm:col-span-2">
                      <div className="flex justify-between mb-1">
                        <span className="text-slate-300 flex items-center gap-1">
                          ✨ Cleanliness / Straggler Discipline (10%)
                        </span>
                        <span className="font-bold text-emerald-400">
                          {currentReport.rating.subscores.boardCleanliness}
                        </span>
                      </div>
                      <div className="w-full bg-slate-800 rounded-full h-1.5">
                        <div
                          className="bg-emerald-400 h-full rounded-full"
                          style={{
                            width: `${currentReport.rating.subscores.boardCleanliness}%`,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Key Aggregate Metrics Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div className="bg-[#141826] border border-[#242b3d] rounded-xl p-3 flex flex-col">
                  <span className="text-[10px] font-bold text-slate-400 uppercase">
                    10★ Win Rate
                  </span>
                  <span className="text-xl font-black text-amber-400 mt-1">
                    {currentReport.summary.winRatePercent}%
                  </span>
                  <span className="text-[10px] text-slate-400">
                    {currentReport.summary.winCount} / {currentReport.summary.gamesCompleted} games
                  </span>
                </div>

                <div className="bg-[#141826] border border-[#242b3d] rounded-xl p-3 flex flex-col">
                  <span className="text-[10px] font-bold text-slate-400 uppercase">
                    Avg Peak Tier
                  </span>
                  <span className="text-xl font-black text-white mt-1">
                    {currentReport.summary.avgMaxStarReached}★
                  </span>
                  <span className="text-[10px] text-slate-400">
                    {currentReport.summary.totalTenStarsAchieved} total 10★ relics
                  </span>
                </div>

                <div className="bg-[#141826] border border-[#242b3d] rounded-xl p-3 flex flex-col">
                  <span className="text-[10px] font-bold text-slate-400 uppercase">
                    Avg Placements
                  </span>
                  <span className="text-xl font-black text-cyan-400 mt-1">
                    {currentReport.summary.avgPlacements}
                  </span>
                  <span className="text-[10px] text-slate-400">
                    moves survived/game
                  </span>
                </div>

                <div className="bg-[#141826] border border-[#242b3d] rounded-xl p-3 flex flex-col">
                  <span className="text-[10px] font-bold text-slate-400 uppercase">
                    Super-Merges
                  </span>
                  <span className="text-xl font-black text-purple-400 mt-1">
                    {currentReport.summary.avgSuperMerges}
                  </span>
                  <span className="text-[10px] text-slate-400">
                    5+ merges/game (+1 hammer)
                  </span>
                </div>
              </div>

              {/* Peak Tier Distribution */}
              <div className="bg-[#141826] border border-[#242b3d] rounded-xl p-4">
                <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2.5">
                  Peak Tier Reached Distribution
                </h4>
                <div className="flex flex-col gap-1.5">
                  {[10, 9, 8, 7, 6, 5, 4].map((star) => {
                    const tier = currentReport.tierDistribution[star] ?? {
                      count: 0,
                      percentage: 0,
                    };
                    return (
                      <div key={star} className="flex items-center gap-2 text-xs">
                        <span className="w-14 font-mono font-bold text-slate-300">
                          {star === 10 ? '👑 10★' : `${star}★`}
                        </span>
                        <div className="flex-1 bg-slate-900 rounded-full h-2 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              star === 10
                                ? 'bg-amber-400'
                                : star >= 8
                                ? 'bg-indigo-400'
                                : 'bg-slate-500'
                            }`}
                            style={{ width: `${tier.percentage}%` }}
                          />
                        </div>
                        <span className="w-16 text-right font-mono text-[11px] text-slate-400">
                          {tier.percentage}% ({tier.count})
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Game Log Toggle */}
              <div className="bg-[#141826] border border-[#242b3d] rounded-xl p-3">
                <button
                  type="button"
                  onClick={() => setShowGamesLog(!showGamesLog)}
                  className="w-full flex items-center justify-between text-xs font-bold text-slate-300 hover:text-white"
                >
                  <span>Individual Game Log ({currentReport.games.length} games)</span>
                  <ChevronRight
                    className={`w-4 h-4 transition-transform ${
                      showGamesLog ? 'rotate-90' : ''
                    }`}
                  />
                </button>

                {showGamesLog && (
                  <div className="mt-3 overflow-x-auto max-h-48 overflow-y-auto">
                    <table className="w-full text-left text-[11px] font-mono">
                      <thead className="bg-[#1b2135] text-slate-400 sticky top-0">
                        <tr>
                          <th className="p-1.5">#</th>
                          <th className="p-1.5">Seed</th>
                          <th className="p-1.5">Peak Tier</th>
                          <th className="p-1.5">Moves</th>
                          <th className="p-1.5">10★ Achieved</th>
                          <th className="p-1.5">Merges</th>
                          <th className="p-1.5">Hammers</th>
                          <th className="p-1.5">Result</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800 text-slate-300">
                        {currentReport.games.map((g) => (
                          <tr key={g.gameIndex} className="hover:bg-slate-800/40">
                            <td className="p-1.5">{g.gameIndex + 1}</td>
                            <td className="p-1.5 text-slate-400">{g.seed}</td>
                            <td className="p-1.5 font-bold text-amber-400">
                              {g.maxStarReached}★
                            </td>
                            <td className="p-1.5">{g.placementsMade}</td>
                            <td className="p-1.5 text-amber-300">
                              {g.tenStarsAchieved > 0 ? `👑 ${g.tenStarsAchieved}` : '-'}
                            </td>
                            <td className="p-1.5">
                              {g.totalMerges} ({g.totalSuperMerges} super)
                            </td>
                            <td className="p-1.5">
                              +{g.hammersEarned} / -{g.hammersUsed}
                            </td>
                            <td className="p-1.5">
                              {g.won ? (
                                <span className="text-emerald-400 font-bold">WON</span>
                              ) : (
                                <span className="text-slate-500">LOCKED</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-[#141826] border border-dashed border-slate-700 rounded-xl p-8 text-center flex flex-col items-center justify-center gap-2">
              <Award className="w-8 h-8 text-slate-500 mb-1" />
              <h3 className="text-sm font-bold text-white">No Evaluation Run Yet</h3>
              <p className="text-xs text-slate-400 max-w-sm">
                Click <span className="text-amber-400 font-bold">Run Evaluation</span> above to simulate 10–50 games and benchmark the solver’s current rating.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 bg-[#141826] border-t border-[#242b3d] flex items-center justify-between text-xs text-slate-400">
          <span>
            Run from CLI: <code className="text-amber-400 bg-slate-900 px-1.5 py-0.5 rounded font-mono">npm run eval</code> or <code className="text-amber-400 bg-slate-900 px-1.5 py-0.5 rounded font-mono">npm run eval:compare</code>
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

