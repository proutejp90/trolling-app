/**
 * PLACEHOLDER launch ports, pending the owner's list. Coordinates are approximate
 * pierhead positions typed from memory, not surveyed. Confirm before launch.
 */
export interface PortSeed {
  name: string; state: string; lake: string; lat: number; lon: number;
  shore: "east" | "west"; home_river: string | null;
}

const mi = (name: string, lat: number, lon: number, home_river: string | null): PortSeed =>
  ({ name, state: "MI", lake: "michigan", lat, lon, shore: "east", home_river });

export const ports: PortSeed[] = [
  mi("St. Joseph", 42.116, -86.489, "St. Joseph River"),
  mi("South Haven", 42.403, -86.288, "Black River"),
  mi("Holland", 42.773, -86.213, "Macatawa River"),
  mi("Grand Haven", 43.058, -86.253, "Grand River"),
  mi("Muskegon", 43.227, -86.341, "Muskegon River"),
  mi("Pentwater", 43.782, -86.443, "Pentwater River"),
  mi("Ludington", 43.955, -86.469, "Pere Marquette River"),
  mi("Manistee", 44.252, -86.345, "Manistee River"),
  mi("Frankfort", 44.631, -86.249, "Betsie River"),
  mi("Leland", 45.023, -85.763, "Leland River"),
];
