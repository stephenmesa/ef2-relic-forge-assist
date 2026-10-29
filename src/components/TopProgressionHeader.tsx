import React from 'react';
import {
  AlertTriangle,
  Award,
  CheckCircle2,
  Flame,
  Hammer,
  Hash,
  Lock,
  Play,
  Redo2,
  RotateCcw,
  Share2,
  Skull,
  SlidersHorizontal,
  Sparkles,
  Star,
  Undo2,
  Zap,
} from 'lucide-react';
import {
  getMinActiveSpawnStar,
  MAX_HAMMERS,
  MAX_RUN_PLACEMENTS,
  RELIC_SPECS,
} from '../domain/constants';
import { formatCellCoord } from '../domain/honeycomb';
import { PRESET_SCENARIOS } from '../domain/presets';
import {
  CandidateMove,
  HammerAdvice,
  PresetScenario,
  StarAdvice,
  StragglerCellInfo,
} from '../types/forge';
import { getRelicSwatchStyle, RelicSvgIcon } from './RelicTileVisual';

interface TopProgressionHeaderProps {
  viewMode: 'simple' | 'advanced';
  onChangeViewMode: (mode: 'simple' | 'advanced') => void;
  hammerCount: number;
  onChangeHammerCount: (count: number) => void;
  hammerAdvice?: HammerAdvice;
  onUseHammer?: (cellIndex: number) => void;
  starAvailable: boolean;
  onToggleStarAvailable: (available: boolean) => void;
  starAdvice?: StarAdvice;
  onUseStar?: (cellIndex: number) => void;
  placementsMade: number;
  onChangePlacementsMade: (count: number) => void;
  blueprintMode?: boolean;
  onToggleBlueprintMode?: (active: boolean) => void;
  tenStarsAchieved: number;
  activeMove: CandidateMove | null;
  onApplyActiveMove: (move: CandidateMove) => void;
  maxUnlockedStar: number;
  isManualMaxStar: boolean;
  onSelectMaxStar: (star: number) => void;
  onResetAutoMaxStar: () => void;
  board: Uint8Array;
  emptyCellsCount: number;
  totalPlayableCells: number;
  stragglers: StragglerCellInfo[];
  threeTileMobility: number;
  triangleMobility: number;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onClearBoard: () => void;
  onLoadPreset: (preset: PresetScenario) => void;
  onShareState: () => void;
  activePresetId: string | null;
}

