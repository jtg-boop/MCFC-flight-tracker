# Blue Moon Travel 🩵

A personal price tracker for getting from **Denver to Manchester for Man City matches**.

For each trip you pick a window of outbound and return dates. The app checks every date combination and compares two ways of getting there, by **total door-to-door cost**:

| Route | What's included |
|---|---|
| **United to Heathrow + train** | Round-trip flight DEN⇄LHR, Heathrow⇄Euston transfer, Avanti West Coast Euston⇄Manchester Piccadilly |
| **Fly into Manchester** | Round-trip flight DEN⇄MAN (up to 2 stops), Manchester Airport⇄Piccadilly train |

United is the preferred airline. United doesn't fly to Manchester, so a **United + partner** connection also counts as United: United to Frankfurt then Lufthansa, or United to Brussels then Brussels Airlines (one ticket, bags checked through). Change the partners and hubs with `PARTNER_AIRLINES` and `PARTNER_HUBS`. The app shows the best **United** option for each route, plus the cheapest option on **any airline** so you can see what sticking with United costs. Trips are re-checked automatically (every 12 hours by default). The app keeps a price history chart and can send a push notification to your phone when the price drops below your target.

Rail connections follow the flight times. The app won't pick a train you couldn't catch after landing. If a return flight leaves too early to reach Heathrow by train that morning, it books the train the day before and tells you.

## Quick start

Requires **Node.js 22.13+**.

```bash
npm install
npm start
# open http://localhost:3000
```

With no configuration it runs in **demo mode**: flight prices are realistic sample data. This lets you try the app before signing up for anything.

## Getting real prices

Copy `.env.example` to `.env` and fill in what you want:

### Flights (pick one)

| Provider | Setup | Notes |
|---|---|---|
| **Duffel** (`FLIGHT_PROVIDER=duffel`) | Sign up at [duffel.com](https://duffel.com), create an access token, set `DUFFEL_ACCESS_TOKEN` | Full itineraries both directions. Test tokens return sandbox data; use a live token for real fares. |
| **Google Flights via SerpApi** (`FLIGHT_PROVIDER=serpapi`) | Sign up at [serpapi.com](https://serpapi.com), set `SERPAPI_KEY` | Same prices you see on Google Flights. The free plan gives 100 searches/month. Return-flight times aren't included, so the train home is timed assuming an 11:00 departure. |

Setting either key is enough: the app uses SerpApi if `SERPAPI_KEY` is set, otherwise Duffel if `DUFFEL_ACCESS_TOKEN` is set. `FLIGHT_PROVIDER` overrides this.

**Budget your searches.** Each trip check runs *(outbound dates × return dates)* × 3 searches: one for Heathrow, and two for Manchester (an open search plus one just for United + partner connections). Fixed dates with both routes is 3 searches per check; a 2-day × 2-day window is 12. With a SerpApi key the app checks once a day by default (`CHECK_INTERVAL_HOURS=24`), so one fixed-date trip uses about 90 of the 100 free searches a month. Set `PARTNER_AIRLINES=` (empty) to drop the partner search, or `CHECK_INTERVAL_HOURS=48` to halve usage. Every **Check prices now** click also uses searches.

### Trains

UK rail has no free public fares API. Train prices are **estimates** of Avanti West Coast Advance fares, based on how far ahead you book and whether the train is at a peak time. Each train in the results links to National Rail with that exact journey pre-filled, so you can check the live fare in one tap. Tips:
- Advance fares usually go on sale about 12 weeks out and are cheapest right away.
- A Railcard (e.g. Two Together) takes a third off, but not on flights 😉

### Man City fixtures

Get a free key at [football-data.org](https://www.football-data.org/client/register) and set `FOOTBALL_DATA_API_KEY`. The new-trip form then shows a **Pick a City match** dropdown (home matches by default). Choosing a match fills in the dates: fly out 3–2 days before (the overnight flight lands the next morning), fly home 1–2 days after.

### Phone alerts

1. Install the free **ntfy** app ([iOS](https://apps.apple.com/app/ntfy/id1625396347) / [Android](https://play.google.com/store/apps/details?id=io.heckel.ntfy)).
2. Subscribe to a topic with a hard-to-guess name, e.g. `bluemoon-jtg-8f3k2`.
3. Set `NTFY_TOPIC` to the same name.
4. On a trip, click **Set price alert**. You'll get a push when the best United total drops under your target, and again each time it drops further.

## Keeping it running

Prices are only checked while the app is running. Options:
- Leave `npm start` running on an always-on computer.
- Or run one check from a scheduled job (cron / Task Scheduler): `npm run check`.
- Or host it on a small server/VPS. Keep the `data/` folder (SQLite database) on persistent storage.

## Development

```bash
npm test      # unit tests (date logic, train connections, pricing, storage)
npm run dev   # auto-restart on changes
```

```
src/
  server.js              web server + scheduler
  app.js                 REST API
  tracker.js             runs a price check for a trip, stores results, sends alerts
  itinerary.js           matches flights to trains, prices door-to-door options
  providers/flights/     mock, duffel, serpapi
  providers/trains/      estimate (Avanti Euston <-> Manchester Piccadilly)
  fixtures.js            Man City fixtures (football-data.org)
  db.js                  SQLite (Node's built-in node:sqlite)
public/                  single-page web UI
```

To add a real rail fares source (e.g. a licensed National Rail feed), implement `searchSingle({ from, to, date, adults })` in `src/providers/trains/` and register it in `index.js`.
