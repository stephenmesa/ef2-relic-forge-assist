import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  CheckCircle2,
  Film,
  Info,
  Sparkles,
  X,
} from 'lucide-react';
import { HoneycombBoard } from './components/HoneycombBoard';
import { PieceComposer } from './components/PieceComposer';
import { RecommendationsPanel } from './components/RecommendationsPanel';
import { TopProgressionHeader } from './components/TopProgressionHeader';
import { formatCellCoord, indexToCoord } from './domain/honeycomb';
import {
  buildBoardFromPreset,
  decodeStateFromHash,
  encodeStateToHash,
  PRESET_SCENARIOS,
} from './domain/presets';
import {
  analyzeBoardStragglers,
  analyzeShapeMobility,
  applyPostMergeStarAdjustment,
  countEmptyCells,
  simulatePlacement,
} from './domain/simulator';
import { solveBestMoves } from './domain/solver';
import {
  BoardMode,
  CandidateMove,
  PieceConfig,
  PlacedTile,
  PresetScenario,
} from './types/forge';

interface HistorySnapshot {
  boardMode: BoardMode;
  board: Uint8Array;
  manualMaxStar: number | null;
  currentPiece: PieceConfig;
  nextPiece: PieceConfig;
  nextPieceKnown: boolean;
  activePresetId: string | null;
}

interface LastMergeMoveContext {
  preMoveBoard: Uint8Array;
  preMoveMaxStar: number;
  placedTiles: PlacedTile[];
  primaryLandingCell: number;
  alternativeLandingCell: number | null;
  currentLandingCell: number;
  mergedStar: number;
}

