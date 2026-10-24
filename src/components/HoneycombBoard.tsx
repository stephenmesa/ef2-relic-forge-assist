import React, { useEffect, useState } from 'react';
import {
  Compass,
  Eraser,
  Eye,
  Hand,
  HelpCircle,
  Layers,
  MousePointerClick,
  Sparkles,
} from 'lucide-react';
import { getMinActiveSpawnStar, RELIC_SPECS } from '../domain/constants';
import {
  BOARD_COLS,
  cellToIndex,
  formatCellCoord,
  getColumnRowCount,
  getDirectionalNeighbors,
} from '../domain/honeycomb';
import {
  CandidateMove,
  StragglerCellInfo,
} from '../types/forge';
import { getRelicSwatchStyle, RelicTileVisual } from './RelicTileVisual';

interface HoneycombBoardProps {
  board: Uint8Array;
  maxUnlockedStar: number;
  stragglers: StragglerCellInfo[];
  activeBrush: number | 'inspect' | 'popover'; // 0 = eraser, 1..10 = paint star, 'inspect' = inspect neighbors, 'popover' = click picker
  onChangeBrush: (brush: number | 'inspect' | 'popover') => void;
  onSetCellStar: (cellIndex: number, star: number) => void;
  previewMove: CandidateMove | null;
  previewRank: number | null;
  showPly2Ghost: boolean;
  onToggleShowPly2Ghost: () => void;
  onSelectAlternateLanding?: (moveId: string, cellIndex: number) => void;
}

