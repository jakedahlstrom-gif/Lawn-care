# Lawn IQ Rachio Worker

A small Cloudflare Worker that lets the Lawn IQ app read your Rachio data without putting your Rachio key in the app.

It allows only three read-only calls, and each one needs the shared password in the `X-App-Password` header:

| Worker path | Rachio call |
| --- | --- |
| `GET /person/info` | `/1/public/person/info` |
| `GET /person/:id` | `/1/public/person/:id` (devices and zones) |
| `GET /device/:id/event?startTime=&endTime=` | `/1/public/device/:id/event` |

Only pages on `jakedahlstrom-gif.github.io` and `localhost:8080` can call it from a browser.

## Secrets (Cloudflare dashboard → Workers → lawn-care-rachio → Settings → Variables and Secrets)

- `RACHIO_API_KEY`: your key from the Rachio app (Account → Get API Key).
- `APP_PASSWORD`: any long password you choose. Enter the same one in the app under Yard → My Zones.

## Address

Deployed at `https://lawn-care-rachio.5n5tr524rm.workers.dev`. Enter that in Yard → My Zones.

## Deploy

```sh
./worker/deploy.sh      # uses the Cloudflare API directly; set CLOUDFLARE_API_TOKEN when running on your own computer
```

`npx wrangler deploy` from this folder also works. The account needs a workers.dev subdomain first: opening Workers & Pages in the Cloudflare dashboard once creates it.
