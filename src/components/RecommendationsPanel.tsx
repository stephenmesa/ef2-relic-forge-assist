import React, { useState } from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  ArrowLeftRight,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Cpu,
  Eye,
  FastForward,
  Flame,
  Play,
  ShieldCheck,
  Skull,
  Sparkles,
} from 'lucide-react';
import { formatCellCoordVerbose, indexToCoord } from '../domain/honeycomb';
import { formatPlacedTilesSummary } from '../domain/solver';
import { CandidateMove, PieceConfig } from '../types/forge';
import { MiniPiecePreview } from './PieceComposer';

interface RecommendationsPanelProps {
  currentPiece: PieceConfig;
  nextPiece: PieceConfig;
  nextPieceKnown: boolean;
  topRecommendations: CandidateMove[];
  allCandidates: CandidateMove[];
  lethalMoves: CandidateMove[];
  elapsedMs: number;
  selectedMoveId: string | null;
  hoveredMoveId: string | null;
  onSelectMove: (moveId: string | null) => void;
  onHoverMove: (moveId: string | null) => void;
  onApplyPly1Move: (move: CandidateMove) => void;
  onApplyBothMoves: (move: CandidateMove) => void;
  onSwapAmbiguousLanding: (moveId: string, newLandingCell: number) => void;
}

