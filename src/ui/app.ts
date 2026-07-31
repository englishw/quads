import type { Player, Rotation } from '../engine/types';
import {
  applyMove,
  availableTileIds,
  createGame,
  firstLegalRotation,
  isLegalMove,
  legalCellsForTile,
  legalMoves,
  placedCount,
  type GameState,
} from '../engine/game';
import { distinctRotations } from '../engine/rules';
import { tileById } from '../engine/tiles';
import { boardSvg, type Ghost } from '../render/board';
import { tileSvg } from '../render/tile';

interface UiState {
  selected: string | null;
  pending: number | null;
  rotation: Rotation;
  hints: boolean;
  message: string;
  showRules: boolean;
}

const PLAYER_NAMES: Record<Player, string> = { light: 'Light', dark: 'Dark' };

export function mountGame(
  root: HTMLElement,
  dragLayer: HTMLElement,
  options: { demoMoves?: number } = {},
): void {
  let history: GameState[] = [createGame({ seed: Date.now() % 100000 })];

  // `?demo=N` plays N random legal moves before handing over, which makes it easy
  // to inspect a mid-game position.
  for (let i = 0; i < (options.demoMoves ?? 0); i += 1) {
    const moves = legalMoves(history[history.length - 1]);
    if (moves.length === 0) break;
    history = [...history, applyMove(history[history.length - 1], moves[i % moves.length])];
  }
  let ui: UiState = {
    selected: null,
    pending: null,
    rotation: 0,
    hints: true,
    message: 'Light opens by placing a neutral piece anywhere on the board.',
    showRules: false,
  };

  const state = () => history[history.length - 1];

  if ((options.demoMoves ?? 0) > 0) {
    const s = state();
    const tileId = availableTileIds(s).find((id) => legalCellsForTile(s, id).size > 0);
    if (tileId) {
      const cell = legalCellsForTile(s, tileId).values().next();
      ui.selected = tileId;
      ui.pending = cell.done ? null : cell.value;
      ui.rotation = ui.pending === null ? 0 : (firstLegalRotation(s, ui.pending, tileId, 0) ?? 0);
    }
    ui.message = `${PLAYER_NAMES[s.turn]} to play.`;
  }

  function autoSelect(): void {
    const available = availableTileIds(state());
    if (ui.selected && available.includes(ui.selected)) return;
    ui.selected = state().phase === 'opening' && available.length > 0 ? available[0] : null;
    ui.pending = null;
    ui.rotation = 0;
  }

  function ghost(): Ghost | null {
    if (ui.selected === null || ui.pending === null) return null;
    const check = isLegalMove(state(), ui.pending, ui.selected, ui.rotation);
    return { index: ui.pending, tileId: ui.selected, rotation: ui.rotation, valid: check.ok };
  }

  function legalCells(): ReadonlySet<number> | undefined {
    if (!ui.hints || !ui.selected) return undefined;
    return legalCellsForTile(state(), ui.selected);
  }

  function selectTile(tileId: string): void {
    if (!availableTileIds(state()).includes(tileId)) return;
    if (ui.selected !== tileId) {
      ui.selected = tileId;
      ui.pending = null;
      ui.rotation = 0;
      const cells = legalCellsForTile(state(), tileId);
      ui.message =
        cells.size === 0
          ? 'That piece has no legal placement. Try another one.'
          : `Piece selected. ${cells.size} legal cell${cells.size === 1 ? '' : 's'}. Tap the board to aim, then tap again to place.`;
    }
    render();
  }

  function targetCell(index: number): void {
    if (state().phase === 'finished') return;
    if (!ui.selected) {
      ui.message = 'Choose one of your pieces first.';
      render();
      return;
    }
    if (ui.pending === index) {
      place();
      return;
    }
    ui.pending = index;
    const legal = firstLegalRotation(state(), index, ui.selected, ui.rotation);
    if (legal !== null) {
      ui.rotation = legal;
      ui.message = 'Looks good. Tap the piece again, or press Place, to confirm.';
    } else {
      const check = isLegalMove(state(), index, ui.selected, ui.rotation);
      ui.message = check.ok ? '' : check.reason;
    }
    render();
  }

  function rotate(): void {
    if (!ui.selected) {
      ui.message = 'Choose one of your pieces first.';
      render();
      return;
    }
    const options = distinctRotations(tileById(ui.selected).sides);
    if (options.length <= 1) {
      ui.message = 'This piece looks the same in every rotation.';
      render();
      return;
    }
    const current = options.indexOf(ui.rotation);
    ui.rotation = options[(current + 1) % options.length];
    if (ui.pending !== null) {
      const check = isLegalMove(state(), ui.pending, ui.selected, ui.rotation);
      ui.message = check.ok ? 'This rotation fits. Press Place to confirm.' : check.reason;
    }
    render();
  }

  function place(): void {
    if (ui.selected === null || ui.pending === null) return;
    const check = isLegalMove(state(), ui.pending, ui.selected, ui.rotation);
    if (!check.ok) {
      ui.message = check.reason;
      render();
      return;
    }
    const current = state();
    const next = applyMove(current, {
      index: ui.pending,
      tileId: ui.selected,
      rotation: ui.rotation,
      by: current.turn,
    });
    history = [...history, next];
    ui.selected = null;
    ui.pending = null;
    ui.rotation = 0;
    if (next.phase === 'finished') {
      ui.message = `${PLAYER_NAMES[next.turn]} has no legal move. ${PLAYER_NAMES[next.winner as Player]} wins.`;
    } else if (next.phase === 'opening') {
      ui.message = 'Dark places the other neutral piece, but not next to the first one.';
    } else {
      const count = legalMoves(next).length;
      ui.message = `${PLAYER_NAMES[next.turn]} to play. ${count} legal move${count === 1 ? '' : 's'} available.`;
    }
    autoSelect();
    render();
  }

  function cancel(): void {
    ui.pending = null;
    ui.rotation = 0;
    ui.message = 'Aim cleared.';
    render();
  }

  function undo(): void {
    if (history.length <= 1) {
      ui.message = 'Nothing to undo.';
      render();
      return;
    }
    history = history.slice(0, -1);
    ui.selected = null;
    ui.pending = null;
    ui.rotation = 0;
    ui.message = `Move undone. ${PLAYER_NAMES[state().turn]} to play.`;
    autoSelect();
    render();
  }

  function newGame(): void {
    history = [createGame({ seed: Date.now() % 100000, blockDiagonalOpening: state().options.blockDiagonalOpening })];
    ui = {
      ...ui,
      selected: null,
      pending: null,
      rotation: 0,
      message: 'New game. Light opens by placing a neutral piece anywhere on the board.',
    };
    autoSelect();
    render();
  }

  function toggleDiagonalRule(): void {
    const current = state();
    if (current.history.length > 0) {
      ui.message = 'Opening rule changes take effect on the next new game.';
    }
    const next: GameState = {
      ...current,
      options: { ...current.options, blockDiagonalOpening: !current.options.blockDiagonalOpening },
    };
    history = [...history.slice(0, -1), next];
    render();
  }

  function panelMarkup(player: Player): string {
    const s = state();
    const active = s.phase !== 'finished' && s.turn === player;
    const hand = s.hands[player];
    const openingPiece = s.phase === 'opening' && active ? availableTileIds(s)[0] : null;
    // Both players keep their pieces face up the whole game; during the opening only
    // the neutral piece can actually be played.
    const tiles = openingPiece ? [openingPiece, ...hand] : hand;
    const buttons = tiles
      .map((tileId) => {
        const tile = tileById(tileId);
        const selected = ui.selected === tileId;
        const rotation = selected ? ui.rotation : 0;
        const disabled = !active || (openingPiece !== null && tileId !== openingPiece);
        return (
          `<button type="button" class="tile-btn${selected ? ' is-selected' : ''}" data-tile="${tileId}"` +
          ` aria-pressed="${selected}"${disabled ? ' disabled' : ''}` +
          ` aria-label="Piece ${tileId}">${tileSvg(tile.sides, rotation)}</button>`
        );
      })
      .join('');
    const label = openingPiece
      ? `Place the neutral piece · ${hand.length} of your own`
      : `${hand.length} pieces left`;
    return `
      <section class="panel panel--${player}${active ? ' is-active' : ''}" data-player="${player}">
        <header class="panel__bar">
          <span class="panel__name">${PLAYER_NAMES[player]}</span>
          <span class="panel__status">${active ? 'Your turn' : 'Waiting'}</span>
          <span class="panel__count">${label}</span>
        </header>
        <div class="panel__controls">
          <button type="button" class="btn" data-action="rotate"${active ? '' : ' disabled'}>Rotate</button>
          <button type="button" class="btn btn--primary" data-action="place"${active && ghost()?.valid ? '' : ' disabled'}>Place</button>
          <button type="button" class="btn" data-action="cancel"${active && ui.pending !== null ? '' : ' disabled'}>Clear</button>
        </div>
        <div class="tray" role="group" aria-label="${PLAYER_NAMES[player]} pieces">${buttons}</div>
      </section>`;
  }

  function rulesMarkup(): string {
    if (!ui.showRules) return '';
    const s = state();
    return `
      <div class="rules" role="dialog" aria-label="Rules and settings">
        <h2>How to play</h2>
        <ul>
          <li>Light opens with a neutral piece anywhere. Dark then places the other neutral piece, but not next to the first.</li>
          <li>After that, each turn place one of your own pieces so it touches at least one piece already on the board.</li>
          <li>Every pair of touching sides must be identical: light to light, dark to dark, lines along the edge to lines along the edge, lines across the edge to lines across the edge.</li>
          <li>You may touch your opponent's pieces and several pieces at once.</li>
          <li>If the player to move has no legal placement, the other player wins.</li>
        </ul>
        <h2>Settings</h2>
        <label class="check">
          <input type="checkbox" data-action="diagonal" ${s.options.blockDiagonalOpening ? 'checked' : ''}/>
          Opening: the second neutral piece may not touch diagonally either
        </label>
        <button type="button" class="btn" data-action="rules">Close</button>
      </div>`;
  }

  function resultMarkup(): string {
    const s = state();
    if (s.phase !== 'finished' || !s.winner) return '';
    const text = `${PLAYER_NAMES[s.winner]} wins — ${PLAYER_NAMES[s.turn]} has no legal move.`;
    return `
      <div class="result" role="alert">
        <p class="result__text result__text--flipped">${text}</p>
        <p class="result__text">${text}</p>
        <button type="button" class="btn btn--primary" data-action="new">New game</button>
      </div>`;
  }

  function render(): void {
    const s = state();
    const view = { legalCells: legalCells(), ghost: ghost(), lastMoveIndex: s.history.length > 0 ? s.history[s.history.length - 1].index : null };
    root.innerHTML = `
      <div class="table" data-turn="${s.turn}" data-phase="${s.phase}">
        ${panelMarkup('dark')}
        <div class="board-area">
          <div class="board-wrap">${boardSvg(s, view)}</div>
          <p class="status" role="status" aria-live="polite">${ui.message}</p>
          <div class="toolbar">
            <button type="button" class="btn" data-action="undo"${history.length > 1 ? '' : ' disabled'}>Undo</button>
            <button type="button" class="btn" data-action="new">New game</button>
            <button type="button" class="btn" data-action="hints" aria-pressed="${ui.hints}">Hints ${ui.hints ? 'on' : 'off'}</button>
            <button type="button" class="btn" data-action="rules">Rules</button>
            <span class="counter">${placedCount(s)} / 36 placed</span>
          </div>
          ${rulesMarkup()}
          ${resultMarkup()}
        </div>
        ${panelMarkup('light')}
      </div>`;
  }

  // --- interaction ---------------------------------------------------------

  let drag: { tileId: string; pointerId: number; startX: number; startY: number; moved: boolean } | null = null;
  let hovered: Element | null = null;
  let suppressClick = false;

  function cellFromPoint(x: number, y: number): number | null {
    const el = document.elementFromPoint(x, y);
    const hit = el?.closest<SVGElement>('.cell-hit');
    if (!hit) return null;
    const raw = hit.dataset.index;
    return raw === undefined ? null : Number(raw);
  }

  function setHover(x: number, y: number): void {
    const el = document.elementFromPoint(x, y)?.closest('.cell-hit') ?? null;
    if (hovered === el) return;
    hovered?.classList.remove('is-hover');
    hovered = el;
    hovered?.classList.add('is-hover');
  }

  function clearHover(): void {
    hovered?.classList.remove('is-hover');
    hovered = null;
  }

  // Note: no rendering happens while a pointer gesture is in flight. Replacing the
  // pressed element mid-drag would cancel the gesture on touch devices.
  root.addEventListener('pointerdown', (event) => {
    const btn = (event.target as Element | null)?.closest<HTMLButtonElement>('.tile-btn');
    if (!btn || btn.disabled) return;
    const tileId = btn.dataset.tile;
    if (!tileId) return;
    drag = { tileId, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, moved: false };
  });

  window.addEventListener(
    'pointermove',
    (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (!drag.moved && Math.hypot(dx, dy) < 8) return;
      drag.moved = true;
      event.preventDefault();
      const tile = tileById(drag.tileId);
      if (!dragLayer.firstChild) {
        if (ui.selected !== drag.tileId && availableTileIds(state()).includes(drag.tileId)) {
          ui.selected = drag.tileId;
          ui.pending = null;
          ui.rotation = 0;
        }
        dragLayer.innerHTML = tileSvg(tile.sides, ui.rotation, { className: 'tile-svg drag-ghost' });
        dragLayer.classList.add('is-dragging');
      }
      dragLayer.style.transform = `translate(${event.clientX}px, ${event.clientY}px)`;
      setHover(event.clientX, event.clientY);
    },
    { passive: false },
  );

  window.addEventListener('pointerup', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const wasDrag = drag.moved;
    const tileId = drag.tileId;
    drag = null;
    dragLayer.innerHTML = '';
    dragLayer.classList.remove('is-dragging');
    clearHover();
    if (!wasDrag) return;
    suppressClick = true;
    const index = cellFromPoint(event.clientX, event.clientY);
    if (index === null) {
      ui.message = 'Dropped outside the board. The piece is still selected.';
      render();
      return;
    }
    if (ui.selected !== tileId) selectTile(tileId);
    targetCell(index);
  });

  window.addEventListener('pointercancel', () => {
    drag = null;
    dragLayer.innerHTML = '';
    dragLayer.classList.remove('is-dragging');
    clearHover();
  });

  root.addEventListener('click', (event) => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    const target = event.target as Element | null;
    if (!target) return;

    const actionEl = target.closest<HTMLElement>('[data-action]');
    if (actionEl) {
      switch (actionEl.dataset.action) {
        case 'rotate':
          rotate();
          return;
        case 'place':
          place();
          return;
        case 'cancel':
          cancel();
          return;
        case 'undo':
          undo();
          return;
        case 'new':
          newGame();
          return;
        case 'hints':
          ui.hints = !ui.hints;
          render();
          return;
        case 'rules':
          ui.showRules = !ui.showRules;
          render();
          return;
        case 'diagonal':
          toggleDiagonalRule();
          return;
        default:
          return;
      }
    }

    const tileBtn = target.closest<HTMLButtonElement>('.tile-btn');
    if (tileBtn && !tileBtn.disabled && tileBtn.dataset.tile) {
      selectTile(tileBtn.dataset.tile);
      return;
    }

    const hit = target.closest<SVGElement>('.cell-hit');
    if (hit?.dataset.index !== undefined) {
      targetCell(Number(hit.dataset.index));
    }
  });

  window.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    if (key === 'r') {
      rotate();
    } else if (key === 'enter' || key === ' ') {
      if (ui.pending !== null) {
        event.preventDefault();
        place();
      }
    } else if (key === 'escape') {
      cancel();
    } else if (key === 'u') {
      undo();
    } else if (key === 'h') {
      ui.hints = !ui.hints;
      render();
    } else if (key.startsWith('arrow')) {
      event.preventDefault();
      const cells = ui.selected ? legalCellsForTile(state(), ui.selected) : new Set<number>();
      if (ui.pending === null) {
        const first = cells.values().next();
        ui.pending = first.done ? 14 : first.value;
      } else {
        const row = Math.floor(ui.pending / 6);
        const col = ui.pending % 6;
        const nr = key === 'arrowup' ? row - 1 : key === 'arrowdown' ? row + 1 : row;
        const nc = key === 'arrowleft' ? col - 1 : key === 'arrowright' ? col + 1 : col;
        if (nr >= 0 && nr < 6 && nc >= 0 && nc < 6) ui.pending = nr * 6 + nc;
      }
      if (ui.selected !== null && ui.pending !== null) {
        const legal = firstLegalRotation(state(), ui.pending, ui.selected, ui.rotation);
        if (legal !== null) ui.rotation = legal;
      }
      render();
    }
  });

  autoSelect();
  render();
}
