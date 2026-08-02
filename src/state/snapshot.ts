import { DEFAULT_OPTIONS, replayMoves, type GameOptions, type GameState } from '../engine/game';
import type { Player, Rotation } from '../engine/types';

export const SNAPSHOT_VERSION = 1;

/** 'hotseat' is both players on one screen, 'remote' is one player per screen. */
export type PlayMode = 'hotseat' | 'remote';

/** A move in its compact stored form. */
export interface SavedMove {
  i: number;
  t: string;
  r: Rotation;
}

/**
 * Everything needed to rebuild a game: the options (which determine both trays)
 * and the moves played. `epoch` increases every time a new game is started, which
 * is how two connected screens agree that a reset is newer than what they hold.
 */
export interface Snapshot {
  version: number;
  gameId: string;
  epoch: number;
  mode: PlayMode;
  seat: Player;
  options: GameOptions;
  moves: SavedMove[];
}

/** Unambiguous alphabet: no I, O, 0 or 1, so codes survive being read aloud. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const GAME_ID_LENGTH = 6;
const MAX_GAME_ID_LENGTH = 12;
const MIN_GAME_ID_LENGTH = 4;

export function createGameId(length: number = GAME_ID_LENGTH): string {
  const bytes = new Uint8Array(length);
  const webCrypto = globalThis.crypto;
  if (webCrypto && typeof webCrypto.getRandomValues === 'function') {
    webCrypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  let out = '';
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
  return out;
}

/** Accept whatever the player typed or pasted and reduce it to a usable code. */
export function normalizeGameId(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    .toUpperCase()
    .split('')
    .filter((char) => ALPHABET.includes(char))
    .join('')
    .slice(0, MAX_GAME_ID_LENGTH);
}

/**
 * If the player pasted the full share URL, use its game parameter. Otherwise treat
 * the whole field as the code they intended to enter.
 */
export function gameIdCandidate(raw: string | null | undefined): string {
  const text = raw?.trim() ?? '';
  if (!text) return '';
  const match = /[?&]game=([^&#\s]+)/i.exec(text);
  if (match?.[1]) return decodeURIComponent(match[1]);
  try {
    const url = new URL(text);
    return url.searchParams.get('game') ?? text;
  } catch {
    return text;
  }
}

export function extractGameId(raw: string | null | undefined): string {
  return normalizeGameId(gameIdCandidate(raw));
}

/**
 * Codes never contain I, O, 0 or 1, so those characters in the actual code field
 * mean it was misread. Silently dropping them can put the player in a different
 * empty game, which is worse than rejecting the input.
 */
export function hasAmbiguousCharacters(raw: string | null | undefined): boolean {
  return /[IO01]/i.test(gameIdCandidate(raw));
}

export function isValidGameId(id: string): boolean {
  return id.length >= MIN_GAME_ID_LENGTH && normalizeGameId(id) === id;
}

export function savedMovesFrom(state: GameState): SavedMove[] {
  return state.history.map((move) => ({ i: move.index, t: move.tileId, r: move.rotation }));
}

export function makeSnapshot(
  state: GameState,
  meta: { gameId: string; epoch: number; mode: PlayMode; seat: Player },
): Snapshot {
  return {
    version: SNAPSHOT_VERSION,
    gameId: meta.gameId,
    epoch: meta.epoch,
    mode: meta.mode,
    seat: meta.seat,
    options: { ...state.options },
    moves: savedMovesFrom(state),
  };
}

export function encodeSnapshot(snapshot: Snapshot): string {
  return JSON.stringify(snapshot);
}

function isPlayer(value: unknown): value is Player {
  return value === 'light' || value === 'dark';
}

function parseOptions(value: unknown): GameOptions | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.blockDiagonalOpening !== 'boolean') return null;
  if (typeof raw.requireBoardEdgeMatch !== 'boolean') return null;
  if (typeof raw.shuffleTrays !== 'boolean') return null;
  if (typeof raw.seed !== 'number' || !Number.isFinite(raw.seed)) return null;
  return {
    ...DEFAULT_OPTIONS,
    blockDiagonalOpening: raw.blockDiagonalOpening,
    requireBoardEdgeMatch: raw.requireBoardEdgeMatch,
    shuffleTrays: raw.shuffleTrays,
    seed: raw.seed,
  };
}

function parseMoves(value: unknown): SavedMove[] | null {
  if (!Array.isArray(value) || value.length > 36) return null;
  const moves: SavedMove[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) return null;
    const raw = entry as Record<string, unknown>;
    const { i, t, r } = raw;
    if (typeof i !== 'number' || !Number.isInteger(i) || i < 0 || i > 35) return null;
    if (typeof t !== 'string' || t.length === 0 || t.length > 8) return null;
    if (r !== 0 && r !== 1 && r !== 2 && r !== 3) return null;
    moves.push({ i, t, r });
  }
  return moves;
}

/** Structural validation only; legality is checked later by replaying. */
export function parseSnapshot(value: unknown): Snapshot | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (raw.version !== SNAPSHOT_VERSION) return null;
  const gameId = typeof raw.gameId === 'string' ? normalizeGameId(raw.gameId) : '';
  if (!isValidGameId(gameId)) return null;
  if (typeof raw.epoch !== 'number' || !Number.isInteger(raw.epoch) || raw.epoch < 0) return null;
  if (raw.mode !== 'hotseat' && raw.mode !== 'remote') return null;
  if (!isPlayer(raw.seat)) return null;
  const options = parseOptions(raw.options);
  if (!options) return null;
  const moves = parseMoves(raw.moves);
  if (!moves) return null;
  return {
    version: SNAPSHOT_VERSION,
    gameId,
    epoch: raw.epoch,
    mode: raw.mode,
    seat: raw.seat,
    options,
    moves,
  };
}

export function decodeSnapshot(raw: string | null | undefined): Snapshot | null {
  if (!raw) return null;
  try {
    return parseSnapshot(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * Rebuild the whole state history, or null when the snapshot does not describe a
 * legal game. Every move is validated by the engine as it is replayed.
 */
export function restoreHistory(snapshot: Snapshot): GameState[] | null {
  try {
    const states = replayMoves(
      snapshot.options,
      snapshot.moves.map((move) => ({ index: move.i, tileId: move.t, rotation: move.r })),
    );
    return states.length === snapshot.moves.length + 1 ? states : null;
  } catch {
    return null;
  }
}

export type SyncDecision = 'ignore' | 'adopt' | 'keep' | 'same';

function optionsEqual(a: GameOptions, b: GameOptions): boolean {
  return (
    a.seed === b.seed &&
    a.shuffleTrays === b.shuffleTrays &&
    a.blockDiagonalOpening === b.blockDiagonalOpening &&
    a.requireBoardEdgeMatch === b.requireBoardEdgeMatch
  );
}

/**
 * Decide what to do with a snapshot that arrived from the other screen.
 *
 * A newer epoch beats an older one, then a longer move list wins, since a legal
 * game only ever grows. When both sides are level, Light owns the options, which
 * is how a joining player picks up the host's tray order.
 */
export function compareSnapshots(local: Snapshot, remote: Snapshot, mySeat: Player): SyncDecision {
  if (remote.gameId !== local.gameId) return 'ignore';
  if (remote.epoch > local.epoch) return 'adopt';
  if (remote.epoch < local.epoch) return 'keep';
  if (remote.moves.length > local.moves.length) return 'adopt';
  if (remote.moves.length < local.moves.length) return 'keep';
  if (optionsEqual(local.options, remote.options)) return 'same';
  return mySeat === 'dark' ? 'adopt' : 'keep';
}
