import { BoardMode, CubeCoord, OffsetCoord, PieceShapeId } from '../types/forge';
import { PIECE_SHAPES } from './constants';

export const BOARD_COLS = 5;
export const BOARD_MAX_ROWS = 5;
export const TOTAL_SLOTS = 25; // col * 5 + row (0..24)

export function getColumnRowCount(col: number, mode: BoardMode): number {
  if (col < 0 || col >= BOARD_COLS) return 0;
  if (mode === '23-cell') {
    return col % 2 === 1 ? 4 : 5;
  }
  return 5;
}

export function isValidCell(col: number, row: number, mode: BoardMode): boolean {
  if (col < 0 || col >= BOARD_COLS) return false;
  const maxRows = getColumnRowCount(col, mode);
  return row >= 0 && row < maxRows;
}

export function cellToIndex(col: number, row: number): number {
  return col * 5 + row;
}

export function indexToCoord(cellIndex: number): OffsetCoord {
  return {
    col: Math.floor(cellIndex / 5),
    row: cellIndex % 5,
  };
}

export function isCellIndexValid(cellIndex: number, mode: BoardMode): boolean {
  if (cellIndex < 0 || cellIndex >= TOTAL_SLOTS) return false;
  const col = Math.floor(cellIndex / 5);
  const row = cellIndex % 5;
  return isValidCell(col, row, mode);
}

export function getValidCellIndices(mode: BoardMode): number[] {
  const indices: number[] = [];
  for (let c = 0; c < BOARD_COLS; c++) {
    const rows = getColumnRowCount(c, mode);
    for (let r = 0; r < rows; r++) {
      indices.push(cellToIndex(c, r));
    }
  }
  return indices;
}

export function formatCellCoord(col: number, row: number): string {
  const colLetter = String.fromCharCode(65 + col); // A..E
  return `${colLetter}${row + 1}`;
}

export function formatCellCoordVerbose(col: number, row: number): string {
  const colLetter = String.fromCharCode(65 + col);
  return `${colLetter}${row + 1} (C${col},R${row})`;
}

/**
 * Exact 6-Neighbor Coordinate Lookup Rules (Section 2.1):
 * Even Column (c in {0, 2, 4}):
 *   N:  (c, r - 1)
 *   S:  (c, r + 1)
 *   NW: (c - 1, r - 1)
 *   SW: (c - 1, r)
 *   NE: (c + 1, r - 1)
 *   SE: (c + 1, r)
 * Odd Column (c in {1, 3}):
 *   N:  (c, r - 1)
 *   S:  (c, r + 1)
 *   NW: (c - 1, r)
 *   SW: (c - 1, r + 1)
 *   NE: (c + 1, r)
 *   SE: (c + 1, r + 1)
 */
export interface NeighborWithDirection {
  dir: 'N' | 'NE' | 'SE' | 'S' | 'SW' | 'NW';
  col: number;
  row: number;
  cellIndex: number;
}

export function getDirectionalNeighbors(
  col: number,
  row: number,
  mode: BoardMode
): NeighborWithDirection[] {
  const isOdd = col % 2 === 1;
  const raw: { dir: NeighborWithDirection['dir']; c: number; r: number }[] = isOdd
    ? [
        { dir: 'N', c: col, r: row - 1 },
        { dir: 'NE', c: col + 1, r: row },
        { dir: 'SE', c: col + 1, r: row + 1 },
        { dir: 'S', c: col, r: row + 1 },
        { dir: 'SW', c: col - 1, r: row + 1 },
        { dir: 'NW', c: col - 1, r: row },
      ]
    : [
        { dir: 'N', c: col, r: row - 1 },
        { dir: 'NE', c: col + 1, r: row - 1 },
        { dir: 'SE', c: col + 1, r: row },
        { dir: 'S', c: col, r: row + 1 },
        { dir: 'SW', c: col - 1, r: row },
        { dir: 'NW', c: col - 1, r: row - 1 },
      ];

  const result: NeighborWithDirection[] = [];
  for (const item of raw) {
    if (isValidCell(item.c, item.r, mode)) {
      result.push({
        dir: item.dir,
        col: item.c,
        row: item.r,
        cellIndex: cellToIndex(item.c, item.r),
      });
    }
  }
  return result;
}

