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
