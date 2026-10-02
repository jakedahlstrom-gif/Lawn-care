# Lawn Care

A mobile-first Progressive Web App for a Kentucky bluegrass lawn in Prior Lake, MN. Plain HTML, CSS and JavaScript with no build step. It installs to the iPhone home screen, works offline, and keeps all data on the device in IndexedDB.

## Tabs

- **Today**: a photo header (pick your own from the camera roll) with your target height, soil temperature, 7-day rain and the next feeding window. Below it are:
  - the Next Mow card (day, mower position, height, reason, and a rotating stripe-pattern icon);
  - Today, Tomorrow and Up Next task lists;
  - Watering and Conditions cards;
  - the 16-day forecast. Tap any day for hourly detail and lawn verdicts (mow, spot spray, pull weeds, feed).
- **Calendar**: the Scotts feeding plan (Halts → Turf Builder Lawn Food → optional summer → WinterGuard), spaced at least 4 weeks apart. Missed windows roll into the next one. It also has the season's tasks, the fall checklist (ticks itself off from your logs), a shopping list in whole bags, and a "Show past" toggle.
- **History**: every log entry, newest first, with filters, edit and delete, plus season totals (mows, lb N per 1,000 sq ft, products, watering cost).
- **Yard**: rows for location, zones, mower, spreader, products, water rates, schedule and nitrogen. Each row opens a detail screen. Numbers you haven't confirmed show an **Estimated** badge; tap it once you've checked the value. The gear holds your name, header photo, appearance, Winter Mode, backup and reset (press and hold).

**+** in the middle of the tab bar logs a mow, fertilizer, spot spray, pulled weeds, watering, or anything else, on any past date. You save by pressing and holding for 1 second, and Undo stays available for 5 seconds after saving.

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

Data lives only on the phone. Use **Yard → gear → Export JSON backup** now and then; on iPhone it opens the share sheet so you can save to Files or iCloud Drive. **Import** replaces everything on the device with a backup.

## Development

```sh
npm start            # serve locally at http://localhost:8080
npm test             # engine unit tests + Playwright browser tests (390×844, mocked weather)
```

When you change any app file, bump `VERSION` in `sw.js` (and `APP_VERSION` in `js/views/yard.js`) so installed copies pick up the update. Add any new file to the `ASSETS` list in `sw.js`; a test checks this.
