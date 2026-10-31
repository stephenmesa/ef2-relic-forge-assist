import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Film,
  Sparkles,
  X,
} from 'lucide-react';
import { HoneycombBoard } from './components/HoneycombBoard';
import { PieceComposer } from './components/PieceComposer';
import { RecommendationsPanel } from './components/RecommendationsPanel';
import { TopProgressionHeader } from './components/TopProgressionHeader';
import { EvalRunnerModal } from './components/EvalRunnerModal';
import {
  DEFAULT_STRATEGY_ID,
  INITIAL_HAMMERS,
  MAX_HAMMERS,
  MAX_RUN_PLACEMENTS,
} from './domain/constants';
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
  countEmptyCells,
  simulateStarUpgrade,
} from './domain/simulator';
import {
  evaluateHammerAdvice,
  evaluateStarAdvice,
  solveBestMoves,
} from './domain/solver';
import {
  CandidateMove,
  PieceConfig,
  PresetScenario,
  SolverStrategyId,
} from './types/forge';

interface HistorySnapshot {
  board: Uint8Array;
  manualMaxStar: number | null;
  currentPiece: PieceConfig;
  nextPiece: PieceConfig;
  nextPieceKnown: boolean;
  hammerCount: number;
  starAvailable: boolean;
  placementsMade: number;
  tenStarsAchieved: number;
  activePresetId: string | null;
}

const DEFAULT_CURRENT_PIECE: PieceConfig = {
  shapeId: 'pair',
  rotation: 0,
  tileStars: [1, 2],
  anchorTileIndex: 0,
};

const DEFAULT_NEXT_PIECE: PieceConfig = {
  shapeId: 'bent3',
  rotation: 0,
  tileStars: [1, 2, 2],
  anchorTileIndex: 0,
};

