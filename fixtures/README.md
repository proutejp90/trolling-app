# Fixtures

Recorded responses from NDBC, GLOS Seagull and the National Weather Service. Tests replay these and never call a live API.

| Set | Test clock | What it is |
|---|---|---|
| `november` | 2026-11-27T20:30Z | The live recording as made. Most buoys are pulled; the NWS forecast is present. |
| `autumn` | 2026-10-14T14:00Z | The same recording, cut to the 72 hours before the Muskegon buoy stopped reporting wind. |
| `winter` | 2026-04-10T14:00Z | Every buoy answers the way a pulled buoy did on 2026-11-27. |
| `ludington-july-2026.json` | 2026-07-15T16:00Z | Three days of real Ludington buoy readings from the GLOS archive, written in the shape of the `/api/v1/obs` response. The live API cannot serve July any more, so this one is assembled, not recorded. |

To record again: `FIXTURES=record:live npm run job:refresh`, then `node scripts/derive-fixtures.mjs`. The live recording is large and is not committed.
