# Minecraft Clone

A voxel sandbox built with **Three.js** and a small **WebSocket** multiplayer server.

## Features

- Fixed **100×100** chunked world (grass, dirt, stone, ores, trees, water, wildflowers)
- **Flowers** (poppy, dandelion, blue orchid, pink tulip) placeable on grass only
- Toads and food spawn randomly across the whole map (not around the player)
- **Mine** blocks with left click (bedrock is unbreakable)
- **Place** blocks with right click (hotbar / scroll / number keys)
- **Multiplayer** — open the same URL in multiple tabs/browsers; each player gets a random username and appears as an avatar with a nametag
- Shared world edits (dig/place sync to everyone)

## Controls

### Desktop

| Input | Action |
|--------|--------|
| Click | Capture mouse / start playing |
| WASD | Move |
| Space | Jump |
| Shift | Sprint |
| Left mouse | Break block |
| Right mouse | Place block |
| Scroll / 1–9 | Select block type |
| **T** | Open chat |
| Place **Sign** block | Write a message (faces you when placed) |

### Critters

- **Toads** wander, **jump** over steps, and hop while exploring
- **Food** (red berries) sprouts on grass every few seconds
- Hungry toads seek and eat food; eating fills hunger and a **breeding reserve** (gold tick on the bar)
- Two well-fed toads that meet will **reproduce**; offspring inherit a blend of both parents' green↔brown gene with a small mutation

Chat commands (local, press **T**):

| Command | Effect |
|---------|--------|
| `/help` | List all commands |
| `/survival` | Survival mode (10 hearts, 10 hunger, mine for items) |
| `/creative` | Creative mode (unlimited blocks, no vitals) |
| `/foodrateincrease` | Spawn food more often |
| `/foodratedecrease` | Spawn food less often |
| `/foodrate` | Show current food rate |
| `/toadmetincrease` | More toads / faster breeding |
| `/toadmetdecrease` | Fewer toads / slower breeding |
| `/toadmet` | Show toad population rate |
| `/summontoads` | Summon 100 toads |
| `/summontoadsN` | Summon N toads (e.g. `/summontoads50`) |
| `/cleartoads` | Remove all toads and food |
| `/time` | Day/night status |
| `/save` | Force-save world to server |

### Day / night & lights

- **5 minute day**, **3 minute night** with moving sun and moon
- Sky, fog, and ambient light follow the cycle
- Place **Torch** blocks for night lighting (hotbar)

### Persistence

Block edits, signs, toads, food, and time of day are saved on the server (`data/world-save.json`) so players can leave and rejoin later.

### Mobile / touch

On phones and tablets, on-screen controls appear automatically (or force with `?mobile=1`):

| Control | Action |
|---------|--------|
| Left joystick | Move |
| Drag on screen | Look around |
| **Jump** | Jump |
| **Sprint** | Sprint |
| **Mine** ⛏ | Break block under crosshair |
| **Place** ▣ | Place selected block |
| Hotbar / ◀ ▶ | Select block type |
| 💬 button | Open chat |

## Run

```bash
npm install
npm run dev
```

Then open **http://localhost:3010** (or the port in `PORT`).

### Public URL (Cloudflare Tunnel)

Players join at:

**https://blockworld.immenseaccumulationonline.online**

That hostname is routed by Cloudflare Tunnel (`cloudflared`) to `http://localhost:3010`.  
Multiplayer uses **WSS** on the same host: `wss://blockworld.immenseaccumulationonline.online/ws`.

Ingress is defined in `~/.cloudflared/config.yml`. After editing it, reload the tunnel:

```bash
sudo systemctl restart cloudflared
# or, if started manually:
# cloudflared tunnel --config ~/.cloudflared/config.yml run brubaker-home-tunnel
```

The game server must be listening on port **3010** (PM2 app `minecraft-clone` or `npm run dev`).

For a production-style run:

```bash
npm run build
npm start
```

## Tests

```bash
npm test
```

Headless checks cover terrain generation, meshing, face culling, mining/placement, and voxel raycasts.

## Architecture

- `src/main.js` — game loop, input, mining/placing, multiplayer hooks
- `src/world.js` — chunks, terrain, meshing, voxel DDA raycast
- `src/player.js` — first-person physics + collision
- `src/blocks.js` — block type definitions
- `src/network.js` — WebSocket client
- `src/remotePlayers.js` — other players’ avatars
- `server/game-server.js` — HTTP (Vite middleware or static `dist/`) + WebSocket hub
