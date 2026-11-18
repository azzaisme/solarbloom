// E23.5.2 (#387): planter boxes and the 14 starting crops. All data, no rules; numbers are the epic's starting
// values for tuning. Growth is in game days (48 minutes of play, data/farm DAY_SECONDS).

/** The 14 starting crops. "Lavender and mint" is one crop (a bed of both). */
export type CropId =
  | 'radish'
  | 'lettuce'
  | 'potato'
  | 'beans'
  | 'tomato'
  | 'sweetcorn'
  | 'pumpkin'
  | 'sunflower'
  | 'watercress'
  | 'rice'
  | 'herbs'
  | 'moonflower'
  | 'flowers'
  | 'seaKale';

/**
 * What a crop can like. A *soft* like speeds it to full rate when met and slows it when not; a *hard* like is a
 * need: without it the crop simply rests (it never wilts or dies for want of it).
 *  sun: day and clear sky · rain: rain falling · shade: something tall beside the planter · wind: windy weather
 *  trellis / flooded: the planter's extras · fertiliser: a fed bed (or beans next door) · runningWater: water
 *  flowing beside it · night: after dark · saltAir: by the sea (Saltwind Beach)
 */
export type Like = 'sun' | 'rain' | 'shade' | 'wind' | 'trellis' | 'flooded' | 'fertiliser' | 'runningWater' | 'night' | 'saltAir';

export interface CropDef {
  id: CropId;
  name: string;
  icon: string;
  /** game days to ripen with every like met */
  days: number;
  /** soft likes (each unmet one multiplies the growth rate by PLANTER.unmetLike) */
  likes: Like[];
  /** hard likes (growth stops without them) */
  needs: Like[];
  /** what one harvest gives */
  harvest: { food: number; biomass: number; seeds: number };
  /** what it is good for (the plant picker's line) */
  use: string;
  /** the tint of its leaves and fruit in the planter */
  leaf: string;
  fruit: string;
}

export const CROPS: Record<CropId, CropDef> = {
  radish: { id: 'radish', name: 'Radish', icon: '🥕', days: 1, likes: [], needs: [], harvest: { food: 2, biomass: 1, seeds: 2 }, use: 'Grows anywhere, fast', leaf: '#6fa84a', fruit: '#d8506a' },
  lettuce: { id: 'lettuce', name: 'Lettuce', icon: '🥕', days: 1, likes: ['rain'], needs: [], harvest: { food: 2, biomass: 2, seeds: 2 }, use: 'Loves the rain', leaf: '#8fd05a', fruit: '#b8e07a' },
  potato: { id: 'potato', name: 'Potato', icon: '🥕', days: 2, likes: ['shade'], needs: [], harvest: { food: 5, biomass: 2, seeds: 2 }, use: 'Happy in the shade; a big harvest', leaf: '#5a8a46', fruit: '#c8a46a' },
  beans: { id: 'beans', name: 'Beans', icon: '🥕', days: 2, likes: ['trellis'], needs: [], harvest: { food: 3, biomass: 2, seeds: 2 }, use: 'Climbs a trellis; feeds the soil of planters beside it', leaf: '#4f9a4a', fruit: '#7ab84a' },
  tomato: { id: 'tomato', name: 'Tomato', icon: '🍎', days: 3, likes: ['sun'], needs: [], harvest: { food: 4, biomass: 2, seeds: 2 }, use: 'Loves the sun; a Keeper favourite', leaf: '#4a8a40', fruit: '#e0503a' },
  sweetcorn: { id: 'sweetcorn', name: 'Sweetcorn', icon: '🌾', days: 3, likes: ['sun', 'wind'], needs: [], harvest: { food: 3, biomass: 6, seeds: 2 }, use: 'Sun and wind; lots of biomass', leaf: '#7aa846', fruit: '#f0cc4a' },
  pumpkin: { id: 'pumpkin', name: 'Pumpkin', icon: '🧺', days: 5, likes: ['fertiliser'], needs: [], harvest: { food: 8, biomass: 3, seeds: 2 }, use: 'Hungry for fertiliser; the biggest charge', leaf: '#5a9a3a', fruit: '#f08a2a' },
  sunflower: { id: 'sunflower', name: 'Sunflower', icon: '🌻', days: 3, likes: ['sun'], needs: [], harvest: { food: 1, biomass: 4, seeds: 6 }, use: 'Loves the sun; seeds and biomass', leaf: '#6a9a3a', fruit: '#f6c832' },
  watercress: { id: 'watercress', name: 'Watercress', icon: '🌿', days: 2, likes: [], needs: ['runningWater'], harvest: { food: 3, biomass: 1, seeds: 2 }, use: 'Only grows beside running water', leaf: '#3a9a5a', fruit: '#6ac87a' },
  rice: { id: 'rice', name: 'Rice', icon: '🌾', days: 4, likes: [], needs: ['flooded'], harvest: { food: 6, biomass: 3, seeds: 3 }, use: 'Only grows in a flooded bed', leaf: '#9ac85a', fruit: '#e8dca0' },
  herbs: { id: 'herbs', name: 'Lavender and mint', icon: '🌸', days: 2, likes: [], needs: [], harvest: { food: 1, biomass: 2, seeds: 2 }, use: 'Brings pollinators: crops nearby grow faster', leaf: '#5aa070', fruit: '#a080d0' },
  moonflower: { id: 'moonflower', name: 'Moonflower', icon: '🌙', days: 1, likes: [], needs: ['night'], harvest: { food: 1, biomass: 1, seeds: 2 }, use: 'Opens only at night (two nights to bloom)', leaf: '#4a7a6a', fruit: '#f4f0e0' },
  flowers: { id: 'flowers', name: 'Flowers', icon: '🌷', days: 2, likes: [], needs: [], harvest: { food: 0, biomass: 1, seeds: 2 }, use: 'For decoration and gifts', leaf: '#5a9a4a', fruit: '#f080a8' },
  seaKale: { id: 'seaKale', name: 'Sea kale', icon: '🌿', days: 3, likes: ['saltAir'], needs: [], harvest: { food: 4, biomass: 2, seeds: 2 }, use: 'Loves salt air; seeds only from Saltwind Beach', leaf: '#7aa8a0', fruit: '#c0d8d0' },
};

