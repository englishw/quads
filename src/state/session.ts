import type { GameState } from '../engine/game';
import type { Player } from '../engine/types';
import type { PlayMode } from './snapshot';

/** Which mode we are in and, for two-screen play, which side of the board is ours. */
export interface SeatInfo {
  mode: PlayMode;
  seat: Player;
}

export function opponentOf(player: Player): Player {
  return player === 'light' ? 'dark' : 'light';
}

/** On one screen you move for both players; on two screens only for your own seat. */
export function controlsSeat(info: SeatInfo, player: Player): boolean {
  if (info.mode === 'hotseat') return true;
  if (info.mode === 'practice') return player === 'light';
  return info.seat === player;
}

export function canPlayTurn(state: GameState, info: SeatInfo): boolean {
  return state.phase !== 'finished' && controlsSeat(info, state.turn);
}

/**
 * The opponent's tray is only drawn face down in two-screen play. Note this is a
 * convenience, not secrecy: each player holds every piece of their colour, so what
 * remains in a hand is always deducible from the board.
 */
export function isTrayHidden(info: SeatInfo, player: Player): boolean {
  return info.mode === 'remote' && info.seat !== player;
}

/** Undo stays on one screen, where both players can agree to it face to face. */
export function canUndo(info: SeatInfo, historyLength: number): boolean {
  return (info.mode === 'hotseat' || info.mode === 'practice') && historyLength > 1;
}

/** The panel nearest the player holding the device. */
export function nearSeat(info: SeatInfo): Player {
  return info.mode === 'remote' ? info.seat : 'light';
}

export function waitingForOpponent(state: GameState, info: SeatInfo): boolean {
  return info.mode === 'remote' && state.phase !== 'finished' && state.turn !== info.seat;
}
