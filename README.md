# Quads

A browser version of the tile matching board game **Quads** (Kris Burm / Gigamic), built for two
players sharing one screen. Touch first, no install, no server: the whole game runs client side and
is hosted on GitHub Pages.

## Play

On one screen there are two view modes, switched with the **View** button in the toolbar (or the `V`
key), and your choice is remembered:

- **Tabletop** — for a phone or tablet lying flat between the two players. Dark's tray and controls sit
  at the top of the screen rotated 180 degrees so they read correctly from the far side of the table.
- **Upright** — for a monitor or a propped up tablet. Nothing is drawn upside down; both players look
  at the screen the same way up and simply take turns using their own controls.

Games are saved as you play, so a refresh, a closed tab or a flat battery does not lose the position.
Reloading picks the game up exactly where you left it, undo history included. **New game** is the only
thing that clears it.

## Playing on two screens

Press **Two screens** in the toolbar and choose **Create a shared game**. You get a short game code
like `KMQ47F` and a link to send to the other player. Whoever creates the game plays Light and moves
first; whoever opens the link plays Dark. The other player can also type the code into the same dialog
and press Join.

In a shared game you only see your own pieces; your opponent's tray is drawn as face-down backs with a
count. Be aware this is a convenience rather than secrecy — in Quads each player holds every piece of
their own colour, so what is left in a hand can always be worked out from the board.

Other things worth knowing:

- The two browsers talk **directly to each other** over WebRTC. Nothing is hosted for this, which is
  why it works from a static site, but both pages have to stay open for moves to travel.
- The layout is always upright in a shared game, and your own tray is always the one nearest you.
- Refreshing either screen reconnects to the same game and the same colour.
- **Undo is only available in a one-screen game**, so there is nothing to dispute remotely.
- **Leave shared game** disconnects and hands the current position back to a single screen, where you
  can finish it face to face.
- If both players somehow end up on the same colour, the dialog offers to switch one of you. You can
  also force a side with `?seat=light` or `?seat=dark` on the link.

## Rules

- The board is 6x6, which is exactly the 36 pieces: 17 light, 17 dark and 2 neutral.
- Light opens by placing one neutral piece anywhere. Dark then places the other neutral piece, but
  not next to the first one.
- After that, players alternate placing one of their own pieces. A piece must border at least one
  piece already on the board, and every pair of touching sides must be identical:
  - light against light
  - dark against dark
  - lines along the edge against lines along the edge (vertical against vertical)
  - lines across the edge against lines across the edge (horizontal against horizontal)
- You may touch your opponent's pieces, and you may touch several pieces at once.
- Pieces may be rotated freely before being placed.
- The game ends as soon as the player to move has no legal placement. The other player wins.

An optional setting also forbids the second neutral piece from touching the first diagonally.

## Controls

- **Touch**: tap one of your pieces, then tap a cell to aim, then tap the same cell again to place.
  You can also drag a piece straight from your tray onto the board.
- **Rotate**: the Rotate button in your own panel, or the `R` key.
- **Place / clear**: the Place and Clear buttons, or `Enter` and `Escape`.
- **Undo, New game, Hints, View, Two screens**: the toolbar under the board; `U`, `H` and `V` are
  shortcuts for undo, hints and the view toggle.
- **Keyboard aiming**: arrow keys move the aim square once a piece is selected.

Green dots mark every legal cell for the selected piece. A green outline means the aimed placement is
legal; a red outline explains what does not match.

## How pieces are modelled

Each piece is four triangular quadrants, so it can be described by four side labels read North, East,
South, West:

- `L` solid light
- `D` solid dark
- `P` lines parallel to that side
- `X` lines perpendicular to that side

Rotation is a cyclic shift of those four labels, and two pieces match when the labels on their
touching sides are equal. The shared border is the same line for both pieces, so "parallel" means the
same absolute direction for both of them.

The full set falls out of one rule: a coloured piece uses only its own colour plus striped quadrants
and must have at least one of each. Up to rotation that gives exactly 17 pieces per colour, plus the
two fully striped symmetric pieces (`PPPP`, the concentric squares, and `XXXX`, the pinwheel) as the
neutral pieces. 17 + 17 + 2 = 36.

Open `?gallery` (for example `https://<user>.github.io/quads/?gallery`) to see every generated piece
with its side code, which is handy for comparing against the physical set. `?demo=N` opens a position
after N automatic legal moves, which is useful for checking the board rendering.

## Development

```bash
npm install
npm run dev        # local dev server
npm test           # engine unit tests and random self-play fuzz test
npm run typecheck  # TypeScript, no emit
npm run build      # production build into dist/
```

Layout:

- `src/engine` — pure game logic: piece set, rotation, matching, turn flow, endgame detection
- `src/state` — saved-game snapshots, game codes, replay-based restore, seat authority
- `src/net` — the Trystero peer-to-peer wrapper, loaded on demand only for shared games
- `src/render` — SVG generation for pieces and the board
- `src/ui` — interface, pointer/touch handling, share dialog, piece gallery
- `.github/workflows/deploy.yml` — test, build and publish to GitHub Pages

A saved game is stored as its options plus the move list, and restoring replays those moves through
the engine. That reproduces every intermediate position for undo, and means a corrupt or edited save
fails validation and is discarded instead of loading an illegal board. The same snapshot is what the
two screens exchange: whichever side is further ahead wins, so a reconnect resynchronises by itself.

## Deployment

Pushing to `main` runs the tests, builds with Vite and publishes `dist/` to GitHub Pages. Set
Settings → Pages → Build and deployment → Source to **GitHub Actions**. The build uses a relative
base path, so it works from a project page subpath.

Quads is a game by Kris Burm, published by Gigamic. This is an unofficial fan implementation of the
rules for personal use.