export const App: React.FC = () => {
  const [viewMode, setViewMode] = useState<'simple' | 'advanced'>('simple');
  const [hammerCount, setHammerCount] = useState<number>(INITIAL_HAMMERS);
  const [hoveredHammerTarget, setHoveredHammerTarget] = useState<number | null>(
    null
  );
  const [starAvailable, setStarAvailable] = useState<boolean>(true);
  const [hoveredStarTarget, setHoveredStarTarget] = useState<number | null>(
    null
  );
  const [placementsMade, setPlacementsMade] = useState<number>(0);
  const [tenStarsAchieved, setTenStarsAchieved] = useState<number>(0);
  const [board, setBoard] = useState<Uint8Array>(() => new Uint8Array(25));
  const [manualMaxStar, setManualMaxStar] = useState<number | null>(null);
  const [currentPiece, setCurrentPiece] =
    useState<PieceConfig>(DEFAULT_CURRENT_PIECE);
  const [nextPiece, setNextPiece] = useState<PieceConfig>(DEFAULT_NEXT_PIECE);
  const [nextPieceKnown, setNextPieceKnown] = useState<boolean>(true);
  const [activePresetId, setActivePresetId] = useState<string | null>(null);

  // Paint brush state (0 = eraser, 1..9 = relic star, 'inspect' | 'popover' | 'hammer' | 'star')
  const [activeBrush, setActiveBrush] = useState<
    number | 'inspect' | 'popover' | 'hammer' | 'star'
  >(1);

  // Undo / Redo stacks (up to 50 states)
  const [undoStack, setUndoStack] = useState<HistorySnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<HistorySnapshot[]>([]);

  // Selected / Hovered Recommendation for Board Ghost Overlay
  const [selectedMoveId, setSelectedMoveId] = useState<string | null>(null);
  const [hoveredMoveId, setHoveredMoveId] = useState<string | null>(null);
  const [showPly2Ghost, setShowPly2Ghost] = useState<boolean>(true);
  const [blueprintMode, setBlueprintMode] = useState<boolean>(false);
  const [strategyId, setStrategyId] = useState<SolverStrategyId>(DEFAULT_STRATEGY_ID);
  const [isEvalModalOpen, setIsEvalModalOpen] = useState<boolean>(false);

  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Load state from URL hash on mount if present
  useEffect(() => {
    if (window.location.hash.length > 1) {
      const decoded = decodeStateFromHash(window.location.hash);
      if (decoded) {
        setBoard(decoded.board);
        setManualMaxStar(decoded.maxUnlockedStar);
        setCurrentPiece(decoded.currentPiece);
        setNextPiece(decoded.nextPiece);
        setNextPieceKnown(decoded.nextPieceKnown);
        setHammerCount(decoded.hammerCount);
        setStarAvailable(decoded.starAvailable);
        setPlacementsMade(decoded.placementsMade);
        setTenStarsAchieved(decoded.tenStarsAchieved);
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
    if (tenStarsAchieved > 0) {
      maxVal = 10;
    }
    return maxVal;
  }, [
    board,
    currentPiece.tileStars,
    nextPiece.tileStars,
    nextPieceKnown,
    tenStarsAchieved,
  ]);

  const effectiveMaxStar = useMemo(() => {
    if (manualMaxStar !== null) {
      return Math.max(manualMaxStar, autoDetectedMaxStar);
    }
    return autoDetectedMaxStar;
  }, [manualMaxStar, autoDetectedMaxStar]);

  const pushHistory = useCallback(() => {
    setUndoStack((prev) => {
      const snapshot: HistorySnapshot = {
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
        hammerCount,
        starAvailable,
        placementsMade,
        tenStarsAchieved,
        activePresetId,
      };
      return [...prev.slice(-49), snapshot];
    });
    setRedoStack([]);
  }, [
    board,
    manualMaxStar,
    currentPiece,
    nextPiece,
    nextPieceKnown,
    hammerCount,
    starAvailable,
    placementsMade,
    tenStarsAchieved,
    activePresetId,
  ]);

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    const last = undoStack[undoStack.length - 1];
    const currentSnapshot: HistorySnapshot = {
      board: new Uint8Array(board),
      manualMaxStar,
      currentPiece: { ...currentPiece, tileStars: [...currentPiece.tileStars] },
      nextPiece: { ...nextPiece, tileStars: [...nextPiece.tileStars] },
      nextPieceKnown,
      hammerCount,
      starAvailable,
      placementsMade,
      tenStarsAchieved,
      activePresetId,
    };
    setRedoStack((prev) => [...prev, currentSnapshot]);
    setUndoStack((prev) => prev.slice(0, -1));

    setBoard(last.board);
    setManualMaxStar(last.manualMaxStar);
    setCurrentPiece(last.currentPiece);
    setNextPiece(last.nextPiece);
    setNextPieceKnown(last.nextPieceKnown);
    setHammerCount(last.hammerCount);
    setStarAvailable(last.starAvailable);
    setPlacementsMade(last.placementsMade);
    setTenStarsAchieved(last.tenStarsAchieved);
    setActivePresetId(last.activePresetId);
  }, [
    undoStack,
    board,
    manualMaxStar,
    currentPiece,
    nextPiece,
    nextPieceKnown,
    hammerCount,
    starAvailable,
    placementsMade,
    tenStarsAchieved,
    activePresetId,
  ]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    const nextSnap = redoStack[redoStack.length - 1];
    const currentSnapshot: HistorySnapshot = {
      board: new Uint8Array(board),
      manualMaxStar,
      currentPiece: { ...currentPiece, tileStars: [...currentPiece.tileStars] },
      nextPiece: { ...nextPiece, tileStars: [...nextPiece.tileStars] },
      nextPieceKnown,
      hammerCount,
      starAvailable,
      placementsMade,
      tenStarsAchieved,
      activePresetId,
    };
    setUndoStack((prev) => [...prev, currentSnapshot]);
    setRedoStack((prev) => prev.slice(0, -1));

    setBoard(nextSnap.board);
    setManualMaxStar(nextSnap.manualMaxStar);
    setCurrentPiece(nextSnap.currentPiece);
    setNextPiece(nextSnap.nextPiece);
    setNextPieceKnown(nextSnap.nextPieceKnown);
    setHammerCount(nextSnap.hammerCount);
    setStarAvailable(nextSnap.starAvailable);
    setPlacementsMade(nextSnap.placementsMade);
    setTenStarsAchieved(nextSnap.tenStarsAchieved);
    setActivePresetId(nextSnap.activePresetId);
  }, [
    redoStack,
    board,
    manualMaxStar,
    currentPiece,
    nextPiece,
    nextPieceKnown,
    hammerCount,
    starAvailable,
    placementsMade,
    tenStarsAchieved,
    activePresetId,
  ]);

  // Set individual board cell star level (10★ relics disappear from the board and are marked as achieved)
  const handleSetCellStar = useCallback(
    (cellIndex: number, star: number) => {
      if (star >= 10) {
        pushHistory();
        setManualMaxStar(10);
        setTenStarsAchieved((prev) => Math.max(1, prev));
        if (board[cellIndex] !== 0) {
          setBoard((prev) => {
            const next = new Uint8Array(prev);
            next[cellIndex] = 0;
            return next;
          });
        }
        return;
      }
      if (board[cellIndex] === star) return;
      pushHistory();
      setBoard((prev) => {
        const next = new Uint8Array(prev);
        next[cellIndex] = star;
        return next;
      });
    },
    [board, pushHistory]
  );

  // Use a Run Hammer on a board cell (decrements hammerCount by 1)
  const handleUseHammer = useCallback(
    (cellIndex: number) => {
      const targetStar = board[cellIndex];
      if (hammerCount <= 0 || targetStar === 0) return;
      pushHistory();
      const nextCount = Math.max(0, hammerCount - 1);
      setBoard((prev) => {
        const next = new Uint8Array(prev);
        next[cellIndex] = 0;
        return next;
      });
      setHammerCount(nextCount);
      setHoveredHammerTarget(null);
      if (nextCount === 0 && activeBrush === 'hammer') {
        setActiveBrush(1);
      }
      const { col, row } = indexToCoord(cellIndex);
      setToastMessage(
        `🔨 Smashed ${formatCellCoord(col, row)} (${targetStar}★) — ${nextCount}/${MAX_HAMMERS} Hammer(s) remaining.`
      );
      setTimeout(() => setToastMessage(null), 3500);
    },
    [board, hammerCount, pushHistory, activeBrush]
  );

  // Use the 1× Run Star on a board cell (raises 1★..8★ relic by +1 grade and triggers same merging rules)
  const handleUseStar = useCallback(
    (cellIndex: number) => {
      const targetStar = board[cellIndex];
      if (!starAvailable || targetStar === 0) return;
      const { col, row } = indexToCoord(cellIndex);
      const coordLabel = formatCellCoord(col, row);
      if (targetStar >= 9) {
        setToastMessage(
          `⭐ Cannot use Star on ${coordLabel} (9★) — the Star only raises 1★–8★ relics by +1 grade!`
        );
        setTimeout(() => setToastMessage(null), 3500);
        return;
      }
      const sim = simulateStarUpgrade(board, effectiveMaxStar, cellIndex);
      if (!sim) return;

      pushHistory();
      setBoard(sim.nextBoard);
      if (sim.nextMaxStar > effectiveMaxStar) {
        setManualMaxStar(sim.nextMaxStar);
      }
      if (sim.tenStarsCreated > 0) {
        setTenStarsAchieved((prev) => prev + sim.tenStarsCreated);
        setManualMaxStar(10);
      }
      const nextHammers = Math.min(MAX_HAMMERS, hammerCount + sim.hammersEarned);
      if (sim.hammersEarned > 0) {
        setHammerCount(nextHammers);
      }
      setStarAvailable(false);
      setHoveredStarTarget(null);
      if (activeBrush === 'star') {
        setActiveBrush(1);
      }

      const mergeMsg =
        sim.merges.length > 0
          ? ` ⇒ Merged ${sim.merges.map((m) => `${m.fromStar}★→${m.toStar}★`).join(' → ')}${
              sim.tenStarsCreated > 0 ? ' (10★ Achieved & Cleared!)' : ''
            }`
          : '';
      const hammerMsg =
        sim.hammersEarned > 0
          ? ` (+1 Hammer → ${nextHammers}/${MAX_HAMMERS})`
          : '';
      setToastMessage(
        `⭐ Upgraded ${coordLabel} (${targetStar}★ → ${targetStar + 1}★)${mergeMsg}${hammerMsg}!`
      );
      setTimeout(() => setToastMessage(null), 4000);
    },
    [board, starAvailable, effectiveMaxStar, pushHistory, hammerCount, activeBrush]
  );

  // Clear Board / Reset Run
  const handleClearBoard = useCallback(() => {
    pushHistory();
    setBoard(new Uint8Array(25));
    setManualMaxStar(null);
    setCurrentPiece(DEFAULT_CURRENT_PIECE);
    setNextPiece(DEFAULT_NEXT_PIECE);
    setNextPieceKnown(true);
    setHammerCount(INITIAL_HAMMERS);
    setStarAvailable(true);
    setPlacementsMade(0);
    setTenStarsAchieved(0);
    setActivePresetId(null);
    setSelectedMoveId(null);
    setToastMessage(
      `Board cleared — reset to fresh run (1/${MAX_HAMMERS} Hammer & 1× Star restored, 0/${MAX_RUN_PLACEMENTS} moves).`
    );
    setTimeout(() => setToastMessage(null), 3000);
  }, [pushHistory]);

  // Load Preset Scenario
  const handleLoadPreset = useCallback(
    (preset: PresetScenario) => {
      pushHistory();
      setBoard(buildBoardFromPreset(preset));
      setManualMaxStar(null);
      setCurrentPiece({
        ...preset.currentPiece,
        tileStars: [...preset.currentPiece.tileStars],
        anchorTileIndex: preset.currentPiece.anchorTileIndex ?? 0,
      });
      setNextPiece({
        ...preset.nextPiece,
        tileStars: [...preset.nextPiece.tileStars],
        anchorTileIndex: preset.nextPiece.anchorTileIndex ?? 0,
      });
      setNextPieceKnown(preset.nextPieceKnown);
      setHammerCount(INITIAL_HAMMERS);
      setStarAvailable(true);
      setPlacementsMade(0);
      setTenStarsAchieved(0);
      setActivePresetId(preset.id);
      setSelectedMoveId(null);
    },
    [pushHistory]
  );

  // Share State via URL Hash & Clipboard
  const handleShareState = useCallback(() => {
    const hash = encodeStateToHash({
      maxUnlockedStar: effectiveMaxStar,
      board,
      currentPiece,
      nextPiece,
      nextPieceKnown,
      hammerCount,
      starAvailable,
      placementsMade,
      tenStarsAchieved,
    });
    window.history.replaceState(null, '', `#${hash}`);
    if (navigator.clipboard) {
      navigator.clipboard.writeText(window.location.href).catch(() => {});
    }
    setToastMessage('Shareable board state URL copied to clipboard & address bar!');
    setTimeout(() => setToastMessage(null), 3500);
  }, [
    effectiveMaxStar,
    board,
    currentPiece,
    nextPiece,
    nextPieceKnown,
    hammerCount,
    starAvailable,
    placementsMade,
    tenStarsAchieved,
  ]);

  // Compute Live Board Health KPIs
  const emptyCellsCount = useMemo(
    () => countEmptyCells(board),
    [board]
  );
  const totalPlayableCells = 23;

  const stragglers = useMemo(() => {
    const queueStars = [
      ...currentPiece.tileStars,
      ...(nextPieceKnown ? nextPiece.tileStars : []),
    ];
    return analyzeBoardStragglers(
      board,
      effectiveMaxStar,
      queueStars
    );
  }, [
    board,
    effectiveMaxStar,
    currentPiece.tileStars,
    nextPiece.tileStars,
    nextPieceKnown,
  ]);

  const shapeMobility = useMemo(
    () => analyzeShapeMobility(board),
    [board]
  );

  const placementsRemaining = Math.max(0, MAX_RUN_PLACEMENTS - placementsMade);

  // Run 2-Ply Solver
  const solverResult = useMemo(() => {
    return solveBestMoves(
      board,
      effectiveMaxStar,
      currentPiece,
      nextPiece,
      nextPieceKnown,
      hammerCount,
      placementsRemaining,
      blueprintMode,
      strategyId
    );
  }, [
    board,
    effectiveMaxStar,
    currentPiece,
    nextPiece,
    nextPieceKnown,
    hammerCount,
    placementsRemaining,
    blueprintMode,
    strategyId,
  ]);

  // Evaluate Run Hammer Advisor (0..2 Hammers)
  const hammerAdvice = useMemo(() => {
    return evaluateHammerAdvice(
      board,
      effectiveMaxStar,
      currentPiece,
      nextPiece,
      nextPieceKnown,
      solverResult,
      hammerCount,
      blueprintMode,
      strategyId
    );
  }, [
    board,
    effectiveMaxStar,
    currentPiece,
    nextPiece,
    nextPieceKnown,
    solverResult,
    hammerCount,
    blueprintMode,
    strategyId,
  ]);

  // Evaluate 1× Run Star Advisor (Raises 1★..8★ relic by +1 grade)
  const starAdvice = useMemo(() => {
    return evaluateStarAdvice(
      board,
      effectiveMaxStar,
      currentPiece,
      nextPiece,
      nextPieceKnown,
      solverResult,
      hammerCount
    );
  }, [
    board,
    effectiveMaxStar,
    currentPiece,
    nextPiece,
    nextPieceKnown,
    solverResult,
    hammerCount,
  ]);

  // Determine which move is currently previewed on the Honeycomb Board
  // Defaults to #1 Best Move when no move is explicitly locked or hovered!
  const activePreviewMove = useMemo(() => {
    if (viewMode === 'advanced' && hoveredMoveId) {
      const found = solverResult.candidates.find((c) => c.id === hoveredMoveId);
      if (found) return { move: found, rank: solverResult.topRecommendations.findIndex((t) => t.id === found.id) + 1 || null };
    }
    if (viewMode === 'advanced' && selectedMoveId) {
      const found = solverResult.candidates.find((c) => c.id === selectedMoveId);
      if (found) return { move: found, rank: solverResult.topRecommendations.findIndex((t) => t.id === found.id) + 1 || null };
    }
    if (solverResult.topRecommendations.length > 0) {
      return { move: solverResult.topRecommendations[0], rank: 1 };
    }
    return { move: null, rank: null };
  }, [viewMode, hoveredMoveId, selectedMoveId, solverResult]);

  // Apply Recommended Move (Ply 1 Only — Play-Along Loop)
  const handleApplyPly1Move = useCallback(
    (move: CandidateMove) => {
      if (placementsMade >= MAX_RUN_PLACEMENTS) {
        setToastMessage(
          `🏁 Maximum of ${MAX_RUN_PLACEMENTS} placements reached for this run!`
        );
        setTimeout(() => setToastMessage(null), 3500);
        return;
      }

      pushHistory();

      setBoard(move.ply1Sim.nextBoard);
      if (
        move.ply1Sim.nextMaxStar > effectiveMaxStar ||
        (manualMaxStar !== null && move.ply1Sim.nextMaxStar > manualMaxStar)
      ) {
        setManualMaxStar(move.ply1Sim.nextMaxStar);
      }

      if (move.ply1Sim.tenStarsCreated > 0) {
        setTenStarsAchieved((prev) => prev + move.ply1Sim.tenStarsCreated);
        setManualMaxStar(10);
      }

      const nextHammers = Math.min(
        MAX_HAMMERS,
        hammerCount + move.ply1Sim.hammersEarned
      );
      if (move.ply1Sim.hammersEarned > 0) {
        setHammerCount(nextHammers);
      }

      setPlacementsMade((prev) => Math.min(MAX_RUN_PLACEMENTS, prev + 1));

      if (move.ply1Sim.tenStarsCreated > 0 || move.ply1Sim.hammersEarned > 0) {
        const parts: string[] = [];
        if (move.ply1Sim.tenStarsCreated > 0) {
          parts.push(
            `👑 10★ Mythic Relic Achieved & Cleared from Board!`
          );
        }
        if (move.ply1Sim.hammersEarned > 0) {
          parts.push(
            `🔨 5+ Relic Merge earned +1 Hammer (${nextHammers}/${MAX_HAMMERS})!`
          );
        }
        setToastMessage(parts.join(' '));
        setTimeout(() => setToastMessage(null), 4000);
      }

      // Promote Next Piece -> Current Piece
      if (nextPieceKnown) {
        setCurrentPiece({
          shapeId: nextPiece.shapeId,
          rotation: nextPiece.rotation,
          tileStars: [...nextPiece.tileStars],
          anchorTileIndex: nextPiece.anchorTileIndex ?? 0,
        });
      }
      setSelectedMoveId(null);
      setHoveredMoveId(null);
    },
    [
      placementsMade,
      pushHistory,
      effectiveMaxStar,
      manualMaxStar,
      hammerCount,
      nextPieceKnown,
      nextPiece,
    ]
  );

  // Apply Both Moves (Ply 1 + Best Ply 2)
  const handleApplyBothMoves = useCallback(
    (move: CandidateMove) => {
      if (!move.bestPly2 || placementsMade >= MAX_RUN_PLACEMENTS - 1) {
        handleApplyPly1Move(move);
        return;
      }
      pushHistory();
      setBoard(move.bestPly2.sim.nextBoard);
      const maxStarReached = Math.max(
        move.ply1Sim.nextMaxStar,
        move.bestPly2.sim.nextMaxStar
      );
      if (
        maxStarReached > effectiveMaxStar ||
        (manualMaxStar !== null && maxStarReached > manualMaxStar)
      ) {
        setManualMaxStar(maxStarReached);
      }
      const totalTenStars =
        move.ply1Sim.tenStarsCreated + move.bestPly2.sim.tenStarsCreated;
      if (totalTenStars > 0) {
        setTenStarsAchieved((prev) => prev + totalTenStars);
        setManualMaxStar(10);
      }
      const totalHammersEarned =
        move.ply1Sim.hammersEarned + move.bestPly2.sim.hammersEarned;
      const nextHammers = Math.min(
        MAX_HAMMERS,
        hammerCount + totalHammersEarned
      );
      if (totalHammersEarned > 0) {
        setHammerCount(nextHammers);
      }
      setPlacementsMade((prev) => Math.min(MAX_RUN_PLACEMENTS, prev + 2));
      setSelectedMoveId(null);
      setHoveredMoveId(null);
      setToastMessage(
        'Executed both Current Piece & Next Piece! Enter your new pieces below.'
      );
      setTimeout(() => setToastMessage(null), 3500);
    },
    [
      placementsMade,
      handleApplyPly1Move,
      pushHistory,
      effectiveMaxStar,
      manualMaxStar,
      hammerCount,
    ]
  );

  const activePreset = useMemo(
    () => PRESET_SCENARIOS.find((p) => p.id === activePresetId) || null,
    [activePresetId]
  );

  const handleChangeViewMode = useCallback(
    (mode: 'simple' | 'advanced') => {
      setViewMode(mode);
      if (mode === 'simple') {
        setSelectedMoveId(null);
        setHoveredMoveId(null);
        if (activeBrush === 'inspect' || activeBrush === 'popover') {
          setActiveBrush(1);
        }
      }
    },
    [activeBrush]
  );

  return (
    <div className="min-h-screen bg-[#0B0C10] text-slate-100 flex flex-col">
      {/* Top Header & 10-Slot Relic Progression Bar */}
      <TopProgressionHeader
        viewMode={viewMode}
        onChangeViewMode={handleChangeViewMode}
        hammerCount={hammerCount}
        onChangeHammerCount={(cnt) => {
          pushHistory();
          const clamped = Math.max(0, Math.min(MAX_HAMMERS, cnt));
          setHammerCount(clamped);
          if (clamped === 0 && activeBrush === 'hammer') {
            setActiveBrush(1);
          }
        }}
        hammerAdvice={hammerAdvice}
        onUseHammer={handleUseHammer}
        starAvailable={starAvailable}
        onToggleStarAvailable={(avail) => {
          pushHistory();
          setStarAvailable(avail);
          if (!avail && activeBrush === 'star') {
            setActiveBrush(1);
          }
        }}
        starAdvice={starAdvice}
        onUseStar={handleUseStar}
        placementsMade={placementsMade}
        onChangePlacementsMade={(cnt) => {
          pushHistory();
          setPlacementsMade(Math.max(0, Math.min(MAX_RUN_PLACEMENTS, cnt)));
        }}
        blueprintMode={blueprintMode}
        onToggleBlueprintMode={setBlueprintMode}
        strategyId={strategyId}
        onChangeStrategyId={setStrategyId}
        tenStarsAchieved={tenStarsAchieved}
        activeMove={activePreviewMove.move}
        onApplyActiveMove={handleApplyPly1Move}
        maxUnlockedStar={effectiveMaxStar}
        isManualMaxStar={manualMaxStar !== null}
        onSelectMaxStar={(star) => {
          pushHistory();
          setManualMaxStar(star);
          if (star === 10) {
            setTenStarsAchieved((prev) => Math.max(1, prev));
          }
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
        onOpenEvalModal={() => setIsEvalModalOpen(true)}
        activePresetId={activePresetId}
      />

      {/* Toast Notification Banner */}
      {toastMessage && (
        <div className="max-w-[1600px] w-full mx-auto px-3 sm:px-6 pt-3">
          <div className="flex items-center justify-between gap-2 px-4 py-2 rounded-xl bg-emerald-950/80 border border-emerald-400/60 text-xs text-emerald-100 shadow-lg">
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
        </div>
      )}

      {/* Active Preset Scenario Context Banner (Advanced View Only) */}
      {viewMode === 'advanced' && activePreset && (
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
              viewMode={viewMode}
              board={board}
              maxUnlockedStar={effectiveMaxStar}
              stragglers={stragglers}
              activeBrush={activeBrush}
              onChangeBrush={setActiveBrush}
              onSetCellStar={handleSetCellStar}
              hammerCount={hammerCount}
              onUseHammer={handleUseHammer}
              hammerTargetCell={
                hoveredHammerTarget ??
                (activeBrush === 'hammer' ||
                (viewMode === 'simple' &&
                  hammerCount > 0 &&
                  hammerAdvice.shouldUseNow)
                  ? hammerAdvice.recommendedTarget?.cellIndex ?? null
                  : null)
              }
              starAvailable={starAvailable}
              onUseStar={handleUseStar}
              starTargetCell={
                hoveredStarTarget ??
                (activeBrush === 'star' ||
                (viewMode === 'simple' &&
                  starAvailable &&
                  starAdvice.shouldUseNow)
                  ? starAdvice.recommendedTarget?.cellIndex ?? null
                  : null)
              }
              previewMove={
                hoveredHammerTarget !== null &&
                hammerAdvice.recommendedTarget?.cellIndex ===
                  hoveredHammerTarget &&
                hammerAdvice.recommendedTarget.bestMoveAfterHammer
                  ? hammerAdvice.recommendedTarget.bestMoveAfterHammer
                  : hoveredStarTarget !== null &&
                    starAdvice.recommendedTarget?.cellIndex ===
                      hoveredStarTarget &&
                    starAdvice.recommendedTarget.bestMoveAfterStar
                  ? starAdvice.recommendedTarget.bestMoveAfterStar
                  : activePreviewMove.move
              }
              previewRank={activePreviewMove.rank}
              showPly2Ghost={showPly2Ghost}
              onToggleShowPly2Ghost={() => setShowPly2Ghost((v) => !v)}
            />
          </div>

          {/* Piece Queue Composer (5 of 12 cols on md+, directly to the right of the Board!) */}
          <div className="md:col-span-5">
            <PieceComposer
              viewMode={viewMode}
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
            viewMode={viewMode}
            currentPiece={currentPiece}
            nextPiece={nextPiece}
            nextPieceKnown={nextPieceKnown}
            topRecommendations={solverResult.topRecommendations}
            allCandidates={solverResult.candidates}
            lethalMoves={solverResult.lethalMoves}
            elapsedMs={solverResult.elapsedMs}
            hammerCount={hammerCount}
            hammerAdvice={hammerAdvice}
            onUseHammer={handleUseHammer}
            onChangeHammerCount={(cnt) => {
              pushHistory();
              const clamped = Math.max(0, Math.min(MAX_HAMMERS, cnt));
              setHammerCount(clamped);
              if (clamped === 0 && activeBrush === 'hammer') {
                setActiveBrush(1);
              }
            }}
            onHoverHammerTarget={setHoveredHammerTarget}
            starAvailable={starAvailable}
            starAdvice={starAdvice}
            onUseStar={handleUseStar}
            onToggleStarAvailable={(avail) => {
              pushHistory();
              setStarAvailable(avail);
              if (!avail && activeBrush === 'star') {
                setActiveBrush(1);
              }
            }}
            onHoverStarTarget={setHoveredStarTarget}
            placementsMade={placementsMade}
            onChangePlacementsMade={(cnt) => {
              pushHistory();
              setPlacementsMade(Math.max(0, Math.min(MAX_RUN_PLACEMENTS, cnt)));
            }}
            blueprintMode={blueprintMode}
            onToggleBlueprintMode={setBlueprintMode}
            blueprintProgress={solverResult.blueprintProgress}
            selectedMoveId={selectedMoveId}
            hoveredMoveId={hoveredMoveId}
            onSelectMove={setSelectedMoveId}
            onHoverMove={setHoveredMoveId}
            onApplyPly1Move={handleApplyPly1Move}
            onApplyBothMoves={handleApplyBothMoves}
          />
        </div>
      </main>

      {/* Footer (Advanced View Only) */}
      {viewMode === 'advanced' && (
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
      )}

      {/* Strategy Evaluation & Rating Lab Modal */}
      <EvalRunnerModal
        isOpen={isEvalModalOpen}
        onClose={() => setIsEvalModalOpen(false)}
        initialStrategyId={strategyId}
      />
    </div>
  );
};

export default App;
