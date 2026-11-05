# I already have a server

Use this if your Tickler server is already running, for example because you set it up on another phone, or someone in your household runs one for you.

**Time:** about 1 minute.

## What you need

- The server's address, for example `https://tickler.your-name.workers.dev` or `https://tickler.example.com`
- Access to its setup page (`/setup`), to create a pairing code

## Steps

1. On a computer, open your server's setup page: add `/setup` to the address.
2. Log in with your passkey or passphrase.
3. Press **Pair a phone**. A QR code and an 8 character code appear. They work once, for 10 minutes.
4. In the app, choose **I already have a server** and scan the QR code, or type the address and the code.

The full steps, with pictures, are in [Pair your phone](pair.md).

## Check the address

The app checks the address before pairing. If it says it can't reach the server:

- Make sure the address starts with `https://` (or `http://` for a server on your home network).
- Don't add `/setup` or `/mcp` at the end. Just the address.
- If the server is on your home network, your phone must be on the same Wi-Fi. To use it from anywhere, give it a public address: see [Cloudflare Tunnel](public-url-cloudflare-tunnel.md) or [Tailscale Funnel](public-url-tailscale-funnel.md).

## More than one server

The app can hold more than one server, for example "Personal" and "Work". Add another one in **Settings**, then **Servers**. Switch between them from the top of the screen. (More than one server is part of Tickler Pro.)
