import {
  BOARD_SIZE,
  DIRECTIONS,
  DIRECTION_NAMES,
  SIDE_LABEL_NAMES,
  type Direction,
  type PlacedTile,
  type Rotation,
  type SideLabel,
  type Sides,
} from './types';
import { tileById } from './tiles';

export type Board = ReadonlyArray<PlacedTile | null>;

export const ROTATIONS: readonly Rotation[] = [0, 1, 2, 3];

/** Sides after rotating the piece `rotation` quarter-turns clockwise. */
export function rotatedSides(sides: Sides, rotation: Rotation): Sides {
  return [
    sides[(0 - rotation + 4) % 4],
    sides[(1 - rotation + 4) % 4],
    sides[(2 - rotation + 4) % 4],
    sides[(3 - rotation + 4) % 4],
  ] as Sides;
}

/** Which label faces `dir` once the piece is rotated. */
export function sideAt(sides: Sides, rotation: Rotation, dir: Direction): SideLabel {
  return sides[(dir - rotation + 4) % 4];
}

/** Rotations that look different from each other for this piece. */
export function distinctRotations(sides: Sides): Rotation[] {
  const seen = new Set<string>();
  const out: Rotation[] = [];
  for (const r of ROTATIONS) {
    const key = rotatedSides(sides, r).join('');
    if (!seen.has(key)) {
      seen.add(key);
      out.push(r);
    }
  }
  return out;
}

export function opposite(dir: Direction): Direction {
  return ((dir + 2) % 4) as Direction;
}

export function rowOf(index: number): number {
  return Math.floor(index / BOARD_SIZE);
}

export function colOf(index: number): number {
  return index % BOARD_SIZE;
}

export function indexOf(row: number, col: number): number {
  return row * BOARD_SIZE + col;
}

export function neighbourIndex(index: number, dir: Direction): number | null {
  const row = rowOf(index);
  const col = colOf(index);
  const dr = dir === 0 ? -1 : dir === 2 ? 1 : 0;
  const dc = dir === 1 ? 1 : dir === 3 ? -1 : 0;
  const nr = row + dr;
  const nc = col + dc;
  if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) return null;
  return indexOf(nr, nc);
}

/** Orthogonal neighbours, optionally including diagonals. */
export function touchingIndices(index: number, includeDiagonal: boolean): number[] {
  const row = rowOf(index);
  const col = colOf(index);
  const out: number[] = [];
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      if (dr === 0 && dc === 0) continue;
      if (!includeDiagonal && dr !== 0 && dc !== 0) continue;
      const nr = row + dr;
      const nc = col + dc;
      if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) continue;
      out.push(indexOf(nr, nc));
    }
  }
  return out;
}

export type PlacementCheck = { ok: true } | { ok: false; reason: string };

const OK: PlacementCheck = { ok: true };

/**
 * Core placement rule for a normal (non-opening) move: the cell must be empty,
 * the piece must border at least one placed piece, and every touching pair of
 * sides must carry an identical label.
 */
export function checkPlacement(
  board: Board,
  sides: Sides,
  index: number,
  rotation: Rotation,
  options: { requireAdjacency?: boolean; requireBoardEdgeMatch?: boolean } = {},
): PlacementCheck {
  const requireAdjacency = options.requireAdjacency ?? true;
  const requireBoardEdgeMatch = options.requireBoardEdgeMatch ?? false;
  if (index < 0 || index >= board.length) return { ok: false, reason: 'That cell is off the board.' };
  if (board[index]) return { ok: false, reason: 'That cell is already taken.' };

  let neighbours = 0;
  for (const dir of DIRECTIONS) {
    const ni = neighbourIndex(index, dir);
    if (ni === null) {
      if (requireBoardEdgeMatch) {
        const mine = sideAt(sides, rotation, dir);
        const expected = dir === 0 || dir === 2 ? 'X' : 'P';
        if (mine !== expected) {
          return {
            ok: false,
            reason: `The ${DIRECTION_NAMES[dir]} side does not match the board edge: ${SIDE_LABEL_NAMES[mine]} instead of ${SIDE_LABEL_NAMES[expected]}.`,
          };
        }
      }
      continue;
    }
    const placed = board[ni];
    if (!placed) continue;
    neighbours += 1;
    const mine = sideAt(sides, rotation, dir);
    const theirs = sideAt(tileById(placed.tileId).sides, placed.rotation, opposite(dir));
    if (mine !== theirs) {
      return {
        ok: false,
        reason: `The ${DIRECTION_NAMES[dir]} side does not match: ${SIDE_LABEL_NAMES[mine]} against ${SIDE_LABEL_NAMES[theirs]}.`,
      };
    }
  }

  if (requireAdjacency && neighbours === 0) {
    return { ok: false, reason: 'A piece must touch at least one piece already on the board.' };
  }
  return OK;
}