export const CROP_IDS = Object.keys(CROPS) as CropId[];

/**
 * E23.5.2.3: where each crop's seeds are found. Every region has at least one crop found nowhere else; the park
 * starts the farm with three.
 */
export const CROP_HOMES: Record<string, CropId[]> = {
  park: ['radish', 'lettuce', 'flowers'],
  mastRow: ['sweetcorn'],
  oldMarket: ['tomato'],
  saltwind: ['seaKale'],
  elderGrove: ['beans'],
  cistern: ['watercress'],
  clockPlaza: ['potato'],
  terraces: ['rice'],
  glasshouse: ['pumpkin', 'herbs'],
  observatory: ['moonflower'],
  spireHeights: ['sunflower'],
};

/** Crops known at the start of a game (planted with plain Seeds). */
export const STARTING_CROPS: CropId[] = ['radish'];

export const PLANTER = {
  /** each unmet soft like multiplies the growth rate by this */
  unmetLike: 0.5,
  /** a fed (fertilised) bed grows this much faster, whatever the crop */
  fertilisedBoost: 1.25,
  /** pollinators (a lavender and mint bed, or a Pollinator Garden) within this many tiles: this much faster */
  pollinatorReach: 3,
  pollinatorBoost: 1.25,
  /** beans feed the soil of planters within this many tiles (they count as fertilised) */
  beansReach: 1,
  /** plain Seeds one planting takes */
  seedCost: 1,
  /** the extras: what each costs to add to a planter */
  extras: { trellis: { timber: 2 }, flooded: { clay: 2 } } as Record<'trellis' | 'flooded', Partial<Record<'timber' | 'clay' | 'scrap', number>>>,
  /** fertiliser one feeding takes (it lasts until the next harvest) */
  feedCost: 1,
  /** E23.4: water a growing bed draws from the network a game day (one water tile holds 20 units) */
  waterPerDay: 4,
  /** growth stages drawn in the planter (sprout, leafy, flowering, ripe) */
  stages: 4,
};

/**
 * E23.5.2.3: finding seeds. Every `gathersPerPacket` gathers of restored ground in a region (or the first pile
 * emptied there, or any cache opened there) turns up the next seed packet that region holds.
 */
export const SEED_FINDS = {
  gathersPerPacket: 4,
};
