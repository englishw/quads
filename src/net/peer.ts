import type { Player } from '../engine/types';
import type { Snapshot } from '../state/snapshot';

/**
 * Two-screen play uses WebRTC through Trystero, which finds the other browser over
 * public relays and then talks directly, peer to peer. Nothing is hosted for this,
 * which is what makes it work from a static GitHub Pages site.
 *
 * The library is imported dynamically so a game on one screen never downloads it,
 * and so a relay or network problem can never stop local play from working.
 */
const APP_ID = 'quads-gigamic-kburm-p2p-v1';
const ACTION = 'gamestate';

export type PeerStatus = 'idle' | 'connecting' | 'waiting' | 'connected' | 'error';

export interface StatePayload {
  seat: Player;
  snapshot: Snapshot;
}

export interface PeerHooks {
  onStatus: (status: PeerStatus, detail?: string) => void;
  onPayload: (payload: StatePayload) => void;
  /** Called when a peer appears, and whenever we broadcast, to get the latest state. */
  getPayload: () => StatePayload;
}

export interface PeerSession {
  readonly gameId: string;
  broadcast: () => void;
  leave: () => void;
}

// Structural subset of Trystero's API. Keeping our own shape here means a future
// version bump cannot silently change what we depend on.
interface Action<T> {
  send: (data: T, options?: { target?: string }) => Promise<void>;
  onMessage: ((data: T, context: { peerId: string }) => void) | null;
}

interface Room {
  makeAction: <T>(namespace: string) => Action<T>;
  onPeerJoin: ((peerId: string) => void) | null;
  onPeerLeave: ((peerId: string) => void) | null;
  leave: () => Promise<void>;
}

type JoinRoom = (
  config: { appId: string; password?: string },
  roomId: string,
  callbacks?: { onJoinError?: (details: { error: string }) => void },
) => Room;

export async function connectPeer(gameId: string, hooks: PeerHooks): Promise<PeerSession> {
  hooks.onStatus('connecting');
  const module = (await import('trystero')) as unknown as { joinRoom: JoinRoom };
  // The code doubles as the room name and as the encryption password, so only
  // someone holding the code can take part in the exchange.
  const room = module.joinRoom({ appId: APP_ID, password: gameId }, `quads-${gameId}`, {
    onJoinError: (details) => hooks.onStatus('error', details.error),
  });
  const action = room.makeAction<StatePayload>(ACTION);
  const peers = new Set<string>();

  const send = (target?: string) => {
    try {
      const promise = action.send(hooks.getPayload(), target ? { target } : undefined);
      void promise.catch(() => {
        /* A dropped send is recovered by the next broadcast or reconnect. */
      });
    } catch {
      /* Ignore: the connection may be closing. */
    }
  };

  action.onMessage = (data) => {
    if (data && typeof data === 'object' && 'snapshot' in data) hooks.onPayload(data);
  };

  room.onPeerJoin = (peerId) => {
    peers.add(peerId);
    hooks.onStatus('connected');
    // Tell the newcomer where the game stands; whoever is further ahead wins.
    send(peerId);
  };

  room.onPeerLeave = (peerId) => {
    peers.delete(peerId);
    hooks.onStatus(peers.size > 0 ? 'connected' : 'waiting');
  };

  hooks.onStatus('waiting');

  return {
    gameId,
    broadcast: () => {
      if (peers.size > 0) send();
    },
    leave: () => {
      room.onPeerJoin = null;
      room.onPeerLeave = null;
      action.onMessage = null;
      peers.clear();
      void room.leave().catch(() => {
        /* Nothing useful to do if teardown fails. */
      });
      hooks.onStatus('idle');
    },
  };
}
