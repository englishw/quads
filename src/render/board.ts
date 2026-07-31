import { BOARD_SIZE } from '../engine/types';
import type { Rotation } from '../engine/types';
import type { GameState } from '../engine/game';
import { colOf, rowOf } from '../engine/rules';
import { tileById } from '../engine/tiles';
import { COLORS, TILE_UNITS, stripeDefs, tileGroup } from './tile';

const CELL = TILE_UNITS;
const BOARD_PX = CELL * BOARD_SIZE;
const FRAME = 34;
const BAND = 20;
const VIEW_MIN = -FRAME;
const VIEW_SIZE = BOARD_PX + FRAME * 2;
const SUFFIX = 'board';

export interface Ghost {
  index: number;
  tileId: string;
  rotation: Rotation;
  valid: boolean;
}

export interface BoardView {
  legalCells?: ReadonlySet<number>;
  ghost?: Ghost | null;
  lastMoveIndex?: number | null;
}

function cellX(index: number): number {
  return colOf(index) * CELL;
}

function cellY(index: number): number {
  return rowOf(index) * CELL;
}

function frameMarkup(): string {
  const outer = `<rect x="${VIEW_MIN}" y="${VIEW_MIN}" width="${VIEW_SIZE}" height="${VIEW_SIZE}" rx="6" fill="${COLORS.light}"/>`;
  const inset = 7;
  const near = VIEW_MIN + inset;
  const far = BOARD_PX + FRAME - inset - BAND;
  const span = VIEW_SIZE - inset * 2;
  const bands = [
    // Top and bottom bands carry lines across the board edge; sides carry lines along it.
    `<rect x="${near}" y="${near}" width="${span}" height="${BAND}" fill="url(#qv-${SUFFIX})"/>`,
    `<rect x="${near}" y="${far}" width="${span}" height="${BAND}" fill="url(#qv-${SUFFIX})"/>`,
    `<rect x="${near}" y="${near}" width="${BAND}" height="${span}" fill="url(#qh-${SUFFIX})"/>`,
    `<rect x="${far}" y="${near}" width="${BAND}" height="${span}" fill="url(#qh-${SUFFIX})"/>`,
  ].join('');
  const surface = `<rect x="0" y="0" width="${BOARD_PX}" height="${BOARD_PX}" fill="#efecd6"/>`;
  return `<g class="board-frame">${outer}${bands}${surface}</g>`;
}

function gridMarkup(): string {
  const lines: string[] = [];
  for (let i = 0; i <= BOARD_SIZE; i += 1) {
    const p = i * CELL;
    lines.push(`<line x1="${p}" y1="0" x2="${p}" y2="${BOARD_PX}"/>`);
    lines.push(`<line x1="0" y1="${p}" x2="${BOARD_PX}" y2="${p}"/>`);
  }
  return `<g class="board-grid" stroke="#b4a184" stroke-width="1.2">${lines.join('')}</g>`;
}

function placedMarkup(state: GameState): string {
  const parts: string[] = [];
  state.board.forEach((cell, index) => {
    if (!cell) return;
    const tile = tileById(cell.tileId);
    parts.push(
      tileGroup(tile.sides, cell.rotation, SUFFIX, {
        x: cellX(index),
        y: cellY(index),
        className: `placed placed--${cell.owner}`,
      }),
    );
  });
  return `<g class="board-pieces">${parts.join('')}</g>`;
}

function overlayMarkup(view: BoardView): string {
  const parts: string[] = [];
  if (view.lastMoveIndex !== null && view.lastMoveIndex !== undefined) {
    parts.push(
      `<rect class="last-move" x="${cellX(view.lastMoveIndex)}" y="${cellY(view.lastMoveIndex)}" width="${CELL}" height="${CELL}"/>`,
    );
  }
  if (view.legalCells) {
    for (const index of view.legalCells) {
      if (view.ghost && view.ghost.index === index) continue;
      parts.push(
        `<circle class="legal-dot" cx="${cellX(index) + CELL / 2}" cy="${cellY(index) + CELL / 2}" r="9"/>`,
      );
    }
  }
  if (view.ghost) {
    const tile = tileById(view.ghost.tileId);
    parts.push(
      tileGroup(tile.sides, view.ghost.rotation, SUFFIX, {
        x: cellX(view.ghost.index),
        y: cellY(view.ghost.index),
        className: 'ghost-piece',
        opacity: 0.75,
      }),
    );
    parts.push(
      `<rect class="ghost-outline ${view.ghost.valid ? 'is-valid' : 'is-invalid'}" x="${cellX(view.ghost.index)}" y="${cellY(view.ghost.index)}" width="${CELL}" height="${CELL}"/>`,
    );
  }
  return `<g class="board-overlay">${parts.join('')}</g>`;
}

function hitsMarkup(state: GameState): string {
  const parts: string[] = [];
  state.board.forEach((_, index) => {
    parts.push(
      `<rect class="cell-hit" data-index="${index}" x="${cellX(index)}" y="${cellY(index)}" width="${CELL}" height="${CELL}" fill="transparent"/>`,
    );
  });
  return `<g class="board-hits">${parts.join('')}</g>`;
}

export function boardSvg(state: GameState, view: BoardView = {}): string {
  return (
    `<svg class="board-svg" viewBox="${VIEW_MIN} ${VIEW_MIN} ${VIEW_SIZE} ${VIEW_SIZE}" role="grid" aria-label="Quads board">` +
    `<defs>${stripeDefs(SUFFIX)}</defs>` +
    frameMarkup() +
    gridMarkup() +
    placedMarkup(state) +
    overlayMarkup(view) +
    hitsMarkup(state) +
    `</svg>`
  );
}

export const BOARD_GEOMETRY = { CELL, BOARD_PX, FRAME, VIEW_MIN, VIEW_SIZE };
