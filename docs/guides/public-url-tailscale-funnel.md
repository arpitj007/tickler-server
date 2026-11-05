# Public URL with Tailscale Funnel

Tailscale Funnel gives the Tickler server on your computer or home server a public HTTPS address like `https://homeserver.your-tailnet.ts.net`. You don't need a domain, and you don't open ports on your router. It's free on Tailscale's personal plan.

**Time:** about 10 minutes.

## Before you start

- Tickler is running with Docker on port 8787 ([Deploy with Docker](deploy-docker.md)).
- Tailscale is installed on that same machine and logged in. Get it from tailscale.com/download.

## Step 1: Allow Funnel in your tailnet

Funnel is off until you allow it. The easiest way: run the command in step 2. If Funnel isn't allowed yet, Tailscale prints a link. Open it and approve. That link turns on the three things Funnel needs:

- **MagicDNS** (gives your machine a name)
- **HTTPS certificates**
- the **funnel** permission for this machine in your tailnet policy

You can also turn these on by hand in the Tailscale admin console under **DNS** and **Access controls**.

## Step 2: Start Funnel

On the machine running Tickler:

```
sudo tailscale funnel --bg 8787
```

(On a Mac using the Tailscale app, run it without `sudo`.)

Tailscale prints your public address, for example:

```
https://homeserver.your-tailnet.ts.net
```

`--bg` keeps it running in the background, also after a restart.

## Step 3: Tell Tickler its address

Add your address to the `environment` section of your `docker-compose.yml`:

```yaml
      TICKLER_PUBLIC_URL: "https://homeserver.your-tailnet.ts.net"
```

Then restart:

```
docker compose up -d
```

## Step 4: Check it

Open your address with `/api/health` at the end. You should see a short message that includes `"ok": true`. The first request can take a few seconds while Tailscale gets the certificate.

## Turning it off

```
sudo tailscale funnel reset
```

Tickler keeps working on your own network and inside your tailnet.

## Good to know

- Funnel only uses ports 443, 8443 and 10000 on the public side. The command above uses 443, which is what you want.
- Funnel has bandwidth limits you can't change. Tickler sends very little data, so this is fine.
- If you only want your own devices to reach Tickler (no Claude apps, no ChatGPT, no webhooks), you don't need Funnel at all: install Tailscale on your phone and use the private address. That's `tailscale serve` instead of `tailscale funnel`.
