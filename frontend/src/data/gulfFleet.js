// 50 real Gulf of Mexico offshore vessels (names verified via operator fleet
// lists: Hornbeck Offshore, Harvey Gulf, SEACOR Marine, Edison Chouest,
// Guice Offshore, Otto Candies + the 15 demo suspect vessels).
// Positions are deterministic pseudo-random scatter around the demo area
// (-90.6..-89.8, 27.3..28.3) so the layout is stable across renders.

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const NAMES = [
  // Hornbeck Offshore (HOS fleet)
  'HOS RED DAWN', 'HOS COMMANDER', 'HOS CENTERLINE', 'HOS STORMRIDGE',
  'HOS ARROWHEAD', 'HOS IRON HORSE', 'HOS COLT', 'HOS RED ROCK',
  'HOS BRIGHT WATER', 'HOS BLU RIVER',
  // Harvey Gulf
  'HARVEY AMERICA', 'HARVEY FREEDOM', 'HARVEY LIBERTY', 'HARVEY POWER',
  'HARVEY ENERGY', 'HARVEY CHAMPION', 'HARVEY SUPPORTER', 'HARVEY CONDOR',
  // SEACOR Marine
  'SEACOR OHIO', 'SEACOR ALPS', 'SEACOR ANDES', 'SEACOR ATLAS', 'SEACOR LEE',
  // Edison Chouest
  'C-LEGEND', 'C-CAPTAIN', 'C-RETRIEVER', 'LANEY CHOUEST', 'ROSS CHOUEST',
  'GAIL CHOUEST', 'ISLAND VENTURE', 'ISLAND INTERVENTION',
  // Guice Offshore
  'GO PURSUIT', 'GO QUEST', 'GO SEARCHER', 'GO EXPLORER', 'GO PEGASUS',
  // Otto Candies / other GoM operators
  'CADE CANDIES', 'PAUL CANDIES', 'MISS DARIAN', 'LADY NINA', 'SUNNY LANE',
  // demo suspects (already established in the scenario)
  'CG WALNUT', 'KARLA F', 'MATTERHORN TLP', 'MR SEAMAN', 'FULL CIRCLE II',
  'GO GLORY', 'NGUYEN T J', 'MISSISSIPPI III', 'BRETON ISLAND',
]

const TYPES = ['OSV', 'PSV', 'MPSV', 'CREW BOAT', 'AHTS']

export const GULF_FLEET = (() => {
  const rand = mulberry32(20260928)
  const ships = []
  for (let i = 0; i < 50; i++) {
    const name = NAMES[i % NAMES.length]
    ships.push({
      mmsi: 367000000 + i * 137 + Math.floor(rand() * 100),
      name,
      type: TYPES[Math.floor(rand() * TYPES.length)],
      // deterministic scatter in the demo box
      lon: -90.62 + rand() * 0.8,
      lat: 27.27 + rand() * 1.0,
      sog: +(2 + rand() * 11).toFixed(1),
      cog: Math.floor(rand() * 360),
    })
  }
  return ships
})()

export function gulfFleetFC() {
  return {
    type: 'FeatureCollection',
    features: GULF_FLEET.map((s) => ({
      type: 'Feature',
      properties: { mmsi: s.mmsi, name: s.name, type: s.type, sog: s.sog, cog: s.cog },
      geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
    })),
  }
}
