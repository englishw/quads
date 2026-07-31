import { describe, expect, it } from 'vitest';
import { createGame, type GameState } from '../engine/game';
import {
  canPlayTurn,
  canUndo,
  controlsSeat,
  isTrayHidden,
  nearSeat,
  opponentOf,
  waitingForOpponent,
  type SeatInfo,
} from './session';

const hotseat: SeatInfo = { mode: 'hotseat', seat: 'light' };
const asLight: SeatInfo = { mode: 'remote', seat: 'light' };
const asDark: SeatInfo = { mode: 'remote', seat: 'dark' };

function state(overrides: Partial<GameState> = {}): GameState {
  return { ...createGame({ shuffleTrays: false }), ...overrides };
}

describe('seat authority', () => {
  it('pairs the players', () => {
    expect(opponentOf('light')).toBe('dark');
    expect(opponentOf('dark')).toBe('light');
  });

  it('lets one screen move for both players', () => {
    expect(controlsSeat(hotseat, 'light')).toBe(true);
    expect(controlsSeat(hotseat, 'dark')).toBe(true);
  });

  it('limits each screen to its own seat in a shared game', () => {
    expect(controlsSeat(asLight, 'light')).toBe(true);
    expect(controlsSeat(asLight, 'dark')).toBe(false);
    expect(controlsSeat(asDark, 'dark')).toBe(true);
    expect(controlsSeat(asDark, 'light')).toBe(false);
  });

  it('only allows play on your own turn in a shared game', () => {
    const lightToMove = state({ turn: 'light' });
    expect(canPlayTurn(lightToMove, asLight)).toBe(true);
    expect(canPlayTurn(lightToMove, asDark)).toBe(false);
    expect(canPlayTurn(lightToMove, hotseat)).toBe(true);
  });

  it('allows nobody to play once the game is over', () => {
    const done = state({ phase: 'finished', winner: 'light' });
    expect(canPlayTurn(done, hotseat)).toBe(false);
    expect(canPlayTurn(done, asLight)).toBe(false);
    expect(canPlayTurn(done, asDark)).toBe(false);
  });

  it('hides only the opponent tray, and only in a shared game', () => {
    expect(isTrayHidden(hotseat, 'light')).toBe(false);
    expect(isTrayHidden(hotseat, 'dark')).toBe(false);
    expect(isTrayHidden(asLight, 'light')).toBe(false);
    expect(isTrayHidden(asLight, 'dark')).toBe(true);
    expect(isTrayHidden(asDark, 'light')).toBe(true);
    expect(isTrayHidden(asDark, 'dark')).toBe(false);
  });

  it('keeps undo on one screen only', () => {
    expect(canUndo(hotseat, 3)).toBe(true);
    expect(canUndo(hotseat, 1)).toBe(false);
    expect(canUndo(asLight, 3)).toBe(false);
    expect(canUndo(asDark, 3)).toBe(false);
  });

  it('puts your own seat nearest you', () => {
    expect(nearSeat(hotseat)).toBe('light');
    expect(nearSeat(asLight)).toBe('light');
    expect(nearSeat(asDark)).toBe('dark');
  });

  it('knows when we are waiting on the other screen', () => {
    const lightToMove = state({ turn: 'light' });
    expect(waitingForOpponent(lightToMove, asDark)).toBe(true);
    expect(waitingForOpponent(lightToMove, asLight)).toBe(false);
    expect(waitingForOpponent(lightToMove, hotseat)).toBe(false);
    expect(waitingForOpponent(state({ turn: 'light', phase: 'finished' }), asDark)).toBe(false);
  });
});