export const RecommendationsPanel: React.FC<RecommendationsPanelProps> = ({
  currentPiece,
  nextPieceKnown,
  topRecommendations,
  allCandidates,
  lethalMoves,
  elapsedMs,
  selectedMoveId,
  hoveredMoveId,
  onSelectMove,
  onHoverMove,
  onApplyPly1Move,
  onApplyBothMoves,
  onSwapAmbiguousLanding,
}) => {
  const [expandedBreakdownId, setExpandedBreakdownId] = useState<string | null>(
    null
  );
  const [showAllLegalMoves, setShowAllLegalMoves] = useState(false);

  const getRankLabel = (idx: number) => {
    if (idx === 0) return { title: '#1 BEST MOVE', badgeBg: 'bg-amber-400 text-slate-950' };
    if (idx === 1) return { title: '#2 ALTERNATIVE', badgeBg: 'bg-slate-300 text-slate-950' };
    return { title: '#3 SAFE / SETUP', badgeBg: 'bg-amber-700/80 text-amber-100' };
  };

  const getToneStyle = (tone: CandidateMove['strategicTag']['tone']) => {
    switch (tone) {
      case 'chain':
        return 'bg-gradient-to-r from-orange-500/25 to-amber-500/20 text-amber-200 border-amber-400/50';
      case 'rescue':
        return 'bg-emerald-500/20 text-emerald-200 border-emerald-400/50';
      case 'warning':
        return 'bg-rose-500/20 text-rose-200 border-rose-400/60';
      case 'lethal':
        return 'bg-rose-950/80 text-rose-200 border-rose-500';
      case 'merge':
        return 'bg-indigo-500/20 text-indigo-200 border-indigo-400/50';
      case 'setup':
      default:
        return 'bg-cyan-500/15 text-cyan-200 border-cyan-400/40';
    }
  };

  return (
    <div className="bg-[#131621] border border-[#293044] rounded-2xl p-3.5 sm:p-4 shadow-xl flex flex-col gap-3.5">
      {/* Advisor Panel Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-[#252C40]">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-400" />
            <h2 className="text-base font-extrabold tracking-tight text-white">
              Ranked Advisor Recommendations
            </h2>
          </div>
          <p className="text-xs text-slate-400">
            {nextPieceKnown
              ? `Evaluated ${allCandidates.length} valid placements × 2-Ply Next Piece lookahead`
              : `Evaluated ${allCandidates.length} valid placements (1-Ply + Spawn Expectation)`}
          </p>
        </div>

        <div className="flex items-center gap-1.5 text-[11px] font-mono bg-[#0C0E16] px-2.5 py-1 rounded-lg border border-[#252B3F] text-emerald-300">
          <Cpu className="w-3.5 h-3.5 text-emerald-400" />
          <span>{elapsedMs} ms</span>
        </div>
      </div>

      {/* Game Over Alert if Zero Legal Placements Exist */}
      {allCandidates.length === 0 && (
        <div className="p-5 rounded-xl bg-rose-950/40 border-2 border-rose-500/70 text-center space-y-2">
          <Skull className="w-8 h-8 text-rose-400 mx-auto" />
          <h3 className="text-base font-black text-rose-200">
            NO VALID PLACEMENTS AVAILABLE (GAME OVER)
          </h3>
          <p className="text-xs text-rose-300/90 max-w-md mx-auto">
            The Current Piece cannot fit onto any empty cells across any of its 6 honeycomb rotations. Clear a cell on the board or change the Current Piece shape to continue.
          </p>
        </div>
      )}

      {/* Top 3 Recommendation Cards */}
      <div className="space-y-3">
        {topRecommendations.map((move, idx) => {
          const rankInfo = getRankLabel(idx);
          const isSelected = selectedMoveId === move.id;
          const isHovered = hoveredMoveId === move.id;
          const isExpanded = expandedBreakdownId === move.id;
          const netEmptyDelta = move.emptyCellsAfterPly2 - move.emptyCellsBefore;

          const rotatedCurrentPiece: PieceConfig = {
            shapeId: currentPiece.shapeId,
            rotation: move.rotation,
            tileStars: currentPiece.tileStars,
          };

          return (
            <div
              key={move.id}
              onMouseEnter={() => onHoverMove(move.id)}
              onMouseLeave={() => onHoverMove(null)}
              className={`rounded-2xl p-3.5 transition-all border-2 ${
                isSelected
                  ? 'bg-[#1A1F30] border-amber-400 shadow-[0_0_20px_rgba(251,191,36,0.2)]'
                  : isHovered
                  ? 'bg-[#181D2C] border-amber-400/60'
                  : idx === 0
                  ? 'bg-[#161B29] border-amber-500/40'
                  : 'bg-[#141824] border-[#283046]'
              }`}
            >
              {/* Card Top Row: Rank Badge, Strategic Tag, Score */}
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span
                    className={`px-2 py-0.5 rounded-md text-[10px] font-black tracking-wider uppercase ${rankInfo.badgeBg}`}
                  >
                    {rankInfo.title}
                  </span>
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${getToneStyle(
                      move.strategicTag.tone
                    )}`}
                  >
                    {move.strategicTag.label}
                  </span>
                </div>

                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-slate-400 font-medium">
                    Score:
                  </span>
                  <span
                    className={`font-mono text-sm font-black px-2 py-0.5 rounded bg-[#0C0E16] border border-[#283048] ${
                      move.totalScore >= 0 ? 'text-amber-300' : 'text-rose-400'
                    }`}
                  >
                    {move.totalScore > 0 ? `+${move.totalScore.toLocaleString()}` : move.totalScore.toLocaleString()}
                  </span>
                </div>
              </div>

              {/* Warnings Banner (if Premature Tier-Up Trap or Lethal) */}
              {move.warnings.length > 0 && (
                <div className="mb-2.5 p-2.5 rounded-xl bg-rose-950/50 border border-rose-500/60 space-y-1">
                  {move.warnings.map((w, wIdx) => (
                    <div
                      key={wIdx}
                      className="flex items-start gap-1.5 text-xs font-bold text-rose-200"
                    >
                      <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                      <span>{w}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Middle Row: Mini Orientation Diagram + Exact Placement Instructions */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center bg-[#0E111A] p-2.5 rounded-xl border border-[#23293D]">
                {/* Mini Rotated Piece Diagram */}
                <div className="sm:col-span-4">
                  <MiniPiecePreview piece={rotatedCurrentPiece} size="sm" />
                </div>

                {/* Exact Coordinates & Outcome Breakdown */}
                <div className="sm:col-span-8 space-y-1.5 text-xs">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                      1. Required Orientation:
                    </span>
                    <span className="font-bold text-amber-200">
                      {move.rotationDescription}
                    </span>
                  </div>

                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                      2. Target Board Coordinates:
                    </span>
                    <div className="flex flex-wrap gap-1 mt-0.5">
                      {move.placedTiles.map((pt) => (
                        <span
                          key={pt.tileIndex}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#181D2D] border border-[#2E3752] text-slate-100 font-semibold text-[11px]"
                        >
                          <span className="text-amber-300 font-black">
                            T{pt.tileIndex}
                          </span>
                          <span>→</span>
                          <span>{formatCellCoordVerbose(pt.col, pt.row)}</span>
                          <span className="text-amber-300 font-bold">
                            [{pt.star}★]
                          </span>
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Immediate Merges & Cascades */}
                  <div className="pt-1 border-t border-white/5 flex flex-col gap-1">
                    {move.ply1Sim.merges.length > 0 ? (
                      <div className="flex items-center gap-1.5 text-emerald-300 font-semibold">
                        <Flame className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        <span>
                          Ply 1:{' '}
                          {move.ply1Sim.merges
                            .map((m) => {
                              const { col, row } = indexToCoord(m.landingCell);
                              return `${m.mergedCells.length}× ${m.fromStar}★ → ${
                                m.toStar
                              }★ at ${String.fromCharCode(65 + col)}${row + 1}`;
                            })
                            .join('  ⇒  ')}
                        </span>
                      </div>
                    ) : (
                      <div className="text-slate-400">
                        Ply 1: Setup placement (no immediate merge)
                      </div>
                    )}

                    {/* Ambiguous Multi-Tile Merge Landing Override Control */}
                    {move.ply1Sim.ambiguousMerges.length > 0 && (
                      <div className="flex flex-wrap items-center justify-between gap-1.5 bg-cyan-950/35 border border-cyan-500/40 rounded-lg px-2 py-1 text-[11px] text-cyan-200">
                        <span>
                          Multi-tile {move.ply1Sim.ambiguousMerges[0].fromStar}★ merge lands at{' '}
                          <strong>
                            {(() => {
                              const { col, row } = indexToCoord(
                                move.ply1Sim.ambiguousMerges[0].primaryCell
                              );
                              return `${String.fromCharCode(65 + col)}${row + 1}`;
                            })()}
                          </strong>
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            onSwapAmbiguousLanding(
                              move.id,
                              move.ply1Sim.ambiguousMerges[0].alternativeCells[0]
                            )
                          }
                          className="px-2 py-0.5 rounded bg-cyan-500/25 hover:bg-cyan-500/40 text-cyan-100 font-bold flex items-center gap-1 border border-cyan-400/50"
                          title="Simulate landing the upgraded tile on the other placed square of this piece"
                        >
                          <ArrowLeftRight className="w-3 h-3" />
                          <span>Swap Landing Spot</span>
                        </button>
                      </div>
                    )}

                    {/* Best Ply-2 Next Piece Follow-Up */}
                    {nextPieceKnown && move.bestPly2 && (
                      <div className="flex items-start gap-1.5 text-cyan-300 font-medium">
                        <ArrowRight className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <span>
                          Next Piece Best Follow-Up: Place at{' '}
                          <strong>
                            {formatPlacedTilesSummary(move.bestPly2.placedTiles)}
                          </strong>
                          {move.bestPly2.sim.merges.length > 0 && (
                            <span className="text-emerald-300 font-bold ml-1">
                              (Merges{' '}
                              {move.bestPly2.sim.merges
                                .map((m) => `${m.fromStar}★→${m.toStar}★`)
                                .join(' ⇒ ')}
                              )
                            </span>
                          )}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* KPI Impact Pills (Empty Spaces, Stragglers, Mobility) */}
              <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="px-2 py-0.5 rounded bg-[#0E111A] border border-[#252C40] text-slate-300">
                    Open Cells:{' '}
                    <strong className="text-white">
                      {move.emptyCellsBefore} → {move.emptyCellsAfterPly2}
                    </strong>{' '}
                    <span
                      className={
                        netEmptyDelta >= 0 ? 'text-emerald-400' : 'text-amber-300'
                      }
                    >
                      ({netEmptyDelta >= 0 ? `+${netEmptyDelta}` : netEmptyDelta})
                    </span>
                  </span>

                  {move.rescuedStragglersCount > 0 && (
                    <span className="px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-500/50 text-emerald-300 font-bold flex items-center gap-1">
                      <ShieldCheck className="w-3 h-3" />
                      Clears {move.rescuedStragglersCount}× Low-Star Straggler!
                    </span>
                  )}

                  <span className="px-2 py-0.5 rounded bg-[#0E111A] border border-[#252C40] text-slate-400">
                    3-Tile Mobility:{' '}
                    <strong className="text-cyan-300">
                      {move.threeTileMobilityAfter}
                    </strong>
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    setExpandedBreakdownId(isExpanded ? null : move.id)
                  }
                  className="text-slate-400 hover:text-slate-200 flex items-center gap-0.5 font-medium"
                >
                  <span>Heuristic Breakdown</span>
                  {isExpanded ? (
                    <ChevronUp className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>

              {/* Collapsible Heuristic Score Breakdown */}
              {isExpanded && (
                <div className="mt-2 p-2.5 rounded-xl bg-[#0B0D14] border border-[#22283B] space-y-1 text-xs">
                  {move.scoreBreakdown.map((item, sIdx) => (
                    <div
                      key={sIdx}
                      className="flex items-center justify-between text-slate-300"
                    >
                      <span>{item.label}</span>
                      <span
                        className={`font-mono font-bold ${
                          item.value > 0
                            ? 'text-emerald-400'
                            : item.value < 0
                            ? 'text-rose-400'
                            : 'text-slate-400'
                        }`}
                      >
                        {item.value > 0 ? `+${item.value}` : item.value}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Action Buttons Row */}
              <div className="mt-3 pt-2.5 border-t border-[#252C42] flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    onSelectMove(isSelected ? null : move.id)
                  }
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 border transition-all ${
                    isSelected
                      ? 'bg-amber-400/20 text-amber-200 border-amber-400'
                      : 'bg-[#1A2032] hover:bg-[#222A40] text-slate-200 border-[#2F3956]'
                  }`}
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>{isSelected ? 'Locked on Board' : 'Preview on Board'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => onApplyPly1Move(move)}
                  className="flex-1 py-1.5 px-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-black text-xs flex items-center justify-center gap-1.5 shadow-md transition-all"
                  title="Execute Current Piece placement, resolve cascades, and promote Next Piece into Current Piece slot"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Apply Move (Current Piece)</span>
                </button>

                {nextPieceKnown && move.bestPly2 && (
                  <button
                    type="button"
                    onClick={() => onApplyBothMoves(move)}
                    className="py-1.5 px-2.5 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 border border-cyan-400/50 font-bold text-xs flex items-center gap-1 transition-all"
                    title="Fast-forward: Apply both Current Piece and best Next Piece follow-up"
                  >
                    <FastForward className="w-3.5 h-3.5" />
                    <span>Apply Both (2-Ply)</span>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Collapsible All Legal Moves & Filtered Trap/Lethal Moves Drawer */}
      {allCandidates.length > 3 && (
        <div className="pt-2 border-t border-[#242B3E]">
          <button
            type="button"
            onClick={() => setShowAllLegalMoves((v) => !v)}
            className="w-full py-2 px-3 rounded-xl bg-[#0E111A] hover:bg-[#161B28] border border-[#242B3E] flex items-center justify-between text-xs font-bold text-slate-300"
          >
            <span>
              View All {allCandidates.length} Valid Placements (
              {lethalMoves.length > 0
                ? `${lethalMoves.length} Lethal Move(s) Filtered`
                : 'Ranked by 2-Ply Score'}
              )
            </span>
            {showAllLegalMoves ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </button>

          {showAllLegalMoves && (
            <div className="mt-2 max-h-64 overflow-y-auto space-y-1.5 pr-1">
              {allCandidates.slice(3).map((move, idx) => {
                const rank = idx + 4;
                const isSelected = selectedMoveId === move.id;
                return (
                  <div
                    key={move.id}
                    onMouseEnter={() => onHoverMove(move.id)}
                    onMouseLeave={() => onHoverMove(null)}
                    onClick={() => onSelectMove(isSelected ? null : move.id)}
                    className={`p-2 rounded-xl border text-xs flex items-center justify-between gap-2 cursor-pointer transition-colors ${
                      move.isLethal
                        ? 'bg-rose-950/30 border-rose-700/50 text-rose-200'
                        : isSelected
                        ? 'bg-amber-500/15 border-amber-400 text-white'
                        : 'bg-[#0E111A] hover:bg-[#171C2B] border-[#232A3E] text-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <span className="font-mono font-bold text-slate-400">
                        #{rank}
                      </span>
                      {move.isLethal && (
                        <AlertOctagon className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                      )}
                      <span className="font-semibold truncate">
                        {formatPlacedTilesSummary(move.placedTiles)}
                      </span>
                      <span className="text-[10px] text-slate-400 truncate hidden sm:inline">
                        ({move.strategicTag.label})
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-mono font-bold text-amber-300">
                        {move.totalScore.toLocaleString()}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onApplyPly1Move(move);
                        }}
                        className="px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500 text-amber-200 hover:text-slate-950 font-bold text-[10px] border border-amber-400/40"
                      >
                        Apply
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
