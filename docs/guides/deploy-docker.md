# Deploy with Docker

Run your Tickler server on a home server, a NAS, a Raspberry Pi or a small VPS. Everything is stored in one SQLite file that you own.

**Time:** about 5 minutes if Docker is already installed.

**You need:** a machine with Docker. On a Mac or Windows PC, install Docker Desktop. On Linux, install Docker Engine and the Compose plugin.

## Option A: one command

Run this in a terminal:

```
docker run -d --name tickler --restart unless-stopped \
  -p 8787:8787 \
  -v tickler-data:/data \
  -e TICKLER_SECRET="$(openssl rand -base64 32)" \
  ghcr.io/arpitj007/tickler-server:latest
```

What each part does:

- `-p 8787:8787` makes the server reachable on port 8787 of this machine.
- `-v tickler-data:/data` keeps your database in a Docker volume, so it survives updates.
- `TICKLER_SECRET` encrypts the provider keys you may add later. The command makes a random one. Write it down if you might move the server one day (see "Backups" below).

Then open the setup page in a browser on the same machine:

```
http://localhost:8787/setup
```

From another device on your network, use the machine's address instead, for example `http://192.168.1.20:8787/setup`.

## Option B: Docker Compose (recommended for keeping it running)

Make a folder called `tickler` and save this as `docker-compose.yml` inside it:

```yaml
services:
  tickler:
    image: ghcr.io/arpitj007/tickler-server:latest
    container_name: tickler
    restart: unless-stopped
    ports:
      - "8787:8787"
    volumes:
      - ./data:/data
    environment:
      # A long random value. Make one with: openssl rand -base64 32
      TICKLER_SECRET: "paste-your-long-random-value-here"
      # Your public address, once you have one (see the public URL guides).
      # TICKLER_PUBLIC_URL: "https://tickler.example.com"
```

Then, in that folder:

```
docker compose up -d
```

Your database is the file `data/tickler.sqlite` in that folder.

## Step 2: Protect your server

Open `/setup` (see above). The first time, it asks you to:

1. Create a **passkey** or set a long **passphrase**.
2. Give your server a name, like "Home".

Passkeys need HTTPS or `localhost`. If you open setup from another device over plain `http://`, use the passphrase for now. You can add a passkey after you set up a public HTTPS address.

## Step 3: Decide if you need a public address

Your server now works on your own network. That's enough for:

- the app on your phone while it's on the same Wi-Fi
- Claude Code, Cursor, Codex and Gemini CLI on computers on the same network

You need a **public HTTPS address** for:

- the app when you are away from home
- the Claude apps and ChatGPT, which connect from the cloud
- store webhooks (App Store, Google Play, Stripe), which make sales show up in seconds

Two free ways to get one, without opening ports on your router:

- [Cloudflare Tunnel](public-url-cloudflare-tunnel.md): best if you have a domain on Cloudflare
- [Tailscale Funnel](public-url-tailscale-funnel.md): no domain needed

## Updating

With Compose, in your `tickler` folder:

```
docker compose pull
docker compose up -d
```

With plain `docker run`: pull the new image, remove the old container and run the same command again. Your data is in the volume, so nothing is lost:

```
docker pull ghcr.io/arpitj007/tickler-server:latest
docker stop tickler && docker rm tickler
```

Then run the command from Option A again, with the **same** `TICKLER_SECRET` value as before.

Database changes run by themselves when the new version starts.

## Backups

Everything lives in one SQLite file in your `data` folder (or the `tickler-data` volume). The simplest safe backup takes a few seconds: stop the server, copy the folder, start it again.

```
docker compose stop
cp -r data "tickler-backup-$(date +%F)"
docker compose start
```

To back up without stopping, use SQLite's own backup command from a throwaway container. It is safe to run while Tickler is writing:

```
docker run --rm -v "$PWD/data:/data" alpine \
  sh -c "apk add -q sqlite && sqlite3 /data/tickler.sqlite '.backup /data/backup.sqlite'"
```

Then copy `data/backup.sqlite` somewhere safe, like another disk or your cloud drive. A nightly cron job running that command is plenty.

Keep your `TICKLER_SECRET` with your backups. Without it, a restored server still has all your entries, but you need to paste your provider keys again.

To restore: stop the server, put the backup file back as `data/tickler.sqlite`, delete any `tickler.sqlite-wal` and `tickler.sqlite-shm` files next to it, and start the server.

## Next

- [Pair your phone](pair.md)
- [Connect your AI tools](connect/claude-code.md)
