# Upwelling shift: what the Ludington buoy shows

Run on 2026-11-27 to give the owner a starting value for `upwelling_shift_ft` (rule R08) and to test the open question of whether north wind moves the break shallower or deeper on the Michigan shore.

## Result

Suggested `upwelling_shift_ft`: **15 ft**, pending the owner's confirmation. It stays flagged as an estimate.

July and August, 2021 to 2026, Ludington buoy 45024 (GLOS dataset 62, about 70 ft of water, thermistors at 0, 3, 5, 8, 11, 13, 16, 19 and 21 m). 6,139 hourly profiles. "Depth of 55 °F" is where the water first cools to 55 °F going down, capped at the bottom thermistor (69 ft).

| Wind over the last 48 h | Hours | Median depth of 55 °F | Median change over those 48 h |
|---|---|---|---|
| North or east for 24 h or more (the R08 test) | 2,732 | 32 ft | 7 ft shallower |
| North for 24 h or more | 1,496 | 26 ft | 14 ft shallower |
| East for 24 h or more | 273 | 31 ft | not computed |
| South for 24 h or more | 2,404 | 51 ft | 10 ft deeper |
| Anything that fails the R08 test | 3,407 | 48 ft | 5 ft deeper |

By year, the median gap between R08 wind and other wind was 26, 24, 12, 7, 35 and 9 ft (2021 to 2026): same direction every year, 16 ft overall.

## What it does and does not show

- It supports R08 at Ludington: north and east wind bring cold water up near shore.
- It does not support "a sustained north wind pushes the break deeper" at this depth of water. The buoy cannot see below 69 ft, and 26% of non-upwelling hours were warmer than 55 °F to the bottom, so the true gap is larger than 16 ft and the picture farther offshore is unknown.
- One buoy, one port. Port Sheldon, South Haven and Cook have archives for 2021 only.
- Wind sectors: north is 315° to 45°, east 45° to 135°, south 135° to 225°, west 225° to 315°. No wind speed floor, matching the spec's definition of `upwelling_likely`.

## Reproducing it

`upwelling_analysis.py <folder of .nc files>` needs `netCDF4` and `numpy`. The inputs are GLOS archive files named `45024_{sea-water-temperature|wind-from-direction|wind-speed}_{depth}_{month}.nc` for June to September, fetched from `/api/v1/ncei_file/{fileName}`.

## What this found out about GLOS Seagull (for Phase 2)

- `GET /api/v1/obs` serves only the last 30 days. Older ranges return an empty list with an `X-Note` header saying historical data beyond 30 days is temporarily unavailable. The spec assumed full history.
- Older data is in the archive: `/api/v1/ncei_inventory` lists monthly NetCDF files per parameter and depth, and `/api/v1/ncei_file/{fileName}` redirects to a signed download.
- The API definition is at `/docs/seagull-api-spec.yaml`.
- Buoys near seeded ports that report temperature at depth (dataset id, parameter ids from `/api/v1/parameters`, which lists every platform's parameters with a `depth` in metres):

| Buoy | Dataset | Depths |
|---|---|---|
| Cook Nuclear Plant 45026 | 33 | 1 to 19 m |
| South Haven 45168 | 37 | 1 to 19 m |
| Port Sheldon 45029 | 3 | 1 to 21 m |
| Grand Haven Spotter | 671 | 1, 9, 18 m |
| Muskegon 45161 | 49 | 1 m and 19 to 22 m |
| Whitehall Spotter | 672 | 1, 9, 18 m |
| Ludington 45024 | 62 | 3 to 22 m |
| Sleeping Bear Dunes 45183 | 58 | 0.5 to 9 m |

Ludington, Whitehall, Grand Haven, Cook and Sleeping Bear are not in the Phase 0 station seed. Adding them gives every seeded port except Manistee and Frankfort a profile buoy within 25 miles, in season.
