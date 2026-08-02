import {
  CELL_COUNT,
  type Owner,
  type PlacedTile,
  type Player,
  type Rotation,
} from './types';
import { TILES, tileById, tileIdsFor } from './tiles';
import {
  ROTATIONS,
  checkPlacement,
  distinctRotations,
  touchingIndices,
  type Board,
  type PlacementCheck,
} from './rules';

export type Phase = 'opening' | 'playing' | 'finished';

export interface GameOptions {
  /** Also forbid diagonal touching for the second neutral piece. */
  blockDiagonalOpening: boolean;
  /** Require border-facing sides to match the board edge style. */
  requireBoardEdgeMatch: boolean;
  /** Shuffle the order pieces appear in each tray. */
  shuffleTrays: boolean;
  seed: number;
}

export interface Move {
  readonly index: number;
  readonly tileId: string;
  readonly rotation: Rotation;
  readonly by: Player;
}

export interface GameState {
  readonly board: ReadonlyArray<PlacedTile | null>;
  readonly hands: Readonly<Record<Player, readonly string[]>>;
  readonly neutralQueue: readonly string[];
  readonly turn: Player;
  readonly phase: Phase;
  readonly winner: Player | null;
  readonly history: readonly Move[];
  readonly options: GameOptions;
}

export const DEFAULT_OPTIONS: GameOptions = {
  blockDiagonalOpening: false,
  requireBoardEdgeMatch: false,
  shuffleTrays: true,
  seed: 1,
};

/** Small deterministic PRNG so a seed reproduces a tray order. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], rng: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

export function createGame(options: Partial<GameOptions> = {}): GameState {
  const opts: GameOptions = { ...DEFAULT_OPTIONS, ...options };
  const rng = mulberry32(opts.seed);
  const light = tileIdsFor('light');
  const dark = tileIdsFor('dark');
  const neutral = tileIdsFor('neutral');
  return {
    board: new Array<PlacedTile | null>(CELL_COUNT).fill(null),
    hands: {
      light: opts.shuffleTrays ? shuffled(light, rng) : light,
      dark: opts.shuffleTrays ? shuffled(dark, rng) : dark,
    },
    neutralQueue: neutral,
    turn: 'light',
    phase: 'opening',
    winner: null,
    history: [],
    options: opts,
  };
}

export function other(player: Player): Player {
  return player === 'light' ? 'dark' : 'light';
}

export function ownerOf(tileId: string): Owner {
  return tileById(tileId).owner;
}

/** Piece ids the player to move is allowed to pick from. */
export function availableTileIds(state: GameState): readonly string[] {
  if (state.phase === 'finished') return [];
  if (state.phase === 'opening') {
    return state.neutralQueue.length > 0 ? [state.neutralQueue[0]] : [];
  }
  return state.hands[state.turn];
}

export function isLegalMove(
  state: GameState,
  index: number,
  tileId: string,
  rotation: Rotation,
): PlacementCheck {
  if (state.phase === 'finished') return { ok: false, reason: 'The game is over.' };
  const available = availableTileIds(state);
  if (!available.includes(tileId)) {
    return { ok: false, reason: 'That piece is not available this turn.' };
  }
  const sides = tileById(tileId).sides;

  if (state.phase === 'opening') {
    const edgeCheck = checkPlacement(state.board as Board, sides, index, rotation, {
      requireAdjacency: false,
      requireBoardEdgeMatch: state.options.requireBoardEdgeMatch,
    });
    if (!edgeCheck.ok) return edgeCheck;

    const placedCount = state.board.filter((c) => c !== null).length;
    if (placedCount > 0) {
      const blocked = touchingIndices(index, state.options.blockDiagonalOpening).some(
        (ni) => state.board[ni] !== null,
      );
      if (blocked) {
        return {
          ok: false,
          reason: 'The second neutral piece may not be placed next to the first one.',
        };
      }
    }
    return { ok: true };
  }

  return checkPlacement(state.board as Board, sides, index, rotation, {
    requireAdjacency: true,
    requireBoardEdgeMatch: state.options.requireBoardEdgeMatch,
  });
}

