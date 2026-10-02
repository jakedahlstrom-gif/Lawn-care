# Lawn Care

A mobile-first Progressive Web App for a Kentucky bluegrass lawn in Prior Lake, MN. Plain HTML, CSS and JavaScript with no build step. It installs to the iPhone home screen, works offline, and keeps all data on the device in IndexedDB.

## Tabs

- **Today**: a photo header (pick your own from the camera roll) with your target height, soil temperature, 7-day rain and the next feeding window. Below it are:
  - the Next Mow card (day, mower position, height, reason, and a rotating stripe-pattern icon);
  - the This Week card (see below);
  - Today, Tomorrow and Up Next task lists;
  - Watering and Conditions cards. Watering totals rain, Rachio runs and logged hand watering for the past 7 days, shows whether the Rachio Worker saved on this device is connected, and opens My Zones;
  - the 16-day forecast. Tap any day for hourly detail and lawn verdicts (mow, spot spray, pull weeds, feed).
- **Calendar**: the Scotts feeding plan (Halts → Turf Builder Lawn Food → optional summer → WinterGuard), spaced at least 4 weeks apart. Missed windows roll into the next one. It also has the season's tasks, the fall checklist (ticks itself off from your logs), a shopping list in whole bags, and a "Show past" toggle.
- **History**: every log entry, newest first, with filters, edit and delete, plus season totals (mows, lb N per 1,000 sq ft, products, watering cost).
- **Yard**: a **My Zones** screen for Rachio watering (see below), plus rows for location, zones, mower, spreader, products, water rates, schedule and nitrogen. Each row opens a detail screen. Numbers you haven't confirmed show an **Estimated** badge; tap it once you've checked the value. The gear holds your name, header photo, appearance, Winter Mode, backup and reset (press and hold).

**+** in the middle of the tab bar logs a mow, fertilizer, spot spray, pulled weeds, watering, or anything else, on any past date. You save by pressing and holding for 1 second, and Undo stays available for 5 seconds after saving.

## This Week

Weather and soil data come from [Open-Meteo](https://open-meteo.com/) (free, no API key) for the location in Yard → Location, which defaults to Prior Lake, MN 55372 (44.71, -93.42). The card shows:

- rain over the last 7 days (6 days ago through the current hour) and forecast rain for the next 3 days (72 hours), with the chance of rain;
- water lost to evapotranspiration over the same 7 days (reference ET₀ × 0.8 for cool-season turf);
- soil temperature now at 2.4″ deep, plus the 24-hour average the timing rules use.

It also makes a watering call. Rachio runs and logged hand watering count alongside rain.

- **Skip** when the lawn is short by less than half of what it used this week (or less than 0.3″, whichever is more), and from November to mid-April, on frozen ground, or after a logged sprinkler blowout until the next start-up.
- **Hold off for rain** when rain that's likely (50%+ chance) in the next 3 days covers at least 60% of the shortfall.
- **Water** otherwise, rounded to the nearest ¼″ and capped at 1″ per soak.

Soil timing alerts for Kentucky bluegrass follow the Calendar's feeding plan, so they never say "now" when the plan doesn't. Tap one to open that feeding.

- **Crabgrass preventer** (mid-March to May): it isn't time yet below 50°F. Once the forecast reaches 50°F within two weeks, the alert gives the date and says to have Halts on hand. At 50–55°F it says to apply now, and at 55°F and up it warns that crabgrass is sprouting.
- **Fall fertilizer** (mid-August to November): the early-fall feeding goes down as soil cools below 70°F. The last feeding goes down as top growth slows and soil cools toward 50°F. Roots stop taking up nitrogen near 40°F, so the alert says "Too cold" there.

## Rachio watering

With the Worker in `worker/` connected (Yard → My Zones), Rachio sprinkler runs count automatically in the Watering card, the This Week call, the growth model and season totals. Log only hand watering with **+ → Watering**.

- **Syncing:** the app fetches Rachio's zones and last 7 days of events when it opens or comes back to the foreground (at most every 15 minutes), and whenever you open or refresh My Zones.
- **Saving runs:** each run is saved on the phone as it's fetched, keyed by Rachio's event ID, and never duplicated. Season totals keep building after a run leaves Rachio's 7-day history, and backups include the runs.
- **Run time:** a run counts the minutes the zone actually watered, from its start and end events, never the scheduled time, so a run stopped early counts only what ran. Cycle-and-soak counts each cycle, not the soak. Schedule and rain-delay events are ignored.
- **Zone matching:** Rachio zones match your zones by name, then by zone number. Pick a different zone (or "Don't count") under **Counts as**.
- **Nozzle rates:** each zone uses Rachio's nozzle rate. If Rachio has none, the zone shows **Needs nozzle rate** and uses your zone's estimate until you enter one.
- **Gallons and cost:** gallons come from inches × zone area (or your measured flow rate once you've confirmed it). Cost uses your water rate: enter your own cost per 1,000 gallons in My Zones or Yard → Water Rates (**My rate**), or keep the tiered rates. My Zones shows gallons and cost per run, and per zone and in total for the last 7 days and the season.
- **No double counting:** a logged run that repeats a Rachio run (same day, zone and about the same minutes) is counted once, and History notes it.

## Winter Mode

Turn it on from the Winter pill on Today or in Settings. The app suggests it after the final mow and blowout are logged, or after a hard freeze, but never turns it on by itself. The winter screen shows:

- snowfall and snow depth;
- a soil temperature trend;
- a countdown to the spring crabgrass-preventer window;
- winter tips and a checklist;
- last season's recap;
- the spring shopping list.

## Install on iPhone

1. Open the site in **Safari** (GitHub Pages: `https://jakedahlstrom-gif.github.io/Lawn-care/`).
2. Tap **Share** → **Add to Home Screen** → **Add**.
3. Open it once from the home screen while online so it caches itself. After that it works offline.

## Backups

Data lives only on the phone, including saved Rachio runs. The Worker address and password stay out of backups. Use **Yard → gear → Export JSON backup** now and then; on iPhone it opens the share sheet so you can save to Files or iCloud Drive. **Import** replaces everything on the device with a backup.

## Development

```sh
npm start            # serve locally at http://localhost:8080
npm test             # engine unit tests + Playwright browser tests (390×844, mocked weather)
```

When you change any app file, bump `VERSION` in `sw.js` (and `APP_VERSION` in `js/views/yard.js`) so installed copies pick up the update. Add any new file to the `ASSETS` list in `sw.js`; a test checks this.