export const HoneycombBoard: React.FC<HoneycombBoardProps> = ({
  board,
  maxUnlockedStar,
  stragglers,
  activeBrush,
  onChangeBrush,
  onSetCellStar,
  previewMove,
  previewRank,
  showPly2Ghost,
  onToggleShowPly2Ghost,
  onSelectAlternateLanding,
}) => {
  const [hoveredCell, setHoveredCell] = useState<{ col: number; row: number } | null>(
    null
  );
  const [isMouseDown, setIsMouseDown] = useState(false);
  const [popoverCell, setPopoverCell] = useState<{ col: number; row: number } | null>(
    null
  );
  const [alwaysShowNeighborsOnHover, setAlwaysShowNeighborsOnHover] = useState(true);

  const minActiveStar = getMinActiveSpawnStar(maxUnlockedStar);

  // Global mouseup listener to end drag painting
  useEffect(() => {
    const handleUp = () => setIsMouseDown(false);
    window.addEventListener('mouseup', handleUp);
    return () => window.removeEventListener('mouseup', handleUp);
  }, []);

  // Keyboard shortcuts while hovering a cell: 1-9, 0 (for 10★), Backspace/Delete/E (for Empty)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement &&
        ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)
      ) {
        return;
      }
      if (!hoveredCell) return;
      const idx = cellToIndex(hoveredCell.col, hoveredCell.row);

      if (e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        onSetCellStar(idx, parseInt(e.key, 10));
      } else if (e.key === '0') {
        e.preventDefault();
        onSetCellStar(idx, 10);
      } else if (
        e.key === 'Backspace' ||
        e.key === 'Delete' ||
        e.key.toLowerCase() === 'e'
      ) {
        e.preventDefault();
        onSetCellStar(idx, 0);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hoveredCell, onSetCellStar]);

  // Build lookup maps for stragglers, ghost tiles, merges, and neighbor inspection
  const stragglerByCell = new Map<number, StragglerCellInfo>();
  for (const s of stragglers) {
    stragglerByCell.set(s.cellIndex, s);
  }

  const ply1GhostByCell = new Map<
    number,
    { tileIndex: number; star: number }
  >();
  const ply2GhostByCell = new Map<
    number,
    { tileIndex: number; star: number }
  >();
  const mergedExistingCells = new Set<number>();
  const landingOutcomeByCell = new Map<
    number,
    { finalStar: number; chainSteps: number[]; isPrimary: boolean }
  >();
  const altLandingCells = new Map<number, { fromStar: number; toStar: number }>();

  if (previewMove) {
    for (const pt of previewMove.placedTiles) {
      ply1GhostByCell.set(pt.cellIndex, {
        tileIndex: pt.tileIndex,
        star: pt.star,
      });
    }

    for (const m of previewMove.ply1Sim.merges) {
      for (const c of m.mergedCells) {
        if (!ply1GhostByCell.has(c)) {
          mergedExistingCells.add(c);
        }
      }
      const prev = landingOutcomeByCell.get(m.landingCell);
      const chainSteps = prev ? [...prev.chainSteps, m.toStar] : [m.fromStar, m.toStar];
      landingOutcomeByCell.set(m.landingCell, {
        finalStar: m.toStar,
        chainSteps,
        isPrimary: true,
      });

      for (const alt of m.alternativeLandingCells) {
        altLandingCells.set(alt, { fromStar: m.fromStar, toStar: m.toStar });
      }
    }

    if (showPly2Ghost && previewMove.bestPly2) {
      for (const pt2 of previewMove.bestPly2.placedTiles) {
        ply2GhostByCell.set(pt2.cellIndex, {
          tileIndex: pt2.tileIndex,
          star: pt2.star,
        });
      }
    }
  }

  // Directional neighbors of the currently hovered cell
  const hoveredNeighborsMap = new Map<number, string>();
  if (hoveredCell && (activeBrush === 'inspect' || alwaysShowNeighborsOnHover)) {
    const dirs = getDirectionalNeighbors(
      hoveredCell.col,
      hoveredCell.row
    );
    for (const d of dirs) {
      hoveredNeighborsMap.set(d.cellIndex, d.dir);
    }
  }

  const handleCellMouseDown = (
    col: number,
    row: number,
    e: React.MouseEvent
  ) => {
    if (e.button === 2) {
      // Right-click always clears cell
      e.preventDefault();
      onSetCellStar(cellToIndex(col, row), 0);
      setPopoverCell(null);
      return;
    }

    const idx = cellToIndex(col, row);

    // If user clicked an alternative merge landing spot while previewing a move
    if (
      previewMove &&
      altLandingCells.has(idx) &&
      onSelectAlternateLanding
    ) {
      onSelectAlternateLanding(previewMove.id, idx);
      return;
    }

    if (activeBrush === 'inspect') {
      setHoveredCell({ col, row });
      return;
    }

    if (activeBrush === 'popover') {
      setPopoverCell(
        popoverCell && popoverCell.col === col && popoverCell.row === row
          ? null
          : { col, row }
      );
      return;
    }

    setIsMouseDown(true);
    onSetCellStar(idx, activeBrush);
    setPopoverCell(null);
  };

  const handleCellMouseEnter = (col: number, row: number) => {
    setHoveredCell({ col, row });
    if (
      isMouseDown &&
      typeof activeBrush === 'number'
    ) {
      onSetCellStar(cellToIndex(col, row), activeBrush);
    }
  };

  return (
    <div className="bg-[#131621] border border-[#293044] rounded-2xl p-2.5 sm:p-3 shadow-xl flex flex-col gap-2">
      {/* Top Bar: Express Paint Palette & Neighbor Inspection Controls */}
      <div className="flex flex-col gap-1.5 bg-[#0D0F17] p-2 rounded-xl border border-[#252B3D]">
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-amber-300 flex items-center gap-1">
              <Hand className="w-3.5 h-3.5" />
              Paint Palette
            </span>
            <span className="hidden xl:inline text-[10px] text-slate-400">
              Drag to paint • Right-click clear • Keys 1–9, 0, E
            </span>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setAlwaysShowNeighborsOnHover((v) => !v)}
              className={`px-2 py-0.5 rounded-md text-[10px] font-semibold flex items-center gap-1 border transition-colors ${
                alwaysShowNeighborsOnHover || activeBrush === 'inspect'
                  ? 'bg-indigo-500/20 text-indigo-200 border-indigo-400/50'
                  : 'bg-[#171B28] text-slate-400 border-slate-700 hover:text-slate-200'
              }`}
              title="Highlight 6 honeycomb neighbors (N, NE, SE, S, SW, NW) when hovering any cell"
            >
              <Compass className="w-3 h-3" />
              <span>6-Neighbors</span>
            </button>

            <button
              type="button"
              onClick={() =>
                onChangeBrush(activeBrush === 'popover' ? minActiveStar : 'popover')
              }
              className={`px-2 py-0.5 rounded-md text-[10px] font-semibold flex items-center gap-1 border transition-colors ${
                activeBrush === 'popover'
                  ? 'bg-amber-500 text-slate-950 border-amber-300'
                  : 'bg-[#171B28] text-slate-300 border-slate-700 hover:text-white'
              }`}
              title="Click any cell to open a radial star picker popover"
            >
              <MousePointerClick className="w-3 h-3" />
              <span>Picker</span>
            </button>
          </div>
        </div>

        {/* Palette Buttons: Eraser + 1★ to 10★ */}
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={() => onChangeBrush(0)}
            className={`px-2 py-1 rounded-md text-[11px] font-bold flex items-center gap-1 border transition-all ${
              activeBrush === 0
                ? 'bg-rose-600 text-white border-rose-300 ring-1 ring-rose-400/50'
                : 'bg-[#181C29] text-slate-300 border-[#2D354C] hover:bg-[#22283A]'
            }`}
            title="Eraser (Clear Cell) — Shortcut: E or Backspace"
          >
            <Eraser className="w-3 h-3" />
            <span>Empty</span>
          </button>

          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((star) => {
            const spec = RELIC_SPECS[star];
            const isSelected = activeBrush === star;
            const isActiveSpawn = star >= minActiveStar && star <= maxUnlockedStar;
            const isRetired = star < minActiveStar;

            return (
              <button
                key={star}
                type="button"
                onClick={() => onChangeBrush(star)}
                className={`relative px-2 py-1 rounded-md text-[11px] font-black flex items-center gap-1 border transition-all ${
                  isSelected
                    ? 'ring-2 ring-amber-300 scale-105 shadow-md text-white'
                    : 'hover:scale-[1.03] text-white/95'
                }`}
                style={{
                  ...getRelicSwatchStyle(star, {
                    isSelected,
                    dimmed: !isSelected,
                  }),
                  opacity: isRetired && !isSelected ? 0.65 : 1,
                }}
                title={`Paint ${star}★ (${spec.name}) — Shortcut: ${star === 10 ? '0' : star}`}
              >
                <span>{star}★</span>
                {isActiveSpawn && (
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 shadow-[0_0_4px_#6ee7b7]" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Active Recommendation Ghost Banner (if a move is being previewed) */}
      {previewMove && (
        <div className="flex flex-wrap items-center justify-between gap-1.5 px-2.5 py-1.5 rounded-xl bg-amber-500/10 border border-amber-400/40 text-[11px]">
          <div className="flex items-center gap-1.5 truncate">
            <span className="px-1.5 py-0.5 rounded bg-amber-400 text-slate-950 font-black uppercase text-[10px]">
              {previewRank ? `#${previewRank} Ghost` : 'Preview'}
            </span>
            <span className="font-semibold text-amber-200 truncate">
              {previewMove.strategicTag.label}
            </span>
          </div>

          {previewMove.bestPly2 && (
            <button
              type="button"
              onClick={onToggleShowPly2Ghost}
              className={`px-2 py-0.5 rounded-md text-[10px] font-semibold flex items-center gap-1 border transition-all shrink-0 ${
                showPly2Ghost
                  ? 'bg-cyan-500/25 text-cyan-200 border-cyan-400/60'
                  : 'bg-[#171B28] text-slate-300 border-slate-700 hover:text-white'
              }`}
            >
              <Layers className="w-3 h-3" />
              <span>{showPly2Ghost ? 'Hide Next Ghost' : 'Show Next Ghost'}</span>
            </button>
          )}
        </div>
      )}

      {/* Honeycomb 5-Column Staggered Grid Container (Compact Width so Board + Pieces fit on 1 screen) */}
      <div
        className="relative mx-auto w-full max-w-[390px] bg-gradient-to-b from-[#181C2B] to-[#0F121C] rounded-2xl p-3 sm:p-3.5 border-2 border-[#343C56] shadow-[inset_0_4px_24px_rgba(0,0,0,0.75)] select-none"
        onContextMenu={(e) => e.preventDefault()}
        onMouseLeave={() => setHoveredCell(null)}
      >
        {/* Column Headers (Col 0..4 / A..E) */}
        <div className="grid grid-cols-5 gap-1.5 sm:gap-2 mb-1.5 text-center">
          {[0, 1, 2, 3, 4].map((col) => {
            const isOdd = col % 2 === 1;
            const colLetter = String.fromCharCode(65 + col);
            return (
              <div
                key={col}
                className="flex flex-col items-center justify-center text-[10px] font-bold text-slate-400 leading-tight"
              >
                <span className="text-amber-300/90">
                  Col {col} ({colLetter})
                </span>
                <span className="text-[8px] text-slate-500">
                  {isOdd ? '4 rows (+0.5↓)' : '5 rows'}
                </span>
              </div>
            );
          })}
        </div>

        {/* 5 Columns with Odd Columns Shifted Down by 0.5 * cellHeight via 50% width-ratio spacer */}
        <div className="grid grid-cols-5 gap-1.5 sm:gap-2 items-start pb-2">
          {[0, 1, 2, 3, 4].map((col) => {
            const rowCount = getColumnRowCount(col);
            const isOdd = col % 2 === 1;

            return (
              <div key={col} className="flex flex-col gap-1.5 sm:gap-2">
                {isOdd && <div className="w-full pt-[46%]" aria-hidden="true" />}
                {Array.from({ length: rowCount }, (_, row) => {
                  const cellIdx = cellToIndex(col, row);
                  const star = board[cellIdx];
                  const coordLabel = formatCellCoord(col, row);
                  const straggler = stragglerByCell.get(cellIdx);
                  const ply1Ghost = ply1GhostByCell.get(cellIdx);
                  const ply2Ghost = ply2GhostByCell.get(cellIdx);
                  const isMergedExisting = mergedExistingCells.has(cellIdx);
                  const landingOutcome = landingOutcomeByCell.get(cellIdx);
                  const altLanding = altLandingCells.get(cellIdx);
                  const neighborDir = hoveredNeighborsMap.get(cellIdx);
                  const isHovered =
                    hoveredCell?.col === col && hoveredCell?.row === row;
                  const isPopoverOpen =
                    popoverCell?.col === col && popoverCell?.row === row;

                  return (
                    <div
                      key={row}
                      onMouseDown={(e) => handleCellMouseDown(col, row, e)}
                      onMouseEnter={() => handleCellMouseEnter(col, row)}
                      className={`group relative aspect-square w-full rounded-2xl transition-all duration-150 cursor-pointer flex items-center justify-center ${
                        star === 0
                          ? 'bg-[#121521] hover:bg-[#191E2F] border-2 border-[#2A3147]'
                          : 'border-2 border-transparent'
                      } ${
                        isHovered
                          ? 'ring-2 ring-white/80 z-20 scale-[1.03]'
                          : neighborDir
                          ? 'ring-2 ring-indigo-400/90 bg-indigo-950/30 z-10'
                          : ''
                      } ${
                        straggler?.status === 'dead'
                          ? 'ring-2 ring-rose-500 animate-pulseHazard shadow-[0_0_16px_rgba(244,63,94,0.55)]'
                          : straggler?.status === 'at-risk'
                          ? 'ring-2 ring-amber-400/90'
                          : ''
                      } ${
                        isMergedExisting
                          ? 'ring-2 ring-emerald-400 shadow-[0_0_14px_rgba(52,211,153,0.45)]'
                          : ''
                      }`}
                    >
                      {/* Coordinate Label (A1..E5 & c,r) */}
                      <span
                        className={`absolute top-1 right-1.5 z-20 text-[9px] font-mono font-bold pointer-events-none ${
                          star === 0 ? 'text-slate-500' : 'text-white/75 drop-shadow'
                        }`}
                      >
                        {coordLabel}
                      </span>

                      {/* Occupied Board Tile */}
                      {star > 0 && <RelicTileVisual star={star} size="md" />}

                      {/* Empty Cell Center Crosshair */}
                      {star === 0 && !ply1Ghost && !ply2Ghost && (
                        <div className="flex flex-col items-center justify-center text-slate-600 group-hover:text-slate-400 pointer-events-none">
                          <span className="text-[10px] font-mono">
                            ({col},{row})
                          </span>
                        </div>
                      )}

                      {/* Ply-1 Ghost Tile Overlay */}
                      {ply1Ghost && (
                        <div className="absolute inset-0 z-10 p-0.5 pointer-events-none">
                          <RelicTileVisual
                            star={ply1Ghost.star}
                            size="md"
                            isGhost
                            ghostStep={1}
                          />
                          <span className="absolute -top-2 -left-1 px-1.5 py-0.5 rounded bg-amber-400 text-slate-950 font-black text-[9px] shadow">
                            T{ply1Ghost.tileIndex}
                          </span>
                        </div>
                      )}

                      {/* Ply-2 Ghost Tile Overlay */}
                      {!ply1Ghost && ply2Ghost && (
                        <div className="absolute inset-0 z-10 p-1 pointer-events-none">
                          <RelicTileVisual
                            star={ply2Ghost.star}
                            size="md"
                            isGhost
                            ghostStep={2}
                          />
                          <span className="absolute -top-2 -left-1 px-1.5 py-0.5 rounded bg-cyan-400 text-slate-950 font-black text-[9px] shadow">
                            NEXT T{ply2Ghost.tileIndex}
                          </span>
                        </div>
                      )}

                      {/* Primary Merge Landing Outcome Badge */}
                      {landingOutcome && (
                        <div className="absolute -bottom-2.5 inset-x-0 z-30 flex justify-center pointer-events-none">
                          <span className="px-1.5 py-0.5 rounded-full bg-gradient-to-r from-amber-400 to-orange-500 text-slate-950 font-black text-[9px] sm:text-[10px] shadow-lg border border-white flex items-center gap-0.5 whitespace-nowrap">
                            <Sparkles className="w-2.5 h-2.5" />
                            {landingOutcome.chainSteps.join('→')}★
                          </span>
                        </div>
                      )}

                      {/* Ambiguous Multi-Tile Merge Alternative Landing Badge */}
                      {altLanding && !landingOutcome && (
                        <div
                          className="absolute -bottom-2.5 inset-x-0 z-30 flex justify-center"
                          title="Click to test landing the merged tile on this square instead"
                        >
                          <span className="px-1.5 py-0.5 rounded-full bg-cyan-950/95 text-cyan-200 font-bold text-[9px] border border-dashed border-cyan-300 shadow">
                            ALT {altLanding.toStar}★ SPOT
                          </span>
                        </div>
                      )}

                      {/* Existing Board Cell Absorbed in Merge Badge */}
                      {isMergedExisting && (
                        <div className="absolute inset-0 z-20 rounded-xl bg-emerald-500/20 border-2 border-emerald-300 flex items-end justify-center pb-1 pointer-events-none">
                          <span className="px-1.5 py-0.2 rounded bg-emerald-950/90 text-emerald-200 font-extrabold text-[9px] border border-emerald-400/50">
                            MERGES
                          </span>
                        </div>
                      )}

                      {/* Dead Space / Straggler Hazard Badge */}
                      {straggler && !isMergedExisting && (
                        <div
                          className="absolute -top-2 left-1 z-30 pointer-events-none"
                          title={straggler.reason}
                        >
                          <span
                            className={`px-1.5 py-0.5 rounded text-[8px] sm:text-[9px] font-black uppercase tracking-tight shadow ${
                              straggler.status === 'dead'
                                ? 'bg-rose-600 text-white border border-rose-200'
                                : 'bg-amber-500 text-slate-950 border border-amber-200'
                            }`}
                          >
                            {straggler.status === 'dead' ? 'DEAD' : 'AT RISK'}
                          </span>
                        </div>
                      )}

                      {/* 6-Neighbor Direction Radar Badge on Neighboring Cells */}
                      {neighborDir && (
                        <div className="absolute -top-2 right-1 z-30 pointer-events-none">
                          <span className="px-1.5 py-0.5 rounded bg-indigo-500 text-white font-black text-[9px] shadow border border-indigo-200">
                            {neighborDir}
                          </span>
                        </div>
                      )}

                      {/* Popover Star Picker (when Click Picker mode is active) */}
                      {isPopoverOpen && (
                        <div
                          onMouseDown={(e) => e.stopPropagation()}
                          className="absolute z-50 top-full mt-1 left-1/2 -translate-x-1/2 w-48 p-2 rounded-xl bg-[#181C2B] border border-amber-400/60 shadow-2xl grid grid-cols-4 gap-1"
                        >
                          <button
                            type="button"
                            onClick={() => {
                              onSetCellStar(cellIdx, 0);
                              setPopoverCell(null);
                            }}
                            className="col-span-4 py-1 rounded bg-rose-900/50 hover:bg-rose-800 text-rose-200 text-[10px] font-bold border border-rose-600/40"
                          >
                            Clear (Empty)
                          </button>
                          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((s) => (
                            <button
                              key={s}
                              type="button"
                              onClick={() => {
                                onSetCellStar(cellIdx, s);
                                setPopoverCell(null);
                              }}
                              className="py-1 rounded text-[11px] font-black text-white hover:scale-105 transition-transform"
                              style={{
                                ...getRelicSwatchStyle(s),
                                border: `1px solid ${RELIC_SPECS[s].borderHex}`,
                              }}
                            >
                              {s}★
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* Bottom Legend & Hovered Cell Neighbor Inspector Readout */}
        <div className="mt-2 pt-2.5 border-t border-[#262D42] flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm bg-rose-600 inline-block" />
              <span>Dead Space (Retired Tier)</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm bg-amber-400 inline-block" />
              <span>At Risk ({minActiveStar}★ Window Floor)</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm bg-emerald-400 inline-block" />
              <span>Merging Group</span>
            </span>
          </div>

          {hoveredCell ? (
            <div className="text-indigo-300 font-mono text-[11px] flex items-center gap-1.5">
              <Eye className="w-3.5 h-3.5" />
              <span>
                {formatCellCoord(hoveredCell.col, hoveredCell.row)} (
                {hoveredCell.col},{hoveredCell.row}) Neighbors:{' '}
                {getDirectionalNeighbors(
                  hoveredCell.col,
                  hoveredCell.row
                )
                  .map((n) => `${n.dir}:${formatCellCoord(n.col, n.row)}`)
                  .join(' ')}
              </span>
            </div>
          ) : (
            <div className="text-slate-500 flex items-center gap-1">
              <HelpCircle className="w-3.5 h-3.5" />
              <span>Hover any cell to inspect its 6 honeycomb neighbors</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
