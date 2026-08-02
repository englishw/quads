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
import { tileById, tileIdsFor } from '../engine/tiles';
import { boardSvg, type Ghost } from '../render/board';
import { tileSvg } from '../render/tile';
import {
  compareSnapshots,
  createGameId,
  decodeSnapshot,
  encodeSnapshot,
  extractGameId,
  hasAmbiguousCharacters,
  isValidGameId,
  makeSnapshot,
  normalizeGameId,
  parseSnapshot,
  restoreHistory,
  type PlayMode,
  type Snapshot,
} from '../state/snapshot';
import {
  canPlayTurn,
  canUndo,
  controlsSeat,
  isTrayHidden,
  nearSeat,
  opponentOf,
  waitingForOpponent,
  type SeatInfo,
} from '../state/session';
import {
  connectRelay,
  type RelaySession,
  type RelayStatus,
  type StatePayload,
} from '../net/relay';

/**
 * 'tabletop' suits a device lying flat between the players: Dark's tray is rotated
 * 180 degrees so it reads from the far side. 'upright' suits a monitor or a propped
 * up tablet, where both players look at the screen the same way up and simply take
 * turns, so nothing is ever drawn upside down. A shared game is always upright.
 */
type ViewMode = 'tabletop' | 'upright';

interface UiState {
  selected: string | null;
  pending: number | null;
  rotation: Rotation;
  hints: boolean;
  message: string;
  showRules: boolean;
  showShare: boolean;
  showQuickStart: boolean;
  joinCode: string;
  view: ViewMode;
}

interface Session {
  mode: PlayMode;
  seat: Player;
  gameId: string;
  /** Bumped by every new game so two screens can tell a reset from an old position. */
  epoch: number;
  peer: RelaySession | null;
  status: RelayStatus;
  detail: string;
  opponentSeat: Player | null;
}

const PLAYER_NAMES: Record<Player, string> = { light: 'Light', dark: 'Dark' };
const VIEW_NAMES: Record<ViewMode, string> = { tabletop: 'Tabletop', upright: 'Upright' };
const VIEW_STORAGE_KEY = 'quads.view';
const QUICK_START_STORAGE_KEY = 'quads.quickstart.v1';
const SAVE_STORAGE_KEY = 'quads.save.v1';

const STATUS_LABELS: Record<RelayStatus, string> = {
  idle: 'Not connected',
  connecting: 'Connecting',
  waiting: 'Waiting for the other player',
  connected: 'Connected',
  error: 'Connection problem',
};

function loadViewMode(): ViewMode {
  try {
    return localStorage.getItem(VIEW_STORAGE_KEY) === 'upright' ? 'upright' : 'tabletop';
  } catch {
    // Private browsing modes can throw on storage access; the default is fine.
    return 'tabletop';
  }
}

function saveViewMode(view: ViewMode): void {
  try {
    localStorage.setItem(VIEW_STORAGE_KEY, view);
  } catch {
    // Not being able to remember the choice is not worth interrupting the game.
  }
}

