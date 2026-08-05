# mehro

personal portfolio site with live discord status, spotify integration, and music history.

live at [mehro.me](https://mehro.me)

## how it works

a node.js server runs a discord bot in the same process, reads your presence from a shared server (status, spotify activity, avatar, banner), and exposes it through a small REST API the frontend polls.

if you don't want to run your own bot, [Lanyard](https://github.com/Phineas/lanyard) is a community-hosted presence API that does the same thing, just join their discord server and query the API.

view counter is self-hosted SQLite, no external service.

## stack

- **node.js** + **express** (serves the site and the API)
- **discord.js** (connects to discord gateway to read presence)
- **better-sqlite3** (local view counter)
- **vanilla HTML/CSS/JS** (no frontend framework)

## external services

| service | what for |
|---|---|
| [lrclib.net](https://lrclib.net) | synced and unsynced lyrics, no API key needed |
| [api.stats.fm](https://api.stats.fm) | recent streams and top tracks (profile must be public) |
| `scannables.scdn.co` | spotify scan codes as SVG |

## environment variables

```
DISCORD_BOT_TOKEN=     # bot token from discord developer portal
DISCORD_USER_ID=       # your user ID (right-click yourself with developer mode on)
DISCORD_SERVER_ID=     # any server where you and the bot are both members

PORT=3001
ALLOWED_ORIGINS=
REQUEST_TIMEOUT_MS=8000
FORCE_HTTPS=false
```

the bot needs `GuildMembers` and `GuildPresences` privileged intents enabled in the developer portal.

## assets

**88x31 buttons:** find collections at [cyber.dabamos.de](https://cyber.dabamos.de/88x31/) or make your own.

**digit counter GIFs:** custom pixel GIFs for the view counter digits. swap them with your own or use [count.getloli.com](https://count.getloli.com) as a hosted drop-in alternative.

## running

```bash
npm install
npm run dev   # auto-restarts on changes
npm start     # production
```