export const App: React.FC = () => {
  // Default to Scenario 2 (00:13 Double Cascade) or URL hash if present
  const initialPreset = PRESET_SCENARIOS[1];

  const [boardMode, setBoardMode] = useState<BoardMode>(initialPreset.boardMode);
  const [fiveTileSuperMerge, setFiveTileSuperMerge] = useState<boolean>(true);
  const [board, setBoard] = useState<Uint8Array>(() =>
    buildBoardFromPreset(initialPreset)
  );
  const [manualMaxStar, setManualMaxStar] = useState<number | null>(null);
  const [currentPiece, setCurrentPiece] = useState<PieceConfig>(
    initialPreset.currentPiece
  );
  const [nextPiece, setNextPiece] = useState<PieceConfig>(
    initialPreset.nextPiece
  );
  const [nextPieceKnown, setNextPieceKnown] = useState<boolean>(
    initialPreset.nextPieceKnown
  );
  const [activePresetId, setActivePresetId] = useState<string | null>(
    initialPreset.id
  );

  // Paint brush state (0 = eraser, 1..10 = relic star, 'inspect' | 'popover')
  const [activeBrush, setActiveBrush] = useState<number | 'inspect' | 'popover'>(
    2
  );

  // Undo / Redo stacks (up to 50 states)
  const [undoStack, setUndoStack] = useState<HistorySnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<HistorySnapshot[]>([]);

  // Selected / Hovered Recommendation for Board Ghost Overlay
  const [selectedMoveId, setSelectedMoveId] = useState<string | null>(null);
  const [hoveredMoveId, setHoveredMoveId] = useState<string | null>(null);
  const [showPly2Ghost, setShowPly2Ghost] = useState<boolean>(true);

  // Per-move landing overrides when user swaps an ambiguous multi-tile merge landing cell
  const [landingOverrides, setLandingOverrides] = useState<
    Record<string, number>
  >({});

  // Post-Move Merge Adjustment Toast (Lucky +1★ Evolution & Ambiguous Landing Swap)
  const [lastAmbiguousContext, setLastAmbiguousContext] =
    useState<LastMergeMoveContext | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Load state from URL hash on mount if present
  useEffect(() => {
    if (window.location.hash.length > 1) {
      const decoded = decodeStateFromHash(window.location.hash);
      if (decoded) {
        setBoardMode(decoded.boardMode);
        setBoard(decoded.board);
        setManualMaxStar(decoded.maxUnlockedStar);
        setCurrentPiece(decoded.currentPiece);
        setNextPiece(decoded.nextPiece);
        setNextPieceKnown(decoded.nextPieceKnown);
        setActivePresetId(null);
      }
    }
  }, []);

  // Auto-detect Highest Unlocked Star Level (M)
  const autoDetectedMaxStar = useMemo(() => {
    let maxVal = 4;
    for (let i = 0; i < board.length; i++) {
      if (board[i] > maxVal) maxVal = board[i];
    }
    for (const s of currentPiece.tileStars) {
      if (s > maxVal) maxVal = s;
    }
    if (nextPieceKnown) {
      for (const s of nextPiece.tileStars) {
        if (s > maxVal) maxVal = s;
      }
    }
    return maxVal;
  }, [board, currentPiece.tileStars, nextPiece.tileStars, nextPieceKnown]);

  const effectiveMaxStar = useMemo(() => {
    if (manualMaxStar !== null) {
      return Math.max(manualMaxStar, autoDetectedMaxStar);
    }
    return autoDetectedMaxStar;
  }, [manualMaxStar, autoDetectedMaxStar]);

  const pushHistory = useCallback(() => {
    setUndoStack((prev) => {
      const snapshot: HistorySnapshot = {
        boardMode,
        board: new Uint8Array(board),
        manualMaxStar,
        currentPiece: {
          ...currentPiece,
          tileStars: [...currentPiece.tileStars],
        },
        nextPiece: {
          ...nextPiece,
          tileStars: [...nextPiece.tileStars],
        },
        nextPieceKnown,
        activePresetId,
      };
      return [...prev.slice(-49), snapshot];
    });
    setRedoStack([]);
  }, [
    boardMode,
    board,
    manualMaxStar,
    currentPiece,
    nextPiece,
    nextPieceKnown,
    activePresetId,
  ]);

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    const last = undoStack[undoStack.length - 1];
    const currentSnapshot: HistorySnapshot = {
      boardMode,
      board: new Uint8Array(board),
      manualMaxStar,
      currentPiece: { ...currentPiece, tileStars: [...currentPiece.tileStars] },
      nextPiece: { ...nextPiece, tileStars: [...nextPiece.tileStars] },
      nextPieceKnown,
      activePresetId,
    };
    setRedoStack((prev) => [...prev, currentSnapshot]);
    setUndoStack((prev) => prev.slice(0, -1));

    setBoardMode(last.boardMode);
    setBoard(last.board);
    setManualMaxStar(last.manualMaxStar);
    setCurrentPiece(last.currentPiece);
    setNextPiece(last.nextPiece);
    setNextPieceKnown(last.nextPieceKnown);
    setActivePresetId(last.activePresetId);
    setLastAmbiguousContext(null);
  }, [
    undoStack,
    boardMode,
    board,
    manualMaxStar,
    currentPiece,
    nextPiece,
    nextPieceKnown,
    activePresetId,
  ]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    const nextSnap = redoStack[redoStack.length - 1];
    const currentSnapshot: HistorySnapshot = {
      boardMode,
      board: new Uint8Array(board),
      manualMaxStar,
      currentPiece: { ...currentPiece, tileStars: [...currentPiece.tileStars] },
      nextPiece: { ...nextPiece, tileStars: [...nextPiece.tileStars] },
      nextPieceKnown,
      activePresetId,
    };
    setUndoStack((prev) => [...prev, currentSnapshot]);
    setRedoStack((prev) => prev.slice(0, -1));

    setBoardMode(nextSnap.boardMode);
    setBoard(nextSnap.board);
    setManualMaxStar(nextSnap.manualMaxStar);
    setCurrentPiece(nextSnap.currentPiece);
    setNextPiece(nextSnap.nextPiece);
    setNextPieceKnown(nextSnap.nextPieceKnown);
    setActivePresetId(nextSnap.activePresetId);
    setLastAmbiguousContext(null);
  }, [
    redoStack,
    boardMode,
    board,
    manualMaxStar,
    currentPiece,
    nextPiece,
    nextPieceKnown,
    activePresetId,
  ]);

  // Set individual board cell star level
  const handleSetCellStar = useCallback(
    (cellIndex: number, star: number) => {
      if (board[cellIndex] === star) return;
      pushHistory();
      setBoard((prev) => {
        const next = new Uint8Array(prev);
        next[cellIndex] = star;
        return next;
      });
      setLastAmbiguousContext(null);
    },
    [board, pushHistory]
  );

  // Clear Board / Reset Run
  const handleClearBoard = useCallback(() => {
    pushHistory();
    setBoard(new Uint8Array(25));
    setManualMaxStar(null);
    setActivePresetId(null);
    setSelectedMoveId(null);
    setLastAmbiguousContext(null);
    setToastMessage('Board cleared — reset to fresh 4★ run.');
    setTimeout(() => setToastMessage(null), 3000);
  }, [pushHistory]);

  // Load Preset Scenario
  const handleLoadPreset = useCallback(
    (preset: PresetScenario) => {
      pushHistory();
      setBoardMode(preset.boardMode);
      setBoard(buildBoardFromPreset(preset));
      setManualMaxStar(null);
      setCurrentPiece({
        ...preset.currentPiece,
        tileStars: [...preset.currentPiece.tileStars],
      });
      setNextPiece({
        ...preset.nextPiece,
        tileStars: [...preset.nextPiece.tileStars],
      });
      setNextPieceKnown(preset.nextPieceKnown);
      setActivePresetId(preset.id);
      setSelectedMoveId(null);
      setLandingOverrides({});
      setLastAmbiguousContext(null);
    },
    [pushHistory]
  );

  // Share State via URL Hash & Clipboard
  const handleShareState = useCallback(() => {
    const hash = encodeStateToHash({
      boardMode,
      maxUnlockedStar: effectiveMaxStar,
      board,
      currentPiece,
      nextPiece,
      nextPieceKnown,
    });
    window.history.replaceState(null, '', `#${hash}`);
    if (navigator.clipboard) {
      navigator.clipboard.writeText(window.location.href).catch(() => {});
    }
    setToastMessage('Shareable board state URL copied to clipboard & address bar!');
    setTimeout(() => setToastMessage(null), 3500);
  }, [
    boardMode,
    effectiveMaxStar,
    board,
    currentPiece,
    nextPiece,
    nextPieceKnown,
  ]);

  // Compute Live Board Health KPIs
  const emptyCellsCount = useMemo(
    () => countEmptyCells(board, boardMode),
    [board, boardMode]
  );
  const totalPlayableCells = boardMode === '23-cell' ? 23 : 25;

  const stragglers = useMemo(() => {
    const queueStars = [
      ...currentPiece.tileStars,
      ...(nextPieceKnown ? nextPiece.tileStars : []),
    ];
    return analyzeBoardStragglers(
      board,
      effectiveMaxStar,
      boardMode,
      queueStars
    );
  }, [
    board,
    effectiveMaxStar,
    boardMode,
    currentPiece.tileStars,
    nextPiece.tileStars,
    nextPieceKnown,
  ]);

  const shapeMobility = useMemo(
    () => analyzeShapeMobility(board, boardMode),
    [board, boardMode]
  );

  // Run 2-Ply Solver
  const solverResult = useMemo(() => {
    return solveBestMoves(
      board,
      effectiveMaxStar,
      currentPiece,
      nextPiece,
      nextPieceKnown,
      boardMode,
      landingOverrides,
      fiveTileSuperMerge
    );
  }, [
    board,
    effectiveMaxStar,
    currentPiece,
    nextPiece,
    nextPieceKnown,
    boardMode,
    landingOverrides,
    fiveTileSuperMerge,
  ]);

  // Determine which move is currently previewed on the Honeycomb Board
  // Defaults to #1 Best Move when no move is explicitly locked or hovered!
  const activePreviewMove = useMemo(() => {
    if (hoveredMoveId) {
      const found = solverResult.candidates.find((c) => c.id === hoveredMoveId);
      if (found) return { move: found, rank: solverResult.topRecommendations.findIndex((t) => t.id === found.id) + 1 || null };
    }
    if (selectedMoveId) {
      const found = solverResult.candidates.find((c) => c.id === selectedMoveId);
      if (found) return { move: found, rank: solverResult.topRecommendations.findIndex((t) => t.id === found.id) + 1 || null };
    }
    if (solverResult.topRecommendations.length > 0) {
      return { move: solverResult.topRecommendations[0], rank: 1 };
    }
    return { move: null, rank: null };
  }, [hoveredMoveId, selectedMoveId, solverResult]);

  // Swap Ambiguous Multi-Tile Merge Landing Spot (Before or After Applying Move)
  const handleSwapAmbiguousLanding = useCallback(
    (moveId: string, newLandingCell: number) => {
      setLandingOverrides((prev) => ({
        ...prev,
        [moveId]: newLandingCell,
      }));
    },
    []
  );

  // Apply Recommended Move (Ply 1 Only — Play-Along Loop)
  const handleApplyPly1Move = useCallback(
    (move: CandidateMove) => {
      pushHistory();

      if (move.ply1Sim.merges.length > 0) {
        const lastMerge = move.ply1Sim.merges[move.ply1Sim.merges.length - 1];
        const amb = move.ply1Sim.ambiguousMerges[0];
        setLastAmbiguousContext({
          preMoveBoard: new Uint8Array(board),
          preMoveMaxStar: effectiveMaxStar,
          placedTiles: move.placedTiles,
          primaryLandingCell: lastMerge.landingCell,
          alternativeLandingCell: amb ? amb.alternativeCells[0] : null,
          currentLandingCell: lastMerge.landingCell,
          mergedStar: move.ply1Sim.nextBoard[lastMerge.landingCell],
        });
      } else {
        setLastAmbiguousContext(null);
      }

      setBoard(move.ply1Sim.nextBoard);
      if (manualMaxStar !== null && move.ply1Sim.nextMaxStar > manualMaxStar) {
        setManualMaxStar(move.ply1Sim.nextMaxStar);
      }

      // Promote Next Piece -> Current Piece
      if (nextPieceKnown) {
        setCurrentPiece({
          shapeId: nextPiece.shapeId,
          rotation: nextPiece.rotation,
          tileStars: [...nextPiece.tileStars],
        });
      }
      setSelectedMoveId(null);
      setHoveredMoveId(null);
    },
    [pushHistory, board, effectiveMaxStar, nextPieceKnown, nextPiece]
  );

  // Apply Both Moves (Ply 1 + Best Ply 2)
  const handleApplyBothMoves = useCallback(
    (move: CandidateMove) => {
      if (!move.bestPly2) {
        handleApplyPly1Move(move);
        return;
      }
      pushHistory();
      setBoard(move.bestPly2.sim.nextBoard);
      if (
        manualMaxStar !== null &&
        move.bestPly2.sim.nextMaxStar > manualMaxStar
      ) {
        setManualMaxStar(move.bestPly2.sim.nextMaxStar);
      }
      setSelectedMoveId(null);
      setHoveredMoveId(null);
      setLastAmbiguousContext(null);
      setToastMessage(
        'Executed both Current Piece & Next Piece! Enter your new pieces below.'
      );
      setTimeout(() => setToastMessage(null), 3500);
    },
    [handleApplyPly1Move, pushHistory]
  );

  // Swap Landing Spot from the Post-Move Toast (Section 2.5.3.2)
  const handlePostMoveSwapLanding = useCallback(() => {
    if (
      !lastAmbiguousContext ||
      lastAmbiguousContext.alternativeLandingCell === null
    ) {
      return;
    }
    const nextTarget =
      lastAmbiguousContext.currentLandingCell ===
      lastAmbiguousContext.primaryLandingCell
        ? lastAmbiguousContext.alternativeLandingCell
        : lastAmbiguousContext.primaryLandingCell;

    const reSim = simulatePlacement(
      lastAmbiguousContext.preMoveBoard,
      lastAmbiguousContext.preMoveMaxStar,
      lastAmbiguousContext.placedTiles,
      boardMode,
      nextTarget,
      fiveTileSuperMerge
    );

    setBoard(reSim.nextBoard);
    if (manualMaxStar !== null && reSim.nextMaxStar > manualMaxStar) {
      setManualMaxStar(reSim.nextMaxStar);
    }
    setLastAmbiguousContext({
      ...lastAmbiguousContext,
      currentLandingCell: nextTarget,
      mergedStar: reSim.nextBoard[nextTarget],
    });
  }, [lastAmbiguousContext, boardMode, fiveTileSuperMerge, manualMaxStar]);

  // Apply +1★ Lucky Evolution (or -1★ Step Down) on the merged landing cell
  const handlePostMoveStarAdjust = useCallback(
    (delta: 1 | -1) => {
      if (!lastAmbiguousContext) return;
      const res = applyPostMergeStarAdjustment(
        board,
        effectiveMaxStar,
        lastAmbiguousContext.currentLandingCell,
        delta,
        boardMode
      );
      setBoard(res.nextBoard);
      if (manualMaxStar !== null && res.nextMaxStar > manualMaxStar) {
        setManualMaxStar(res.nextMaxStar);
      }
      setLastAmbiguousContext({
        ...lastAmbiguousContext,
        mergedStar: res.finalStar,
      });
    },
    [lastAmbiguousContext, board, effectiveMaxStar, boardMode, manualMaxStar]
  );

  const activePreset = useMemo(
    () => PRESET_SCENARIOS.find((p) => p.id === activePresetId) || null,
    [activePresetId]
  );

  return (
    <div className="min-h-screen bg-[#0B0C10] text-slate-100 flex flex-col">
      {/* Top Header & 10-Slot Relic Progression Bar */}
      <TopProgressionHeader
        boardMode={boardMode}
        onToggleBoardMode={(mode) => {
          pushHistory();
          setBoardMode(mode);
        }}
        fiveTileSuperMerge={fiveTileSuperMerge}
        onToggleFiveTileSuperMerge={setFiveTileSuperMerge}
        maxUnlockedStar={effectiveMaxStar}
        isManualMaxStar={manualMaxStar !== null}
        onSelectMaxStar={(star) => {
          pushHistory();
          setManualMaxStar(star);
        }}
        onResetAutoMaxStar={() => setManualMaxStar(null)}
        board={board}
        emptyCellsCount={emptyCellsCount}
        totalPlayableCells={totalPlayableCells}
        stragglers={stragglers}
        threeTileMobility={shapeMobility.totalThreeTileSlots}
        triangleMobility={shapeMobility.compact3TriangleSlots}
        canUndo={undoStack.length > 0}
        canRedo={redoStack.length > 0}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onClearBoard={handleClearBoard}
        onLoadPreset={handleLoadPreset}
        onShareState={handleShareState}
        activePresetId={activePresetId}
      />

      {/* Toast Notification / Post-Move Merge Adjustment Banner */}
      {(toastMessage || lastAmbiguousContext) && (
        <div className="max-w-[1600px] w-full mx-auto px-3 sm:px-6 pt-3">
          {lastAmbiguousContext && (
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 rounded-xl bg-cyan-950/80 border border-cyan-400/70 text-xs text-cyan-100 shadow-lg">
              <div className="flex items-center gap-2">
                <Info className="w-4 h-4 text-cyan-300 shrink-0" />
                <span>
                  <strong>Merge Applied:</strong> Upgraded{' '}
                  <strong>{lastAmbiguousContext.mergedStar}★</strong> spawned at{' '}
                  <strong>
                    {(() => {
                      const { col, row } = indexToCoord(
                        lastAmbiguousContext.currentLandingCell
                      );
                      return formatCellCoord(col, row);
                    })()}
                  </strong>
                  . Did it proc a +2★ evolution or land on another square?
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {lastAmbiguousContext.mergedStar < 10 && (
                  <button
                    type="button"
                    onClick={() => handlePostMoveStarAdjust(1)}
                    className="px-2.5 py-1 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 font-black flex items-center gap-1 shadow transition-all"
                    title="Click if the merge evolved +1 extra star in-game (e.g. 1★ → 3★)"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>
                      +1★ Lucky Evolution (→{' '}
                      {lastAmbiguousContext.mergedStar + 1}★)
                    </span>
                  </button>
                )}

                {lastAmbiguousContext.mergedStar > 1 && (
                  <button
                    type="button"
                    onClick={() => handlePostMoveStarAdjust(-1)}
                    className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold border border-slate-600 transition-all"
                    title="Step down by 1★ if needed"
                  >
                    −1★ (→ {lastAmbiguousContext.mergedStar - 1}★)
                  </button>
                )}

                {lastAmbiguousContext.alternativeLandingCell !== null && (
                  <button
                    type="button"
                    onClick={handlePostMoveSwapLanding}
                    className="px-3 py-1 rounded-lg bg-cyan-400 hover:bg-cyan-300 text-slate-950 font-black flex items-center gap-1.5 shadow transition-all"
                  >
                    <ArrowLeftRight className="w-3.5 h-3.5" />
                    <span>
                      Swap Landing Spot to{' '}
                      {(() => {
                        const target =
                          lastAmbiguousContext.currentLandingCell ===
                          lastAmbiguousContext.primaryLandingCell
                            ? lastAmbiguousContext.alternativeLandingCell!
                            : lastAmbiguousContext.primaryLandingCell;
                        const { col, row } = indexToCoord(target);
                        return formatCellCoord(col, row);
                      })()}
                    </span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setLastAmbiguousContext(null)}
                  className="p-1 text-cyan-300 hover:text-white"
                  title="Dismiss"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {toastMessage && (
            <div className="mt-2 flex items-center justify-between gap-2 px-4 py-2 rounded-xl bg-emerald-950/80 border border-emerald-400/60 text-xs text-emerald-100 shadow-lg">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span className="font-semibold">{toastMessage}</span>
              </div>
              <button
                type="button"
                onClick={() => setToastMessage(null)}
                className="p-1 text-emerald-300 hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Active Preset Scenario Context Banner */}
      {activePreset && (
        <div className="max-w-[1600px] w-full mx-auto px-3 sm:px-6 pt-3">
          <div className="bg-gradient-to-r from-[#171C2B] via-[#1B2135] to-[#151926] border border-amber-500/35 rounded-xl px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-start sm:items-center gap-2.5">
              <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-400/40 font-mono font-bold flex items-center gap-1 shrink-0">
                <Film className="w-3.5 h-3.5" />
                {activePreset.videoTimestamp}
              </span>
              <div>
                <span className="font-bold text-amber-200 mr-2">
                  {activePreset.title}:
                </span>
                <span className="text-slate-300">{activePreset.description}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setActivePresetId(null)}
              className="text-slate-400 hover:text-white text-[11px] font-medium shrink-0"
            >
              Dismiss Guide
            </button>
          </div>
        </div>
      )}

      {/* Main Single-View Tactical Dashboard Workspace:
          Left/Center has Board + Piece Queue Side-by-Side; Right has Recommendations */}
      <main className="max-w-[1680px] w-full mx-auto px-3 sm:px-5 py-3 flex-1 grid grid-cols-1 lg:grid-cols-12 gap-3.5 items-start">
        {/* Left & Center Area (7 cols on lg): Honeycomb Board + Piece Queue Side-by-Side */}
        <div className="lg:col-span-7 grid grid-cols-1 md:grid-cols-12 gap-3 items-start">
          {/* Honeycomb Board (7 of 12 cols on md+) */}
          <div className="md:col-span-7">
            <HoneycombBoard
              board={board}
              boardMode={boardMode}
              maxUnlockedStar={effectiveMaxStar}
              stragglers={stragglers}
              activeBrush={activeBrush}
              onChangeBrush={setActiveBrush}
              onSetCellStar={handleSetCellStar}
              previewMove={activePreviewMove.move}
              previewRank={activePreviewMove.rank}
              showPly2Ghost={showPly2Ghost}
              onToggleShowPly2Ghost={() => setShowPly2Ghost((v) => !v)}
              onSelectAlternateLanding={handleSwapAmbiguousLanding}
            />
          </div>

          {/* Piece Queue Composer (5 of 12 cols on md+, directly to the right of the Board!) */}
          <div className="md:col-span-5">
            <PieceComposer
              currentPiece={currentPiece}
              onChangeCurrentPiece={(next) => {
                pushHistory();
                setCurrentPiece(next);
              }}
              nextPiece={nextPiece}
              onChangeNextPiece={(next) => {
                pushHistory();
                setNextPiece(next);
              }}
              nextPieceKnown={nextPieceKnown}
              onToggleNextPieceKnown={(known) => {
                pushHistory();
                setNextPieceKnown(known);
              }}
              maxUnlockedStar={effectiveMaxStar}
            />
          </div>
        </div>

        {/* Right Column (5 cols on lg): Ranked Advisor Recommendations Panel */}
        <div className="lg:col-span-5 lg:sticky lg:top-3">
          <RecommendationsPanel
            currentPiece={currentPiece}
            nextPiece={nextPiece}
            nextPieceKnown={nextPieceKnown}
            topRecommendations={solverResult.topRecommendations}
            allCandidates={solverResult.candidates}
            lethalMoves={solverResult.lethalMoves}
            elapsedMs={solverResult.elapsedMs}
            selectedMoveId={selectedMoveId}
            hoveredMoveId={hoveredMoveId}
            onSelectMove={setSelectedMoveId}
            onHoverMove={setHoveredMoveId}
            onApplyPly1Move={handleApplyPly1Move}
            onApplyBothMoves={handleApplyBothMoves}
            onSwapAmbiguousLanding={handleSwapAmbiguousLanding}
          />
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-[#1E2334] bg-[#0D0F16] py-3 px-6 text-center text-xs text-slate-500">
        <div className="max-w-[1600px] mx-auto flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>
              EF2 Relic Forge Advisor • Authentic 5-4-5-4-5 Staggered Honeycomb & 2-Ply Cascade Solver
            </span>
          </span>
          <span>
            Active Spawn Pool Rule: [max(1, M−3) .. M] • 60° Cube Rotation Engine
          </span>
        </div>
      </footer>
    </div>
  );
};

export default App;