function loadQuickStartSeen(): boolean {
  try {
    return localStorage.getItem(QUICK_START_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function saveQuickStartSeen(): void {
  try {
    localStorage.setItem(QUICK_START_STORAGE_KEY, 'true');
  } catch {
    // Not being able to remember the choice is not worth interrupting the game.
  }
}

function readSavedGame(): Snapshot | null {
  try {
    return decodeSnapshot(localStorage.getItem(SAVE_STORAGE_KEY));
  } catch {
    return null;
  }
}

function writeSavedGame(snapshot: Snapshot): void {
  try {
    localStorage.setItem(SAVE_STORAGE_KEY, encodeSnapshot(snapshot));
  } catch {
    // A game that cannot be saved is still perfectly playable.
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

export function mountGame(
  root: HTMLElement,
  dragLayer: HTMLElement,
  options: { demoMoves?: number; view?: ViewMode; gameId?: string; seat?: Player } = {},
): void {
  let ui: UiState = {
    selected: null,
    pending: null,
    rotation: 0,
    hints: true,
    message: 'Light opens by placing a neutral piece anywhere on the board.',
    showRules: false,
    showShare: false,
    showQuickStart: !loadQuickStartSeen(),
    joinCode: '',
    view: options.view ?? loadViewMode(),
  };
  if (options.view) saveViewMode(options.view);

  let states: GameState[] = [];
  let session: Session = {
    mode: 'hotseat',
    seat: 'light',
    gameId: createGameId(),
    epoch: 0,
    peer: null,
    status: 'idle',
    detail: '',
    opponentSeat: null,
  };

  const state = () => states[states.length - 1];
  const seatInfo = (): SeatInfo => ({ mode: session.mode, seat: session.seat });
  const effectiveView = (): ViewMode => (session.mode === 'remote' ? 'upright' : ui.view);

  // --- start up: a shared link first, then a saved game, then a fresh game ---

  function loadSnapshot(snapshot: Snapshot): boolean {
    const restored = restoreHistory(snapshot);
    if (!restored) return false;
    states = restored;
    session = {
      ...session,
      mode: snapshot.mode,
      seat: snapshot.seat,
      gameId: snapshot.gameId,
      epoch: snapshot.epoch,
    };
    return true;
  }

  const linkedGameId = normalizeGameId(options.gameId);
  const saved = readSavedGame();
  let started = false;

  if (isValidGameId(linkedGameId)) {
    const rejoined = Boolean(saved && saved.gameId === linkedGameId && loadSnapshot(saved));
    if (rejoined) {
      // Returning to a shared game we were already playing, seat and all.
      session.mode = 'remote';
    } else {
      // Someone shared this link with us, so we take the Dark seat and pick up the
      // host's position and tray order once the connection is established.
      states = [createGame({ seed: 1 })];
      session = { ...session, mode: 'remote', seat: 'dark', gameId: linkedGameId, epoch: 0 };
    }
    // `?seat=light` or `?seat=dark` claims a side explicitly, which settles the case
    // where both players opened the same link.
    if (options.seat) session.seat = options.seat;
    ui.message = rejoined
      ? `Rejoining game ${session.gameId}. You are ${PLAYER_NAMES[session.seat]}.`
      : `Joined game ${session.gameId} as ${PLAYER_NAMES[session.seat]}.`;
    started = true;
  } else if (saved && loadSnapshot(saved)) {
    ui.message =
      saved.mode === 'remote'
        ? `Rejoining game ${session.gameId}. You are ${PLAYER_NAMES[session.seat]}.`
        : 'Game restored where you left off.';
    started = true;
  }

  if (!started) {
    states = [createGame({ seed: Date.now() % 100000 })];

    // `?demo=N` plays N random legal moves before handing over, which makes it easy
    // to inspect a mid-game position. It never disturbs a saved or shared game.
    const demoMoves = options.demoMoves ?? 0;
    for (let i = 0; i < demoMoves; i += 1) {
      const moves = legalMoves(state());
      if (moves.length === 0) break;
      states = [...states, applyMove(state(), moves[i % moves.length])];
    }
    if (demoMoves > 0) {
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
  }

  // --- saving, sharing, syncing --------------------------------------------

  function currentSnapshot(): Snapshot {
    return makeSnapshot(state(), {
      gameId: session.gameId,
      epoch: session.epoch,
      mode: session.mode,
      seat: session.seat,
    });
  }

  function persist(): void {
    writeSavedGame(currentSnapshot());
  }

  function syncUrl(): void {
    try {
      const url = new URL(location.href);
      url.searchParams.delete('demo');
      if (session.mode === 'remote') url.searchParams.set('game', session.gameId);
      else url.searchParams.delete('game');
      window.history.replaceState(null, '', url.toString());
    } catch {
      // A browser that refuses history rewriting still plays fine.
    }
  }

  function shareLink(): string {
    return `${location.origin}${location.pathname}?game=${session.gameId}`;
  }

  function broadcast(): void {
    session.peer?.broadcast();
  }

  function handlePayload(payload: StatePayload): void {
    const remote = parseSnapshot(payload?.snapshot);
    if (!remote) return;
    session.opponentSeat =
      payload.seat === 'light' || payload.seat === 'dark' ? payload.seat : null;

    const decision = compareSnapshots(currentSnapshot(), remote, session.seat);
    if (decision === 'adopt') {
      const restored = restoreHistory(remote);
      if (!restored) return;
      states = restored;
      session.epoch = remote.epoch;
      ui.selected = null;
      ui.pending = null;
      ui.rotation = 0;
      const s = state();
      ui.message =
        s.phase === 'finished'
          ? `${PLAYER_NAMES[s.winner as Player]} wins.`
          : s.turn === session.seat
            ? 'Your turn.'
            : `Waiting for ${PLAYER_NAMES[opponentOf(session.seat)]} to move.`;
      autoSelect();
      persist();
      render();
    } else if (decision === 'keep') {
      // We are further along, so push our position back to the other screen.
      broadcast();
    }
    // 'same' needs nothing: heartbeats repeat the current position, and any status
    // change is rendered by the status hook instead.
  }

  async function connect(): Promise<void> {
    if (session.mode !== 'remote' || session.peer) return;
    try {
      session.peer = await connectRelay(session.gameId, {
        onStatus: (status, detail) => {
          session.status = status;
          session.detail = detail ?? '';
          render();
        },
        onPayload: handlePayload,
        getPayload: () => ({ seat: session.seat, snapshot: currentSnapshot() }),
      });
      broadcast();
    } catch (error) {
      session.status = 'error';
      session.detail = error instanceof Error ? error.message : 'could not start the connection';
      render();
    }
  }

  function startShared(): void {
    session.peer?.leave();
    const blockDiagonalOpening = state().options.blockDiagonalOpening;
    const requireBoardEdgeMatch = state().options.requireBoardEdgeMatch;
    session = {
      ...session,
      mode: 'remote',
      seat: 'light',
      gameId: createGameId(),
      epoch: session.epoch + 1,
      peer: null,
      status: 'connecting',
      detail: '',
      opponentSeat: null,
    };
    states = [createGame({ seed: Date.now() % 100000, blockDiagonalOpening, requireBoardEdgeMatch })];
    ui = { ...ui, selected: null, pending: null, rotation: 0, showShare: true, showRules: false };
    ui.message = `Shared game ${session.gameId} created. Send the link to the other player.`;
    autoSelect();
    persist();
    syncUrl();
    render();
    void connect();
  }

  function joinShared(rawCode: string): void {
    // Codes are generated without I, O, 0 or 1, so seeing one means the code was
    // misread. Quietly dropping the character would join a different, empty game.
    if (hasAmbiguousCharacters(rawCode)) {
      ui.message =
        'Game codes never contain I, O, 0 or 1. Check those characters and try again.';
      render();
      return;
    }
    const code = extractGameId(rawCode);
    if (!isValidGameId(code)) {
      ui.message = 'That game code does not look right.';
      render();
      return;
    }
    session.peer?.leave();
    session = {
      ...session,
      mode: 'remote',
      seat: 'dark',
      gameId: code,
      epoch: 0,
      peer: null,
      status: 'connecting',
      detail: '',
      opponentSeat: null,
    };
    states = [createGame({ seed: 1 })];
    ui = { ...ui, selected: null, pending: null, rotation: 0, joinCode: '' };
    ui.message = `Joining game ${code} as Dark.`;
    persist();
    syncUrl();
    render();
    void connect();
  }

  function leaveShared(): void {
    session.peer?.leave();
    session = {
      ...session,
      mode: 'hotseat',
      peer: null,
      status: 'idle',
      detail: '',
      opponentSeat: null,
    };
    ui.showShare = false;
    ui.message = 'Left the shared game. You can finish this position on one screen.';
    autoSelect();
    persist();
    syncUrl();
    render();
  }

  function switchSeat(): void {
    session.seat = opponentOf(session.seat);
    session.opponentSeat = null;
    ui.selected = null;
    ui.pending = null;
    ui.message = `You are now ${PLAYER_NAMES[session.seat]}.`;
    autoSelect();
    persist();
    broadcast();
    render();
  }

  function copyShareLink(): void {
    const link = shareLink();
    const clipboard = navigator.clipboard;
    if (clipboard && typeof clipboard.writeText === 'function') {
      void clipboard.writeText(link).then(
        () => {
          ui.message = 'Link copied.';
          render();
        },
        () => {
          ui.message = 'Could not copy automatically. Select the link and copy it.';
          render();
        },
      );
      return;
    }
    root.querySelector<HTMLInputElement>('[data-field="share-link"]')?.select();
    ui.message = 'Select the link and copy it.';
    render();
  }

  // --- game actions ---------------------------------------------------------

  function autoSelect(): void {
    const s = state();
    const available = availableTileIds(s);
    if (ui.selected && available.includes(ui.selected)) return;
    const mayPlay = canPlayTurn(s, seatInfo());
    ui.selected = mayPlay && s.phase === 'opening' && available.length > 0 ? available[0] : null;
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

  function notYourTurnMessage(): string {
    const s = state();
    if (s.phase === 'finished') return 'The game is over.';
    return `It is ${PLAYER_NAMES[s.turn]}'s turn on the other screen.`;
  }

  function selectTile(tileId: string): void {
    if (!canPlayTurn(state(), seatInfo())) {
      ui.message = notYourTurnMessage();
      render();
      return;
    }
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
    if (!canPlayTurn(state(), seatInfo())) {
      ui.message = notYourTurnMessage();
      render();
      return;
    }
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
    const game = state();
    if (game.phase === 'opening') {
      ui.message = 'The opening neutral piece is fixed in its starting orientation.';
      render();
      return;
    }
    if (!ui.selected) {
      ui.message = canPlayTurn(game, seatInfo())
        ? 'Choose one of your pieces first.'
        : notYourTurnMessage();
      render();
      return;
    }
    const options = distinctRotations(tileById(ui.selected).sides);
    if (options.length <= 1) {
      ui.message = 'This piece looks the same in every rotation.';
      render();
      return;
    }
    const currentIndex = options.indexOf(ui.rotation);
    ui.rotation = options[(currentIndex + 1) % options.length];
    if (ui.pending !== null) {
      const check = isLegalMove(state(), ui.pending, ui.selected, ui.rotation);
      ui.message = check.ok ? 'This rotation fits. Press Place to confirm.' : check.reason;
    }
    render();
  }

  function place(): void {
    if (ui.selected === null || ui.pending === null) return;
    if (!canPlayTurn(state(), seatInfo())) {
      ui.message = notYourTurnMessage();
      render();
      return;
    }
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
    states = [...states, next];
    ui.selected = null;
    ui.pending = null;
    ui.rotation = 0;
    if (next.phase === 'finished') {
      ui.message = `${PLAYER_NAMES[next.turn]} has no legal move. ${PLAYER_NAMES[next.winner as Player]} wins.`;
    } else if (next.phase === 'opening') {
      ui.message = 'Dark places the other neutral piece, but not next to the first one.';
    } else if (session.mode === 'remote') {
      ui.message = `Waiting for ${PLAYER_NAMES[opponentOf(session.seat)]} to move.`;
    } else {
      const count = legalMoves(next).length;
      ui.message = `${PLAYER_NAMES[next.turn]} to play. ${count} legal move${count === 1 ? '' : 's'} available.`;
    }
    autoSelect();
    persist();
    broadcast();
    render();
  }

  function cancel(): void {
    ui.pending = null;
    ui.rotation = 0;
    ui.message = 'Aim cleared.';
    render();
  }

  function undo(): void {
    if (!canUndo(seatInfo(), states.length)) {
      ui.message =
        session.mode === 'remote'
          ? 'Undo is only available in a one-screen game.'
          : 'Nothing to undo.';
      render();
      return;
    }
    states = states.slice(0, -1);
    ui.selected = null;
    ui.pending = null;
    ui.rotation = 0;
    ui.message = `Move undone. ${PLAYER_NAMES[state().turn]} to play.`;
    autoSelect();
    persist();
    render();
  }

  function newGame(): void {
    states = [
      createGame({
        seed: Date.now() % 100000,
        blockDiagonalOpening: state().options.blockDiagonalOpening,
      }),
    ];
    session.epoch += 1;
    ui = {
      ...ui,
      selected: null,
      pending: null,
      rotation: 0,
      message: 'New game. Light opens by placing a neutral piece anywhere on the board.',
    };
    autoSelect();
    persist();
    broadcast();
    render();
  }

  function setViewMode(view: ViewMode): void {
    ui.view = view;
    saveViewMode(view);
    ui.message =
      view === 'tabletop'
        ? 'Tabletop view: Dark reads from the far side of the screen.'
        : 'Upright view: both players read the screen the same way up.';
    render();
  }

  function toggleViewMode(): void {
    if (session.mode === 'remote') {
      ui.message = 'A shared game always stays upright on both screens.';
      render();
      return;
    }
    setViewMode(ui.view === 'tabletop' ? 'upright' : 'tabletop');
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
    states = [...states.slice(0, -1), next];
    persist();
    render();
  }

  function closeQuickStart(): void {
    ui.showQuickStart = false;
    saveQuickStartSeen();
    render();
  }

  function toggleEdgeRule(): void {
    const current = state();
    if (current.history.length > 0) {
      ui.message = 'Board-edge rule changes take effect on the next new game.';
    }
    const next: GameState = {
      ...current,
      options: { ...current.options, requireBoardEdgeMatch: !current.options.requireBoardEdgeMatch },
    };
    states = [...states.slice(0, -1), next];
    persist();
    render();
  }

  // --- markup ---------------------------------------------------------------

  function panelMarkup(player: Player): string {
    const s = state();
    const info = seatInfo();
    const mine = controlsSeat(info, player);
    const active = s.phase !== 'finished' && s.turn === player && mine;
    const hand = s.hands[player];
    const hidden = isTrayHidden(info, player);
    const openingPiece = s.phase === 'opening' && active ? availableTileIds(s)[0] : null;

    let tray: string;
    let label: string;
    if (hidden) {
      // Only piece backs reach the DOM, so the opponent's tray really is unread.
      tray = hand
        .map(() => `<span class="tile-back tile-back--${player}" aria-hidden="true"></span>`)
        .join('');
      label = `${hand.length} pieces, hidden`;
    } else {
      // Both players keep their pieces face up in a one-screen game; during the
      // opening only the neutral piece can actually be played.
      const tiles = openingPiece ? [openingPiece, ...hand] : hand;
      tray = tiles
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
      label = openingPiece
        ? `Place the neutral piece &middot; ${hand.length} of your own`
        : `${hand.length} pieces left`;
    }

    const youBadge =
      session.mode === 'remote' && info.seat === player ? '<span class="badge">You</span>' : '';
    const statusWord = active
      ? 'Your turn'
      : s.turn === player && s.phase !== 'finished'
        ? 'Thinking'
        : 'Waiting';
    const controls = mine
      ? `<div class="panel__controls">
          <button type="button" class="btn" data-action="rotate"${active && openingPiece === null ? '' : ' disabled'}>Rotate</button>
          <button type="button" class="btn btn--primary" data-action="place"${active && ghost()?.valid ? '' : ' disabled'}>Place</button>
          <button type="button" class="btn" data-action="cancel"${active && ui.pending !== null ? '' : ' disabled'}>Clear</button>
        </div>`
      : '';

    return `
      <section class="panel panel--${player}${active ? ' is-active' : ''}" data-player="${player}">
        <header class="panel__bar">
          <span class="panel__name">${PLAYER_NAMES[player]}</span>${youBadge}
          <span class="panel__status">${statusWord}</span>
          <span class="panel__count">${label}</span>
        </header>
        ${controls}
        <div class="tray" role="group" aria-label="${PLAYER_NAMES[player]} pieces">${tray}</div>
      </section>`;
  }

  function rulesMarkup(): string {
    if (!ui.showRules) return '';
    const s = state();
    const viewSection =
      session.mode === 'remote'
        ? '<p class="note">A shared game always stays upright on both screens.</p>'
        : `<div class="segment" role="group" aria-label="View mode">
          <button type="button" class="btn${ui.view === 'tabletop' ? ' is-on' : ''}" data-action="view-tabletop" aria-pressed="${ui.view === 'tabletop'}">Tabletop &mdash; device lies flat, Dark's tray is upside down</button>
          <button type="button" class="btn${ui.view === 'upright' ? ' is-on' : ''}" data-action="view-upright" aria-pressed="${ui.view === 'upright'}">Upright &mdash; screen stands up, both players take turns the same way up</button>
        </div>`;
    return `
      <div class="dialog" role="dialog" aria-label="Rules and settings">
        <h2>How to play</h2>
        <p class="note">Light opens with a neutral piece anywhere on the board. Dark then places the other neutral piece, but not next to the first one.</p>
        <ul>
          <li>Place one of your own pieces each turn so it touches at least one piece already on the board.</li>
          <li>Every pair of touching sides must match: the same color meets the same color, and the same line style meets the same line style.</li>
          <li>You can touch your opponent's pieces and several pieces at once.</li>
          <li>If the player to move has no legal placement, the other player wins.</li>
        </ul>
        <h2>View</h2>
        ${viewSection}
        <h2>Settings</h2>
        <label class="check">
          <input type="checkbox" data-action="diagonal" ${s.options.blockDiagonalOpening ? 'checked' : ''}/>
          Opening: the second neutral piece may not touch diagonally either
        </label>
        <label class="check">
          <input type="checkbox" data-action="edge" ${s.options.requireBoardEdgeMatch ? 'checked' : ''}/>
          Board edge: border-facing sides must match the board edge style
        </label>
        <button type="button" class="btn" data-action="rules">Close</button>
      </div>`;
  }

  function quickStartMarkup(): string {
    if (!ui.showQuickStart) return '';
    return `
      <div class="quick-start" role="dialog" aria-label="Quick start">
        <div class="quick-start__card">
          <h2>Quick start</h2>
          <p class="note">Light opens with a neutral piece anywhere on the board. Dark then places the other neutral piece, but not next to the first one.</p>
          <p class="note">After that, place one of your own pieces so it touches at least one piece already on the board, and make every touching side match.</p>
          <div class="quick-start__previews" aria-hidden="true">
            ${tileIdsFor('neutral')
              .map((tileId) => `
                <div class="quick-start__preview">
                  ${tileSvg(tileById(tileId).sides, 0, { className: 'quick-start-svg' })}
                </div>`)
              .join('')}
          </div>
          <button type="button" class="btn btn--primary" data-action="quickstart-close">Start playing</button>
        </div>
      </div>`;
  }

  function shareMarkup(): string {
    if (!ui.showShare) return '';
    if (session.mode === 'hotseat') {
      return `
        <div class="dialog" role="dialog" aria-label="Play on two screens">
          <h2>Play on two screens</h2>
          <p class="note">Each player uses their own device and sees only their own pieces. Moves are relayed through public message brokers, so this works across different networks and the other player does not have to be online at the same time. Undo is only available in a one-screen game.</p>
          <button type="button" class="btn btn--primary" data-action="share-create">Create a shared game</button>
          <h2>Join a game</h2>
          <div class="share-row">
            <input class="input" data-field="join-code" value="${escapeHtml(ui.joinCode)}" placeholder="Game code or link" maxlength="200" autocapitalize="characters" spellcheck="false" aria-label="Game code or link"/>
            <button type="button" class="btn" data-action="share-join">Join</button>
          </div>
          <button type="button" class="btn" data-action="share">Close</button>
        </div>`;
    }
    const conflict =
      session.opponentSeat === session.seat
        ? `<p class="note note--warn">The other screen is also playing ${PLAYER_NAMES[session.seat]}. One of you should switch.</p>
           <button type="button" class="btn" data-action="share-switch">Switch me to ${PLAYER_NAMES[opponentOf(session.seat)]}</button>`
        : '';
    return `
      <div class="dialog" role="dialog" aria-label="Shared game">
        <h2>Shared game ${session.gameId}</h2>
        <p class="note">You are <strong>${PLAYER_NAMES[session.seat]}</strong>. Status: ${STATUS_LABELS[session.status]}${session.detail ? ` (${escapeHtml(session.detail)})` : ''}.</p>
        <div class="share-row">
          <input class="input" data-field="share-link" value="${escapeHtml(shareLink())}" readonly aria-label="Link to share"/>
          <button type="button" class="btn" data-action="share-copy">Copy</button>
        </div>
        <p class="note">Send that link, or just the code <strong>${session.gameId}</strong>, to the other player. Refreshing either screen reconnects to this game, and the latest position is waiting whenever the other player opens it.</p>
        ${conflict}
        <button type="button" class="btn" data-action="share-leave">Leave shared game</button>
        <button type="button" class="btn" data-action="share">Close</button>
      </div>`;
  }

  function resultMarkup(): string {
    const s = state();
    if (s.phase !== 'finished' || !s.winner) return '';
    const text = `${PLAYER_NAMES[s.winner]} wins — ${PLAYER_NAMES[s.turn]} has no legal move.`;
    // In tabletop view the result is repeated upside down so both sides can read it.
    const flipped =
      effectiveView() === 'tabletop'
        ? `<p class="result__text result__text--flipped">${text}</p>`
        : '';
    return `
      <div class="result" role="alert">
        ${flipped}
        <p class="result__text">${text}</p>
        <button type="button" class="btn btn--primary" data-action="new">New game</button>
      </div>`;
  }

  function statusLine(): string {
    const s = state();
    if (session.mode === 'remote' && session.status !== 'connected' && s.phase !== 'finished') {
      const detail = session.detail ? ` (${escapeHtml(session.detail)})` : '';
      return `${STATUS_LABELS[session.status]}${detail} &middot; code ${session.gameId}`;
    }
    if (waitingForOpponent(s, seatInfo())) {
      return `Waiting for ${PLAYER_NAMES[opponentOf(session.seat)]} to move.`;
    }
    return ui.message;
  }

  function toolbarMarkup(): string {
    const remote = session.mode === 'remote';
    const undoAllowed = canUndo(seatInfo(), states.length);
    const viewButton = remote
      ? ''
      : `<button type="button" class="btn" data-action="view" title="Switch between a flat tabletop layout and an upright screen layout">View: ${VIEW_NAMES[ui.view]}</button>`;
    const pill = remote
      ? `<span class="pill pill--${session.status}">${STATUS_LABELS[session.status]}</span>`
      : '';
    return `
      <div class="toolbar">
        <button type="button" class="btn" data-action="undo"${undoAllowed ? '' : ' disabled'} title="${remote ? 'Undo is only available in a one-screen game' : 'Take back the last move'}">Undo</button>
        <button type="button" class="btn" data-action="new">New game</button>
        <button type="button" class="btn" data-action="hints" aria-pressed="${ui.hints}">Hints ${ui.hints ? 'on' : 'off'}</button>
        ${viewButton}
        <button type="button" class="btn" data-action="share">${remote ? `Game ${session.gameId}` : 'Two screens'}</button>
        <button type="button" class="btn" data-action="rules">Rules</button>
        ${pill}
        <span class="counter">${placedCount(state())} / 36 placed</span>
      </div>`;
  }

  function render(): void {
    const s = state();
    const near = nearSeat(seatInfo());
    const far = opponentOf(near);
    const view = {
      legalCells: legalCells(),
      ghost: ghost(),
      lastMoveIndex: s.history.length > 0 ? s.history[s.history.length - 1].index : null,
    };
    root.innerHTML = `
      <div class="table" data-turn="${s.turn}" data-phase="${s.phase}" data-view="${effectiveView()}" data-mode="${session.mode}">
        ${panelMarkup(far)}
        <div class="board-area">
          <div class="board-wrap">${boardSvg(s, view)}</div>
          <p class="status" role="status" aria-live="polite">${statusLine()}</p>
          ${toolbarMarkup()}
          ${quickStartMarkup()}
          ${rulesMarkup()}
          ${shareMarkup()}
          ${resultMarkup()}
        </div>
        ${panelMarkup(near)}
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

  root.addEventListener('input', (event) => {
    const target = event.target as HTMLInputElement | null;
    if (target?.dataset.field === 'join-code') {
      // Kept exactly as typed, without a re-render, so the caret does not jump and a
      // pasted share link still works. It is interpreted when Join is pressed.
      ui.joinCode = target.value;
    }
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
          if (ui.showRules) ui.showShare = false;
          render();
          return;
        case 'quickstart-close':
          closeQuickStart();
          return;
        case 'view':
          toggleViewMode();
          return;
        case 'view-tabletop':
          setViewMode('tabletop');
          return;
        case 'view-upright':
          setViewMode('upright');
          return;
        case 'diagonal':
          toggleDiagonalRule();
          return;
        case 'edge':
          toggleEdgeRule();
          return;
        case 'share':
          ui.showShare = !ui.showShare;
          if (ui.showShare) ui.showRules = false;
          render();
          return;
        case 'share-create':
          startShared();
          return;
        case 'share-join':
          joinShared(ui.joinCode);
          return;
        case 'share-copy':
          copyShareLink();
          return;
        case 'share-leave':
          leaveShared();
          return;
        case 'share-switch':
          switchSeat();
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
    const target = event.target as HTMLElement | null;
    // Never treat typing in a field as a game shortcut.
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
      if (event.key === 'Enter' && target.dataset.field === 'join-code') joinShared(ui.joinCode);
      return;
    }
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
    } else if (key === 'v') {
      toggleViewMode();
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
  persist();
  syncUrl();
  render();
  if (session.mode === 'remote') void connect();
}
