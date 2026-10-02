# Lawn Care

A mobile-first Progressive Web App for a Kentucky bluegrass lawn in Prior Lake, MN. Plain HTML, CSS and JavaScript with no build step. It installs to the iPhone home screen, works offline, and keeps all data on the device in IndexedDB.

## Tabs

- **Today**: safety timers, next mow (day, mower position, height, reason), alerts (crabgrass soil temperature, rain-aware fertilizer timing, low inventory, blade sharpening, hard freeze), Open-Meteo weather with 24-hour soil temperature, rain and evapotranspiration, and this week's watering need and cost.
- **Plan**: a Minnesota bluegrass season calendar triggered by soil temperature and the forecast. Each task shows its product, Scotts Elite setting, pounds for your zones and why. Includes the fall checklist.
- **History**: every log entry, newest first, with edit and delete, plus season totals (mows, lb N per 1,000 sq ft, products used).
- **Yard**: every setting, editable and labeled Estimated or Measured, covering location, zones, mower, spreader, clippings, products, water rates and schedule. Also holds Settings (appearance, JSON export/import, reset).

**+ Log** in the middle of the tab bar logs a mow, fertilizer, weed control, or anything else. You save by pressing and holding for 1 second, and Undo stays available for 5 seconds after saving.

## Install on iPhone

1. Open the site in **Safari** (GitHub Pages: `https://jakedahlstrom-gif.github.io/Lawn-care/`).
2. Tap **Share** → **Add to Home Screen** → **Add**.
3. Open it once from the home screen while online so it caches itself. After that it works offline.

## Backups

Data lives only on the phone. Use **Yard → Settings → Export JSON backup** now and then; on iPhone it opens the share sheet so you can save to Files or iCloud Drive. **Import** replaces everything on the device with a backup.

## Development

```sh
npm start            # serve locally at http://localhost:8080
npm test             # engine unit tests + Playwright browser tests (390×844, mocked weather)
```

When you change any app file, bump `VERSION` in `sw.js` (and `APP_VERSION` in `js/views/yard.js`) so installed copies pick up the update. Add any new file to the `ASSETS` list in `sw.js`; a test checks this.
