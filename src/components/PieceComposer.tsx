import React, { useState } from 'react';
import {
  Copy,
  Eye,
  EyeOff,
  RotateCcw,
  RotateCw,
  Shuffle,
} from 'lucide-react';
import {
  getActiveSpawnPool,
  PIECE_SHAPE_ORDER,
  PIECE_SHAPES,
  RELIC_SPECS,
} from '../domain/constants';
import {
  cubeOffsetToVisualXY,
  getRotatedPieceCubeOffsets,
} from '../domain/honeycomb';
import { PieceConfig, PieceShapeId } from '../types/forge';
import { RelicTileVisual } from './RelicTileVisual';

interface MiniPiecePreviewProps {
  piece: PieceConfig;
  selectedTileIndex?: number;
  onSelectTile?: (index: number) => void;
  size?: 'sm' | 'md';
}

export const MiniPiecePreview: React.FC<MiniPiecePreviewProps> = ({
  piece,
  selectedTileIndex,
  onSelectTile,
  size = 'md',
}) => {
  const rotatedOffsets = getRotatedPieceCubeOffsets(
    piece.shapeId,
    piece.rotation
  );
  const visualCoords = rotatedOffsets.map((off) => cubeOffsetToVisualXY(off));

  // Center the bounding box of visualCoords inside the preview canvas
  const minX = Math.min(...visualCoords.map((v) => v.vx));
  const maxX = Math.max(...visualCoords.map((v) => v.vx));
  const minY = Math.min(...visualCoords.map((v) => v.vy));
  const maxY = Math.max(...visualCoords.map((v) => v.vy));

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  const tilePx = size === 'sm' ? 28 : 36;
  const stepPx = size === 'sm' ? 32 : 41;
  const canvasHeight = size === 'sm' ? 'h-24' : 'h-28';

  return (
    <div
      className={`relative w-full ${canvasHeight} rounded-xl bg-[#0B0D14] border border-[#272E45] flex items-center justify-center overflow-hidden shadow-inner`}
    >
      {/* Subtle Honeycomb Reference Grid Lines */}
      <div className="absolute inset-0 opacity-15 pointer-events-none bg-[radial-gradient(#64748b_1px,transparent_1px)] [background-size:16px_16px]" />

      {visualCoords.map((vc, idx) => {
        const star = piece.tileStars[idx] ?? 1;
        const dxPx = (vc.vx - centerX) * stepPx;
        const dyPx = (vc.vy - centerY) * stepPx;
        const isSelected = selectedTileIndex === idx;

        return (
          <button
            key={idx}
            type="button"
            onClick={() => onSelectTile && onSelectTile(idx)}
            style={{
              width: `${tilePx}px`,
              height: `${tilePx}px`,
              transform: `translate(${dxPx}px, ${dyPx}px)`,
            }}
            className={`absolute transition-all duration-150 rounded-xl ${
              onSelectTile ? 'cursor-pointer hover:scale-105' : 'cursor-default'
            } ${
              isSelected
                ? 'ring-2 ring-amber-300 z-20 scale-105 shadow-[0_0_15px_rgba(251,191,36,0.5)]'
                : 'z-10'
            }`}
            title={`Tile T${idx} (${star}★) — Click to select and set star level`}
          >
            <RelicTileVisual
              star={star}
              size={size === 'sm' ? 'xs' : 'sm'}
              className="w-full h-full"
            />
            <span
              className={`absolute -top-2 -right-1.5 px-1 py-0.2 rounded text-[9px] font-black leading-tight shadow ${
                idx === 0
                  ? 'bg-amber-400 text-slate-950'
                  : 'bg-slate-800 text-slate-200 border border-slate-600'
              }`}
            >
              T{idx}
            </span>
          </button>
        );
      })}
    </div>
  );
};

interface SinglePieceEditorCardProps {
  title: string;
  badgeText: string;
  badgeColor: string;
  piece: PieceConfig;
  onChangePiece: (next: PieceConfig) => void;
  maxUnlockedStar: number;
  allowRetiredWindowStar: boolean;
  disabled?: boolean;
  headerRight?: React.ReactNode;
}