function buildPrecomputedNeighbors(mode: BoardMode): number[][] {
  const table: number[][] = Array.from({ length: TOTAL_SLOTS }, () => []);
  for (let c = 0; c < BOARD_COLS; c++) {
    for (let r = 0; r < BOARD_MAX_ROWS; r++) {
      const idx = cellToIndex(c, r);
      if (!isValidCell(c, r, mode)) {
        table[idx] = [];
        continue;
      }
      table[idx] = getDirectionalNeighbors(c, r, mode).map((n) => n.cellIndex);
    }
  }
  return table;
}

export const PRECOMPUTED_NEIGHBORS_23: number[][] = buildPrecomputedNeighbors('23-cell');
export const PRECOMPUTED_NEIGHBORS_25: number[][] = buildPrecomputedNeighbors('25-cell');

export function getPrecomputedNeighbors(mode: BoardMode): number[][] {
  return mode === '23-cell' ? PRECOMPUTED_NEIGHBORS_23 : PRECOMPUTED_NEIGHBORS_25;
}

/**
 * Conversion between odd-column staggered offset coordinates (c, r) and cube coordinates (x, y, z)
 * Consistent with N = (0, -1, 1), NE = (1, -1, 0), SE = (1, 0, -1), S = (0, 1, -1), SW = (-1, 1, 0), NW = (-1, 0, 1)
 */
export function offsetToCube(col: number, row: number): CubeCoord {
  const x = col;
  const y = row - Math.floor(col / 2);
  const z = -x - y;
  return [x, y, z];
}

export function cubeToOffset([x, y, _z]: CubeCoord): OffsetCoord {
  const col = x;
  const row = y + Math.floor(x / 2);
  return { col, row };
}

/**
 * 60° Clockwise rotation in hex cube coordinates around (0, 0, 0):
 * Maps N (0,-1,1) -> NE (1,-1,0) -> SE (1,0,-1) -> S (0,1,-1) -> SW (-1,1,0) -> NW (-1,0,1)
 */
export function rotateCubeOffset(offset: CubeCoord, stepsCW: number): CubeCoord {
  const normalizedSteps = ((stepsCW % 6) + 6) % 6;
  let [dx, dy, dz] = offset;
  for (let i = 0; i < normalizedSteps; i++) {
    const nextX = -dy;
    const nextY = -dz;
    const nextZ = -dx;
    dx = nextX;
    dy = nextY;
    dz = nextZ;
  }
  return [dx + 0, dy + 0, dz + 0]; // avoid -0
}

export function getRotatedPieceCubeOffsets(
  shapeId: PieceShapeId,
  rotation: number
): CubeCoord[] {
  const spec = PIECE_SHAPES[shapeId];
  return spec.baseCubeOffsets.map((base) => rotateCubeOffset(base, rotation));
}

/**
 * Returns the visual 2D offset (in cell units) of a cube coordinate relative to (0,0,0),
 * matching the staggered board where column dx shifts horizontally by 1 unit and
 * vertically by dy + 0.5 * dx.
 */
export function cubeOffsetToVisualXY([dx, dy, _dz]: CubeCoord): { vx: number; vy: number } {
  return {
    vx: dx,
    vy: dy + 0.5 * dx,
  };
}

/**
 * Visual vertical center position of a board cell (in cell units from top):
 * Even columns: row (0, 1, 2, 3, 4)
 * Odd columns: row + 0.5 (0.5, 1.5, 2.5, 3.5)
 */
export function getCellVisualY(col: number, row: number): number {
  return row + (col % 2 === 1 ? 0.5 : 0);
}

/**
 * Given a piece shape, rotation (0..5), tileStars, and an anchor board cell (anchorCol, anchorRow),
 * returns the placed tiles if every tile lands on a valid board cell for the given mode; otherwise null.
 */
export function resolvePiecePlacement(
  shapeId: PieceShapeId,
  rotation: number,
  tileStars: number[],
  anchorCol: number,
  anchorRow: number,
  mode: BoardMode
): { tileIndex: number; col: number; row: number; cellIndex: number; star: number }[] | null {
  const [ax, ay, az] = offsetToCube(anchorCol, anchorRow);
  const rotatedOffsets = getRotatedPieceCubeOffsets(shapeId, rotation);
  const result: { tileIndex: number; col: number; row: number; cellIndex: number; star: number }[] = [];

  for (let i = 0; i < rotatedOffsets.length; i++) {
    const [dx, dy, dz] = rotatedOffsets[i];
    const { col, row } = cubeToOffset([ax + dx, ay + dy, az + dz]);
    if (!isValidCell(col, row, mode)) {
      return null;
    }
    result.push({
      tileIndex: i,
      col,
      row,
      cellIndex: cellToIndex(col, row),
      star: tileStars[i] ?? 1,
    });
  }

  return result;
}
