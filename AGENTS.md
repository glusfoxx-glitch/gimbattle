<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- The game lives as untouched vanilla JS in public/gim/ (client, shared, server/room.js) and is shown full-screen by src/routes/index.tsx via iframe; keep game logic identical to the original archive.
- Multiplayer is peer-to-peer WebRTC (public/gim/client/p2p.js): the host's browser runs the authoritative Room, guests connect by room code through PeerJS signaling — there is no backend server.
- Signaling reconnection must preserve the existing HostServer; retire guest attempt identity before destroying a Peer so stale events cannot terminate its replacement. Player capacity must fit the 32-bit hit masks and compact entity references.
- The host Room advances each player's simulation only with that player's inputs (short starvation waits, then neutral steps) so client prediction matches the server exactly; Net resets input sequence and clock on every new session.
- Automated game tests live in gim-tests/ (run: `node gim-tests/selftest.mjs`, `node --import ./gim-tests/register.mjs gim-tests/run-netsim.mjs` and `.../run-abilities.mjs`); they drive the real Room/Net code over a simulated network and must pass after any game or network change.

- End-of-round results (podium, K.O./deaths) are sent by the host Room as a 'results' text message; character changes use a 'pick' message accepted only during the end-of-round pause, so the swap applies at the next respawn without desyncing prediction.
- Balance-patch rules are covered by gim-tests/run-patch.mjs (run with plain node); update it when the user changes character values.