const SinglePieceEditorCard: React.FC<SinglePieceEditorCardProps> = ({
  title,
  badgeText,
  badgeColor,
  piece,
  onChangePiece,
  maxUnlockedStar,
  allowRetiredWindowStar,
  disabled = false,
  headerRight,
}) => {
  const [selectedTileIdx, setSelectedTileIdx] = useState<number>(0);
  const [showAllStars, setShowAllStars] = useState(false);

  const shapeSpec = PIECE_SHAPES[piece.shapeId];
  const safeSelectedIdx =
    selectedTileIdx < shapeSpec.tileCount ? selectedTileIdx : 0;

  const activePool = getActiveSpawnPool(maxUnlockedStar);
  const legacyBoundaryStar =
    allowRetiredWindowStar && maxUnlockedStar > 4 ? maxUnlockedStar - 4 : null;

  const handleShapeChange = (newShapeId: PieceShapeId) => {
    const newCount = PIECE_SHAPES[newShapeId].tileCount;
    const defaultStar = activePool[0] ?? 1;
    const nextStars = Array.from(
      { length: newCount },
      (_, i) => piece.tileStars[i] ?? defaultStar
    );
    onChangePiece({
      shapeId: newShapeId,
      rotation: 0,
      tileStars: nextStars,
    });
    if (selectedTileIdx >= newCount) {
      setSelectedTileIdx(0);
    }
  };

  const handleRotate = (delta: number) => {
    const nextRot = (piece.rotation + delta + 6) % 6;
    onChangePiece({
      ...piece,
      rotation: nextRot,
    });
  };

  const handleSetTileStar = (tileIdx: number, star: number) => {
    const nextStars = [...piece.tileStars];
    nextStars[tileIdx] = star;
    onChangePiece({
      ...piece,
      tileStars: nextStars,
    });
    // Automatically advance selection to next tile in piece for rapid 1-2-3 entry!
    if (shapeSpec.tileCount > 1) {
      setSelectedTileIdx((tileIdx + 1) % shapeSpec.tileCount);
    }
  };

  const handleSetAllTilesStar = (star: number) => {
    onChangePiece({
      ...piece,
      tileStars: Array.from({ length: shapeSpec.tileCount }, () => star),
    });
  };

  const handleRandomizeActivePiece = () => {
    const randomShape =
      PIECE_SHAPE_ORDER[Math.floor(Math.random() * PIECE_SHAPE_ORDER.length)];
    const count = PIECE_SHAPES[randomShape].tileCount;
    const randomStars = Array.from(
      { length: count },
      () => activePool[Math.floor(Math.random() * activePool.length)]
    );
    onChangePiece({
      shapeId: randomShape,
      rotation: Math.floor(Math.random() * 6),
      tileStars: randomStars,
    });
    setSelectedTileIdx(0);
  };

  return (
    <div
      className={`bg-[#141824] border border-[#2B3248] rounded-2xl p-2.5 flex flex-col gap-2 shadow-lg transition-opacity ${
        disabled ? 'opacity-50 pointer-events-none' : ''
      }`}
    >
      {/* Card Header */}
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <div className="flex items-center gap-1.5">
          <span
            className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase ${badgeColor}`}
          >
            {badgeText}
          </span>
          <h3 className="text-xs font-bold text-white">{title}</h3>
        </div>
        <div className="flex items-center gap-1">
          {headerRight}
          <button
            type="button"
            onClick={handleRandomizeActivePiece}
            className="px-2 py-0.5 rounded-md bg-[#1E2436] hover:bg-[#283048] text-slate-300 text-[10px] font-semibold flex items-center gap-1 border border-slate-700"
            title="Roll random piece from active spawn pool"
          >
            <Shuffle className="w-3 h-3" />
            <span>Roll</span>
          </button>
        </div>
      </div>

      {/* Shape Selector Pills (6 Shapes with Visual Mini-Diagrams) */}
      <div className="grid grid-cols-6 gap-1">
        {PIECE_SHAPE_ORDER.map((shapeId) => {
          const spec = PIECE_SHAPES[shapeId];
          const isSelected = piece.shapeId === shapeId;
          return (
            <button
              key={shapeId}
              type="button"
              onClick={() => handleShapeChange(shapeId)}
              className={`py-1 px-0.5 rounded-lg text-[9px] font-bold transition-all border flex flex-col items-center justify-center gap-0.5 ${
                isSelected
                  ? 'bg-amber-500 text-slate-950 border-amber-300 shadow-sm'
                  : 'bg-[#0E111A] text-slate-300 border-[#252B3F] hover:bg-[#191E2D]'
              }`}
              title={spec.name}
            >
              <svg
                viewBox="0 0 24 18"
                className="w-4 h-3 shrink-0"
                fill="currentColor"
              >
                {shapeId === 'single' && (
                  <rect x="8" y="5" width="8" height="8" rx="1.5" />
                )}
                {shapeId === 'pair' && (
                  <>
                    <rect x="8" y="1" width="7" height="7" rx="1.5" />
                    <rect x="8" y="10" width="7" height="7" rx="1.5" />
                  </>
                )}
                {shapeId === 'line3' && (
                  <>
                    <rect x="9" y="0.5" width="5" height="5" rx="1" />
                    <rect x="9" y="6.5" width="5" height="5" rx="1" />
                    <rect x="9" y="12.5" width="5" height="5" rx="1" />
                  </>
                )}
                {shapeId === 'chevron3' && (
                  <>
                    <rect x="9" y="2" width="6" height="6" rx="1.2" />
                    <rect x="2" y="9" width="6" height="6" rx="1.2" />
                    <rect x="16" y="9" width="6" height="6" rx="1.2" />
                  </>
                )}
                {shapeId === 'bent3' && (
                  <>
                    <rect x="5" y="1.5" width="6" height="6" rx="1.2" />
                    <rect x="5" y="8.5" width="6" height="6" rx="1.2" />
                    <rect x="12.5" y="11" width="6" height="6" rx="1.2" />
                  </>
                )}
                {shapeId === 'compact3' && (
                  <>
                    <rect x="5" y="2" width="6" height="6" rx="1.2" />
                    <rect x="5" y="9.5" width="6" height="6" rx="1.2" />
                    <rect x="12.5" y="5.5" width="6" height="6" rx="1.2" />
                  </>
                )}
              </svg>
              <span className="truncate max-w-full leading-none">
                {spec.shortName}
              </span>
            </button>
          );
        })}
      </div>

      {/* Interactive Mini Honeycomb Canvas + Rotate 60° Controls */}
      <div className="relative">
        <MiniPiecePreview
          piece={piece}
          selectedTileIndex={safeSelectedIdx}
          onSelectTile={(idx) => setSelectedTileIdx(idx)}
          size="md"
        />

        {/* Rotation Controls Overlay */}
        <div className="mt-1.5 flex items-center justify-between gap-1.5">
          <button
            type="button"
            onClick={() => handleRotate(-1)}
            disabled={piece.shapeId === 'single'}
            className="px-2 py-1 rounded-lg bg-[#1C2234] hover:bg-[#252D44] text-slate-200 text-[11px] font-bold flex items-center gap-1 border border-[#323B56] disabled:opacity-40"
            title="Rotate 60° Counter-Clockwise"
          >
            <RotateCcw className="w-3 h-3 text-amber-300" />
            <span>60° ↺</span>
          </button>

          <div className="text-center flex-1 truncate px-1">
            <div className="text-[10px] font-bold text-amber-200 truncate">
              {shapeSpec.rotationLabels[piece.rotation]}
            </div>
            <div className="text-[9px] text-slate-400">
              Step {piece.rotation} ({piece.rotation * 60}°) • All 6 checked
            </div>
          </div>

          <button
            type="button"
            onClick={() => handleRotate(1)}
            disabled={piece.shapeId === 'single'}
            className="px-2 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 text-[11px] font-bold flex items-center gap-1 border border-amber-400/50 disabled:opacity-40"
            title="Rotate 60° Clockwise"
          >
            <span>60° ↻</span>
            <RotateCw className="w-3 h-3 text-amber-300" />
          </button>
        </div>
      </div>

      {/* Per-Tile Star Assignment Section */}
      <div className="bg-[#0E111A] rounded-xl p-2 border border-[#242A3E] space-y-1.5">
        <div className="flex items-center justify-between gap-1">
          <div className="flex items-center gap-1">
            {Array.from({ length: shapeSpec.tileCount }, (_, idx) => {
              const star = piece.tileStars[idx] ?? 1;
              const isSelected = safeSelectedIdx === idx;
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setSelectedTileIdx(idx)}
                  className={`px-1.5 py-0.5 rounded text-[11px] font-bold flex items-center gap-1 border transition-all ${
                    isSelected
                      ? 'bg-amber-500/25 text-amber-200 border-amber-400'
                      : 'bg-[#171B28] text-slate-400 border-slate-700 hover:text-slate-200'
                  }`}
                >
                  <span>T{idx}:</span>
                  <span
                    className="px-1 rounded text-white font-black text-[10px]"
                    style={{ backgroundColor: RELIC_SPECS[star]?.bgHex }}
                  >
                    {star}★
                  </span>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => setShowAllStars((v) => !v)}
            className="text-[10px] text-slate-400 hover:text-amber-300 font-semibold"
          >
            {showAllStars ? 'Active Pool' : 'All 1★–10★'}
          </button>
        </div>

        {/* Quick Star Buttons for Selected Tile T[safeSelectedIdx] */}
        <div className="flex flex-wrap items-center gap-1">
          {legacyBoundaryStar !== null && !showAllStars && (
            <button
              type="button"
              onClick={() => handleSetTileStar(safeSelectedIdx, legacyBoundaryStar)}
              className="px-2 py-1 rounded-md text-[11px] font-black text-white border border-dashed border-rose-400 flex items-center gap-1 hover:scale-105 transition-transform"
              style={{
                backgroundColor: RELIC_SPECS[legacyBoundaryStar].bgHex,
              }}
              title={`Retired Boundary Tier ${legacyBoundaryStar}★ (Still in Next Piece Preview after tier-up)`}
            >
              <span>{legacyBoundaryStar}★</span>
            </button>
          )}

          {(showAllStars ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] : activePool).map(
            (star) => {
              const spec = RELIC_SPECS[star];
              const isCurrentTileStar = piece.tileStars[safeSelectedIdx] === star;
              return (
                <button
                  key={star}
                  type="button"
                  onClick={() => handleSetTileStar(safeSelectedIdx, star)}
                  className={`flex-1 min-w-[36px] py-1 px-1.5 rounded-md text-[11px] font-black text-white flex items-center justify-center gap-0.5 border transition-all ${
                    isCurrentTileStar
                      ? 'ring-2 ring-amber-300 scale-105 shadow'
                      : ' opacity-90 hover:opacity-100 hover:scale-[1.02]'
                  }`}
                  style={{
                    backgroundColor: spec.bgHex,
                    borderColor: spec.borderHex,
                  }}
                >
                  <span>{star}★</span>
                </button>
              );
            }
          )}

          {shapeSpec.tileCount > 1 && (
            <button
              type="button"
              onClick={() =>
                handleSetAllTilesStar(piece.tileStars[safeSelectedIdx] ?? activePool[0])
              }
              className="px-2 py-1 rounded-md bg-[#1A2030] hover:bg-[#232B40] text-slate-300 text-[10px] font-bold border border-slate-700"
              title="Fill all tiles in this piece with the selected tile's star level"
            >
              All {piece.tileStars[safeSelectedIdx]}★
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

interface PieceComposerProps {
  currentPiece: PieceConfig;
  onChangeCurrentPiece: (piece: PieceConfig) => void;
  nextPiece: PieceConfig;
  onChangeNextPiece: (piece: PieceConfig) => void;
  nextPieceKnown: boolean;
  onToggleNextPieceKnown: (known: boolean) => void;
  maxUnlockedStar: number;
}

export const PieceComposer: React.FC<PieceComposerProps> = ({
  currentPiece,
  onChangeCurrentPiece,
  nextPiece,
  onChangeNextPiece,
  nextPieceKnown,
  onToggleNextPieceKnown,
  maxUnlockedStar,
}) => {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-1.5 px-1">
        <h2 className="text-xs font-extrabold uppercase tracking-wider text-slate-200">
          Piece Queue (Current & Next)
        </h2>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onChangeNextPiece({ ...currentPiece, tileStars: [...currentPiece.tileStars] })}
            className="px-2 py-0.5 rounded-md bg-[#181D2C] hover:bg-[#22293E] text-slate-300 text-[10px] font-semibold flex items-center gap-1 border border-[#2D354E]"
            title="Copy Current Piece to Next Piece"
          >
            <Copy className="w-3 h-3" />
            <span>Dup</span>
          </button>

          <button
            type="button"
            onClick={() => onToggleNextPieceKnown(!nextPieceKnown)}
            className={`px-2 py-0.5 rounded-md text-[10px] font-bold flex items-center gap-1 border transition-all ${
              nextPieceKnown
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
                : 'bg-amber-500/20 text-amber-300 border-amber-500/50'
            }`}
          >
            {nextPieceKnown ? (
              <>
                <Eye className="w-3 h-3" />
                <span>2-Ply Known</span>
              </>
            ) : (
              <>
                <EyeOff className="w-3 h-3" />
                <span>1-Ply Only</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Stacked Current Piece & Next Piece Cards (fits directly beside the Honeycomb Board!) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-1 gap-2.5">
        <SinglePieceEditorCard
          title="Current Piece (Active)"
          badgeText="PLY 1 • NOW"
          badgeColor="bg-amber-400 text-slate-950"
          piece={currentPiece}
          onChangePiece={onChangeCurrentPiece}
          maxUnlockedStar={maxUnlockedStar}
          allowRetiredWindowStar={true}
        />

        <SinglePieceEditorCard
          title="Next Piece (Preview)"
          badgeText="PLY 2 • NEXT"
          badgeColor="bg-cyan-400 text-slate-950"
          piece={nextPiece}
          onChangePiece={onChangeNextPiece}
          maxUnlockedStar={maxUnlockedStar}
          allowRetiredWindowStar={true}
          disabled={!nextPieceKnown}
        />
      </div>
    </div>
  );
};