export const TopProgressionHeader: React.FC<TopProgressionHeaderProps> = ({
  viewMode,
  onChangeViewMode,
  hammerCount,
  onChangeHammerCount,
  hammerAdvice,
  onUseHammer,
  starAvailable,
  onToggleStarAvailable,
  starAdvice,
  onUseStar,
  placementsMade,
  onChangePlacementsMade,
  blueprintMode = false,
  onToggleBlueprintMode,
  tenStarsAchieved,
  activeMove,
  onApplyActiveMove,
  maxUnlockedStar,
  isManualMaxStar,
  onSelectMaxStar,
  onResetAutoMaxStar,
  board,
  emptyCellsCount,
  totalPlayableCells,
  stragglers,
  threeTileMobility,
  triangleMobility,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onClearBoard,
  onLoadPreset,
  onShareState,
  activePresetId,
}) => {
  const minActiveStar = getMinActiveSpawnStar(maxUnlockedStar);
  const deadCount = stragglers.filter((s) => s.status === 'dead').length;
  const atRiskCount = stragglers.filter((s) => s.status === 'at-risk').length;
  const isAdvanced = viewMode === 'advanced';
  const hammerAvailable = hammerCount > 0;
  const isTenStarAchieved = maxUnlockedStar >= 10 || tenStarsAchieved > 0;

  // Count how many tiles of each star exist on the board
  const starBoardCounts = new Array(11).fill(0);
  for (let i = 0; i < board.length; i++) {
    const s = board[i];
    if (s >= 1 && s <= 10) starBoardCounts[s]++;
  }

  return (
    <header className="sticky top-0 z-40 lg:static bg-[#131620]/95 backdrop-blur border-b border-[#293044] shadow-lg">
      <div className="max-w-[1680px] mx-auto px-3 sm:px-5 py-2 space-y-2">
        {/* Top Row: Brand, Simple/Advanced View Toggle, Hammer Status, History */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 via-orange-600 to-red-700 flex items-center justify-center shadow-[0_0_12px_rgba(245,158,11,0.4)] border border-amber-300/40">
              <Flame className="w-5 h-5 text-amber-100" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base sm:text-lg font-extrabold tracking-tight bg-gradient-to-r from-amber-200 via-yellow-300 to-amber-400 bg-clip-text text-transparent">
                  EF2 Relic Forge Advisor
                </h1>
                {isAdvanced && (
                  <span className="hidden md:inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/15 text-amber-300 border border-amber-400/30">
                    2-Ply Tactical Solver
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Right Controls: Quick Apply Move, Simple/Advanced View Switch, Hammer Toggle, History */}
          <div className="flex flex-wrap items-center gap-2">
            {/* If Hammer Advisor actively recommends smashing now, surface 1-tap Smash button at the top on mobile */}
            {hammerAvailable &&
              hammerAdvice?.shouldUseNow &&
              hammerAdvice.recommendedTarget &&
              onUseHammer && (
                <button
                  type="button"
                  onClick={() =>
                    onUseHammer(hammerAdvice.recommendedTarget!.cellIndex)
                  }
                  className="lg:hidden px-2.5 py-1.5 rounded-lg bg-gradient-to-r from-rose-500 to-amber-500 hover:from-rose-400 hover:to-amber-400 text-slate-950 font-black text-xs flex items-center gap-1 shadow-md border border-amber-200 transition-all"
                  title={hammerAdvice.headline}
                >
                  <Hammer className="w-3.5 h-3.5" />
                  <span>
                    Smash{' '}
                    {formatCellCoord(
                      hammerAdvice.recommendedTarget.col,
                      hammerAdvice.recommendedTarget.row
                    )}
                  </span>
                </button>
              )}

            {/* If Star Advisor actively recommends upgrading now, surface 1-tap Upgrade button on mobile */}
            {starAvailable &&
              starAdvice?.shouldUseNow &&
              starAdvice.recommendedTarget &&
              onUseStar && (
                <button
                  type="button"
                  onClick={() =>
                    onUseStar(starAdvice.recommendedTarget!.cellIndex)
                  }
                  className="lg:hidden px-2.5 py-1.5 rounded-lg bg-gradient-to-r from-cyan-400 to-amber-300 hover:from-cyan-300 hover:to-amber-200 text-slate-950 font-black text-xs flex items-center gap-1 shadow-md border border-cyan-100 transition-all"
                  title={starAdvice.headline}
                >
                  <Star className="w-3.5 h-3.5 fill-current" />
                  <span>
                    Upgrade{' '}
                    {formatCellCoord(
                      starAdvice.recommendedTarget.col,
                      starAdvice.recommendedTarget.row
                    )}
                  </span>
                </button>
              )}

            {/* 10★ Achieved Badge (Visible in both Simple & Advanced views once achieved) */}
            {isTenStarAchieved && (
              <span
                className="px-2.5 py-1 rounded-lg bg-gradient-to-r from-amber-500/25 via-rose-500/25 to-purple-500/25 border border-amber-300/60 text-amber-200 text-xs font-black flex items-center gap-1 shadow-[0_0_12px_rgba(251,191,36,0.3)]"
                title="10★ Mythic Primordial Relic achieved! (10★ relics disappear from the board upon creation)"
              >
                <Award className="w-3.5 h-3.5 text-amber-300" />
                <span>
                  10★ Achieved
                  {tenStarsAchieved > 1 ? ` (${tenStarsAchieved}×)` : ''}
                </span>
              </span>
            )}

            {/* Top Shortcut: Apply Selected / Best Move */}
            {activeMove && placementsMade < MAX_RUN_PLACEMENTS && (
              <button
                type="button"
                onClick={() => onApplyActiveMove(activeMove)}
                className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 active:scale-[0.98] text-slate-950 font-black text-xs flex items-center gap-1.5 shadow-[0_0_12px_rgba(245,158,11,0.35)] border border-amber-300 transition-all"
                title="Apply the currently selected / #1 Best Move and advance Next Piece into Current Piece"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Apply Move</span>
                <span className="font-mono text-[11px] bg-black/15 px-1.5 py-0.2 rounded">
                  {activeMove.placedTiles
                    .map((pt) => formatCellCoord(pt.col, pt.row))
                    .join('·')}
                </span>
              </button>
            )}
            {/* Simple vs Advanced View Mode Segmented Switch */}
            <div
              className="flex items-center bg-[#0D0F17] p-0.5 rounded-lg border border-[#293044]"
              role="group"
              aria-label="Interface View Mode"
            >
              <button
                type="button"
                onClick={() => onChangeViewMode('simple')}
                className={`px-2.5 py-1 rounded-md text-xs font-bold flex items-center gap-1 transition-all ${
                  !isAdvanced
                    ? 'bg-amber-400 text-slate-950 shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Simple View: Only the controls and move instructions needed to play"
              >
                <Zap className="w-3.5 h-3.5" />
                <span>Simple View</span>
              </button>
              <button
                type="button"
                onClick={() => onChangeViewMode('advanced')}
                className={`px-2.5 py-1 rounded-md text-xs font-bold flex items-center gap-1 transition-all ${
                  isAdvanced
                    ? 'bg-indigo-500 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Advanced View: Show progression bar, board KPIs, neighbor radar, and full solver breakdown"
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                <span>Advanced View</span>
              </button>
            </div>

            {/* Hammer Count Status Button (0..2, +1 on 5+ relic merge) */}
            <button
              type="button"
              onClick={() => {
                // Cycle 1 -> 2 -> 0 -> 1
                const nextCount =
                  hammerCount === 1 ? 2 : hammerCount === 2 ? 0 : 1;
                onChangeHammerCount(nextCount);
              }}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all flex items-center gap-1.5 ${
                hammerCount > 0
                  ? 'bg-emerald-500/20 text-emerald-200 border-emerald-400/50 shadow-[0_0_10px_rgba(16,185,129,0.2)]'
                  : 'bg-[#0D0F17] text-slate-400 border-[#293044] hover:text-slate-200'
              }`}
              title="Run Hammers (Start with 1; earn +1 when merging 5+ relics, max 2). Click to cycle 0 / 1 / 2."
            >
              <Hammer
                className={`w-3.5 h-3.5 ${
                  hammerCount > 0 ? 'text-emerald-400' : 'text-slate-500'
                }`}
              />
              <span>
                Hammer: {hammerCount}/{MAX_HAMMERS}
              </span>
            </button>

            {/* 1× Per Run Star Status Toggle */}
            <button
              type="button"
              onClick={() => onToggleStarAvailable(!starAvailable)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all flex items-center gap-1.5 ${
                starAvailable
                  ? 'bg-cyan-500/20 text-cyan-200 border-cyan-400/50 shadow-[0_0_10px_rgba(34,211,238,0.2)]'
                  : 'bg-[#0D0F17] text-slate-400 border-[#293044] hover:text-slate-200'
              }`}
              title="Toggle whether your single-use Run Star (raises 1 relic by +1 grade, except 9★) is still available in this run"
            >
              <Star
                className={`w-3.5 h-3.5 ${
                  starAvailable ? 'text-cyan-300 fill-cyan-300/30' : 'text-slate-500'
                }`}
              />
              <span>1× Star: {starAvailable ? 'Ready' : 'Used'}</span>
            </button>

            {/* Run Placements Counter (Max 1000 placements per run) */}
            <div
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold border flex items-center gap-1.5 ${
                placementsMade >= MAX_RUN_PLACEMENTS
                  ? 'bg-rose-950/60 text-rose-200 border-rose-500/60'
                  : placementsMade >= MAX_RUN_PLACEMENTS - 25
                  ? 'bg-amber-950/50 text-amber-200 border-amber-400/50'
                  : 'bg-[#0D0F17] text-slate-300 border-[#293044]'
              }`}
              title={`Placements made in this run (Maximum ${MAX_RUN_PLACEMENTS} placements per run)`}
            >
              <Hash className="w-3.5 h-3.5 text-amber-400" />
              <span>Moves:</span>
              <input
                type="number"
                min={0}
                max={MAX_RUN_PLACEMENTS}
                aria-label="Run Placements Made"
                value={placementsMade}
                onChange={(e) => {
                  const val = Math.max(
                    0,
                    Math.min(MAX_RUN_PLACEMENTS, parseInt(e.target.value, 10) || 0)
                  );
                  onChangePlacementsMade(val);
                }}
                className="w-14 bg-[#161B29] text-amber-200 font-mono font-bold text-center rounded px-1 py-0.5 border border-[#2E3650] focus:outline-none focus:ring-1 focus:ring-amber-400"
              />
              <span className="text-slate-400 font-mono">
                / {MAX_RUN_PLACEMENTS}
              </span>
            </div>

            {/* 🏛️ Endgame Blueprint Mode Toggle */}
            {onToggleBlueprintMode && (
              <button
                type="button"
                onClick={() => onToggleBlueprintMode(!blueprintMode)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border transition-all flex items-center gap-1.5 ${
                  blueprintMode
                    ? 'bg-amber-500/25 text-amber-200 border-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.3)] ring-1 ring-amber-400/50'
                    : 'bg-[#0D0F17] text-slate-400 border-[#293044] hover:text-amber-300 hover:border-amber-500/40'
                }`}
                title="🏛️ Endgame Blueprint Mode: Hyper-focuses advisor moves exclusively on the Perimeter 5-Super-Merge into 10★ Mythic strategy!"
              >
                <Award
                  className={`w-3.5 h-3.5 ${
                    blueprintMode ? 'text-amber-400 fill-amber-400/30' : 'text-slate-400'
                  }`}
                />
                <span>Blueprint: {blueprintMode ? 'ON' : 'OFF'}</span>
              </button>
            )}

            {/* Load Example Scenario Dropdown (Advanced View Only) */}
            {isAdvanced && (
              <div className="relative">
                <select
                  aria-label="Load Example Gameplay Scenario"
                  value={activePresetId || ''}
                  onChange={(e) => {
                    const found = PRESET_SCENARIOS.find((p) => p.id === e.target.value);
                    if (found) onLoadPreset(found);
                  }}
                  className="bg-[#1A1E2C] hover:bg-[#22283A] text-amber-200 text-xs font-semibold rounded-lg px-3 py-1.5 border border-amber-500/40 focus:outline-none focus:ring-2 focus:ring-amber-400 cursor-pointer"
                >
                  <option value="" disabled>
                    🎬 Load Gameplay Scenario...
                  </option>
                  {PRESET_SCENARIOS.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.title} ({preset.videoTimestamp})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Undo / Redo / Share / Reset */}
            <div className="flex items-center gap-1 bg-[#0D0F17] p-1 rounded-lg border border-[#293044]">
              <button
                type="button"
                onClick={onUndo}
                disabled={!canUndo}
                className="p-1.5 rounded text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-35 disabled:pointer-events-none"
                title="Undo (Ctrl+Z)"
              >
                <Undo2 className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={onRedo}
                disabled={!canRedo}
                className="p-1.5 rounded text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-35 disabled:pointer-events-none"
                title="Redo (Ctrl+Y)"
              >
                <Redo2 className="w-4 h-4" />
              </button>
              {isAdvanced && (
                <button
                  type="button"
                  onClick={onShareState}
                  className="px-2 py-1 rounded text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 flex items-center gap-1"
                  title="Copy shareable board state link"
                >
                  <Share2 className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Share</span>
                </button>
              )}
              <button
                type="button"
                onClick={onClearBoard}
                className="px-2 py-1 rounded text-xs font-medium text-rose-300 hover:text-rose-100 hover:bg-rose-950/60 flex items-center gap-1"
                title="Clear board and reset run"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Reset</span>
              </button>
            </div>
          </div>
        </div>

        {/* Middle Row: 10-Slot Relic Progression Bar (1★ to 10★) & Live Board KPIs (Advanced View Only) */}
        {isAdvanced && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-2 items-center bg-[#0D0F17]/90 p-2 rounded-xl border border-[#262C3F]">
          {/* 10-Slot Relic Progression Bar */}
          <div className="xl:col-span-8 flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2 px-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                  Relic Progression & Active Spawn Window:
                </span>
                <span className="text-xs font-semibold text-amber-300 bg-amber-500/15 px-2 py-0.5 rounded border border-amber-400/30">
                  Highest Unlocked (M) = {maxUnlockedStar}★
                </span>
                <span className="text-[11px] text-emerald-300 font-medium">
                  Spawning: {minActiveStar}★–{maxUnlockedStar}★
                </span>
                {maxUnlockedStar > 4 && (
                  <span className="text-[11px] text-rose-400 font-semibold">
                    Retired: 1★{maxUnlockedStar - 4 > 1 ? `–${maxUnlockedStar - 4}★` : ''}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-slate-400">
                  Click 4★–10★ to set Max Unlocked Tier:
                </span>
                {isManualMaxStar && (
                  <button
                    type="button"
                    onClick={onResetAutoMaxStar}
                    className="text-[11px] text-amber-300 hover:underline font-medium"
                  >
                    Reset to Auto-Detect
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-5 sm:grid-cols-10 gap-1.5 pt-1">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((star) => {
                const spec = RELIC_SPECS[star];
                const isTenSlot = star === 10;
                const isRetired = star < minActiveStar;
                const isActivePool =
                  !isTenSlot && star >= minActiveStar && star <= maxUnlockedStar;
                const isMaxUnlocked = star === maxUnlockedStar;
                const isLocked = star > maxUnlockedStar;
                const countOnBoard = starBoardCounts[star];
                const canSelectAsMax = star >= 4;

                return (
                  <button
                    key={star}
                    type="button"
                    disabled={!canSelectAsMax}
                    onClick={() => canSelectAsMax && onSelectMaxStar(star)}
                    title={
                      isTenSlot
                        ? isTenStarAchieved
                          ? `10★ (${spec.name}) — ACHIEVED! 10★ relics disappear from the board when created and are marked as achieved.`
                          : `10★ (${spec.name}) — GOAL. When created, 10★ relics disappear from the board and are marked as achieved. Click to mark 10★ achieved.`
                        : isRetired
                        ? `${star}★ (${spec.name}) — RETIRED (No longer spawns when M=${maxUnlockedStar}★). ${countOnBoard} on board.`
                        : isActivePool
                        ? `${star}★ (${spec.name}) — ACTIVE SPAWN POOL. Click to set M=${star}★.`
                        : `${star}★ (${spec.name}) — LOCKED. Click to set M=${star}★.`
                    }
                    className={`relative flex flex-col items-center justify-between p-1.5 rounded-lg border transition-all select-none ${
                      isTenSlot && isTenStarAchieved
                        ? 'bg-gradient-to-b from-amber-950/60 to-[#1D2233] border-amber-300 shadow-[0_0_14px_rgba(251,191,36,0.4)]'
                        : isActivePool
                        ? 'bg-[#1D2233] border-amber-400/80 shadow-[0_0_10px_rgba(245,158,11,0.22)]'
                        : isRetired
                        ? 'bg-rose-950/25 border-rose-800/50 opacity-75'
                        : 'bg-[#121520] border-slate-800 opacity-50 hover:opacity-85'
                    } ${canSelectAsMax ? 'cursor-pointer hover:scale-[1.03]' : 'cursor-default'}`}
                  >
                    {/* Top Zone Badge */}
                    <div className="w-full flex items-center justify-between text-[10px] font-bold leading-none mb-1">
                      <span
                        className="px-1 py-0.5 rounded text-white font-black drop-shadow-[0_1px_1px_rgba(0,0,0,0.85)]"
                        style={getRelicSwatchStyle(star)}
                      >
                        {star}★
                      </span>
                      {isTenSlot && isTenStarAchieved && (
                        <span className="text-[9px] text-amber-300 font-extrabold uppercase">
                          👑 WON
                        </span>
                      )}
                      {isRetired && (
                        <span className="inline-flex items-center gap-0.5 text-[9px] text-rose-400 font-extrabold uppercase">
                          <Skull className="w-3 h-3" />
                        </span>
                      )}
                      {isActivePool && (
                        <span
                          className={`text-[9px] font-extrabold uppercase ${
                            isMaxUnlocked ? 'text-amber-300' : 'text-emerald-300'
                          }`}
                        >
                          {isMaxUnlocked ? 'MAX' : 'SPAWN'}
                        </span>
                      )}
                      {isLocked && <Lock className="w-2.5 h-2.5 text-slate-500" />}
                    </div>

                    {/* Relic Silhouette */}
                    <div
                      className="my-0.5"
                      style={{
                        color: isLocked ? '#475569' : spec.borderHex,
                      }}
                    >
                      <RelicSvgIcon star={star} className="w-5 h-5" />
                    </div>

                    {/* Bottom Status / Board Count */}
                    <div className="w-full flex items-center justify-between text-[9px] leading-none mt-1 pt-1 border-t border-white/10">
                      <span className="truncate text-slate-300 font-medium">
                        {isTenSlot
                          ? isTenStarAchieved
                            ? 'ACHIEVED'
                            : 'GOAL'
                          : isRetired
                          ? 'RETIRED'
                          : isActivePool
                          ? 'ACTIVE'
                          : 'LOCKED'}
                      </span>
                      {isTenSlot && isTenStarAchieved ? (
                        <span className="px-1 rounded font-bold bg-amber-400 text-slate-950">
                          {tenStarsAchieved > 0 ? `${tenStarsAchieved}×` : '✓'}
                        </span>
                      ) : (
                        countOnBoard > 0 && (
                          <span
                            className={`px-1 rounded font-bold ${
                              isRetired
                                ? 'bg-rose-600 text-white animate-pulse'
                                : 'bg-slate-700 text-slate-200'
                            }`}
                          >
                            {countOnBoard}×
                          </span>
                        )
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Live Board Health KPIs */}
          <div className="xl:col-span-4 grid grid-cols-3 gap-2">
            {/* Empty Spaces KPI */}
            <div className="bg-[#151926] border border-[#283046] rounded-xl p-2.5 flex flex-col justify-between">
              <span className="text-[11px] text-slate-400 font-medium">Empty Spaces</span>
              <div className="flex items-baseline justify-between mt-1">
                <span
                  className={`text-xl font-black ${
                    emptyCellsCount <= 5
                      ? 'text-rose-400'
                      : emptyCellsCount <= 9
                      ? 'text-amber-300'
                      : 'text-emerald-400'
                  }`}
                >
                  {emptyCellsCount}{' '}
                  <span className="text-xs font-normal text-slate-400">
                    / {totalPlayableCells}
                  </span>
                </span>
              </div>
              <span className="text-[10px] text-slate-400 mt-1">
                {emptyCellsCount <= 6
                  ? 'Critical board congestion!'
                  : 'Contiguous breathing room'}
              </span>
            </div>

            {/* Dead / Endangered Stragglers KPI */}
            <div
              className={`rounded-xl p-2.5 flex flex-col justify-between border ${
                deadCount > 0
                  ? 'bg-rose-950/30 border-rose-600/60'
                  : atRiskCount > 0
                  ? 'bg-amber-950/25 border-amber-500/50'
                  : 'bg-emerald-950/20 border-emerald-600/40'
              }`}
            >
              <span className="text-[11px] text-slate-300 font-medium flex items-center justify-between">
                <span>Stragglers</span>
                {deadCount > 0 ? (
                  <Skull className="w-3.5 h-3.5 text-rose-400" />
                ) : atRiskCount > 0 ? (
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                ) : (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                )}
              </span>
              <div className="flex items-baseline gap-1.5 mt-1">
                <span
                  className={`text-xl font-black ${
                    deadCount > 0
                      ? 'text-rose-400'
                      : atRiskCount > 0
                      ? 'text-amber-300'
                      : 'text-emerald-400'
                  }`}
                >
                  {deadCount > 0 ? `${deadCount} Dead` : `${atRiskCount} At-Risk`}
                </span>
              </div>
              <span className="text-[10px] text-slate-300/80 mt-1 truncate">
                {deadCount > 0
                  ? `Permanent dead space (${minActiveStar - 1}★ or lower)`
                  : atRiskCount > 0
                  ? `${atRiskCount}× ${minActiveStar}★ retire at ${maxUnlockedStar + 1}★`
                  : 'Zero dead spaces!'}
              </span>
            </div>

            {/* 3-Tile Piece Mobility KPI (Including 3-Triangle Protection) */}
            <div
              className={`rounded-xl p-2.5 flex flex-col justify-between border ${
                triangleMobility === 0
                  ? 'bg-rose-950/30 border-rose-600/60'
                  : triangleMobility <= 2
                  ? 'bg-amber-950/25 border-amber-500/50'
                  : 'bg-[#151926] border-[#283046]'
              }`}
            >
              <span className="text-[11px] text-slate-300 font-medium flex items-center justify-between">
                <span>3-Tile Mobility</span>
                <Sparkles
                  className={`w-3.5 h-3.5 ${
                    triangleMobility === 0 ? 'text-rose-400' : 'text-cyan-400'
                  }`}
                />
              </span>
              <div className="flex items-baseline gap-1.5 mt-1">
                <span
                  className={`text-xl font-black ${
                    triangleMobility === 0
                      ? 'text-rose-400'
                      : threeTileMobility <= 12
                      ? 'text-amber-300'
                      : 'text-cyan-300'
                  }`}
                >
                  {threeTileMobility}
                </span>
                <span className="text-[11px] text-slate-400">
                  ({triangleMobility} ▲-Tri)
                </span>
              </div>
              <span
                className={`text-[10px] mt-1 truncate ${
                  triangleMobility === 0
                    ? 'text-rose-300 font-bold'
                    : triangleMobility <= 2
                    ? 'text-amber-300'
                    : 'text-slate-400'
                }`}
              >
                {triangleMobility === 0
                  ? 'DANGER: 0 3-Triangle fits!'
                  : `Line, Bent, Arch & ${triangleMobility} Triangle fits`}
              </span>
            </div>
          </div>
        </div>
        )}
      </div>
    </header>
  );
};