/** Every legal move for the player to move. */
export function legalMoves(state: GameState): Move[] {
  const out: Move[] = [];
  if (state.phase === 'finished') return out;
  const available = availableTileIds(state);
  for (const tileId of available) {
    const sides = tileById(tileId).sides;
    const rotations = state.phase === 'opening' ? ([0] as Rotation[]) : distinctRotations(sides);
    for (let index = 0; index < state.board.length; index += 1) {
      if (state.board[index]) continue;
      for (const rotation of rotations) {
        if (isLegalMove(state, index, tileId, rotation).ok) {
          out.push({ index, tileId, rotation, by: state.turn });
        }
      }
    }
  }
  return out;
}

export function hasLegalMove(state: GameState): boolean {
  if (state.phase === 'finished') return false;
  const available = availableTileIds(state);
  for (const tileId of available) {
    const sides = tileById(tileId).sides;
    const rotations = state.phase === 'opening' ? ([0] as Rotation[]) : distinctRotations(sides);
    for (let index = 0; index < state.board.length; index += 1) {
      if (state.board[index]) continue;
      for (const rotation of rotations) {
        if (isLegalMove(state, index, tileId, rotation).ok) return true;
      }
    }
  }
  return false;
}

/** Cells where the given piece can go in at least one rotation. */
export function legalCellsForTile(state: GameState, tileId: string): Set<number> {
  const cells = new Set<number>();
  if (state.phase === 'finished') return cells;
  const sides = tileById(tileId).sides;
  const rotations = state.phase === 'opening' ? ([0] as Rotation[]) : distinctRotations(sides);
  for (let index = 0; index < state.board.length; index += 1) {
    if (state.board[index]) continue;
    for (const rotation of rotations) {
      if (isLegalMove(state, index, tileId, rotation).ok) {
        cells.add(index);
        break;
      }
    }
  }
  return cells;
}

/** First rotation that works at `index`, preferring `preferred`. */
export function firstLegalRotation(
  state: GameState,
  index: number,
  tileId: string,
  preferred: Rotation = 0,
): Rotation | null {
  const order: Rotation[] = [preferred, ...ROTATIONS.filter((r) => r !== preferred)];
  for (const rotation of order) {
    if (isLegalMove(state, index, tileId, rotation).ok) return rotation;
  }
  return null;
}

export function applyMove(state: GameState, move: Move): GameState {
  const check = isLegalMove(state, move.index, move.tileId, move.rotation);
  if (!check.ok) throw new Error(`Illegal move: ${check.reason}`);

  const owner = ownerOf(move.tileId);
  const board = state.board.slice();
  board[move.index] = { tileId: move.tileId, rotation: move.rotation, owner };

  const hands: Record<Player, readonly string[]> = {
    light: state.hands.light,
    dark: state.hands.dark,
  };
  let neutralQueue = state.neutralQueue;
  if (owner === 'neutral') {
    neutralQueue = neutralQueue.filter((id) => id !== move.tileId);
  } else {
    hands[owner] = state.hands[owner].filter((id) => id !== move.tileId);
  }

  const history = [...state.history, { ...move, by: state.turn }];
  const openingDone = state.phase === 'opening' && neutralQueue.length === 0;
  const nextPhase: Phase = state.phase === 'opening' && !openingDone ? 'opening' : 'playing';
  // Light opens, dark places the other neutral piece, then light starts the main game.
  const nextTurn: Player = openingDone ? 'light' : other(state.turn);

  let next: GameState = {
    ...state,
    board,
    hands,
    neutralQueue,
    history,
    phase: nextPhase,
    turn: nextTurn,
  };

  if (next.phase === 'playing' && !hasLegalMove(next)) {
    next = { ...next, phase: 'finished', winner: other(next.turn) };
  }
  return next;
}

/**
 * Rebuild every state of a game from its options and move list. Trays are derived
 * from the options seed, so this reproduces the original game exactly, including
 * each intermediate position so undo keeps working after a reload.
 *
 * Throws if any move is illegal, which is what makes a tampered or corrupt saved
 * game fail loudly instead of loading a broken position.
 */
export function replayMoves(
  options: GameOptions,
  moves: ReadonlyArray<{ index: number; tileId: string; rotation: Rotation }>,
): GameState[] {
  const states: GameState[] = [createGame(options)];
  for (const move of moves) {
    const current = states[states.length - 1];
    states.push(
      applyMove(current, {
        index: move.index,
        tileId: move.tileId,
        rotation: move.rotation,
        by: current.turn,
      }),
    );
  }
  return states;
}

export function placedCount(state: GameState): number {
  return state.board.reduce((n, cell) => (cell ? n + 1 : n), 0);
}

export function totalPieces(): number {
  return TILES.length;
}
