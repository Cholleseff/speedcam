import raw from '../assets/cameras.json';

export type Direction = 'oncoming' | 'same' | 'both' | 'intersection' | 'unknown';

export type Camera = {
  id: string;
  lat: number;
  lon: number;
  address: string;
  km: string;
  mobile: boolean;
  direction: Direction;
  schedule: string;
  tags: string[];
  /** km/h derived from the quoted rule (10.2 -> 60, 10.3 -> 90); null when unknown. */
  speedLimit: number | null;
  /** Limit is set by sign 3.24 whose value the table does not give. */
  limitBySign: boolean;
  violations: string;
};

export const CAMERAS = raw as Camera[];

const EARTH_R = 6371000;
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

export function distanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(a));
}

export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export function angleDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

// Grid index: ~2.2 km cells, so a 3x3 neighbourhood always covers a 1 km radius.
const CELL = 0.02;
const cellKey = (lat: number, lon: number) => `${Math.floor(lat / CELL)}:${Math.floor(lon / CELL)}`;
const grid = new Map<string, Camera[]>();
for (const cam of CAMERAS) {
  const key = cellKey(cam.lat, cam.lon);
  const bucket = grid.get(key);
  if (bucket) bucket.push(cam);
  else grid.set(key, [cam]);
}

export type Nearby = { cam: Camera; dist: number };

export function camerasNear(lat: number, lon: number, radiusM: number): Nearby[] {
  const cy = Math.floor(lat / CELL);
  const cx = Math.floor(lon / CELL);
  const out: Nearby[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      for (const cam of grid.get(`${cy + dy}:${cx + dx}`) ?? []) {
        const dist = distanceM(lat, lon, cam.lat, cam.lon);
        if (dist <= radiusM) out.push({ cam, dist });
      }
    }
  }
  return out.sort((a, b) => a.dist - b.dist);
}

const TAG_LABELS: Record<string, string> = {
  speed: 'скорость',
  redlight: 'светофор',
  crossing: 'переезд',
  lane: 'выделенная полоса',
  shoulder: 'обочина',
  parking: 'остановка и стоянка',
  pedestrian: 'пешеходный переход',
  oncoming_lane: 'выезд на встречку',
};

export const tagLabel = (tag: string) => TAG_LABELS[tag] ?? tag;

export const DIRECTION_LABELS: Record<Direction, string> = {
  oncoming: 'встречное (снимает спереди)',
  same: 'попутное (снимает сзади)',
  both: 'встречное и попутное',
  intersection: 'перекрёсток',
  unknown: 'не указано',
};

export function limitText(cam: Camera): string | null {
  if (cam.speedLimit != null) return `${cam.speedLimit} км/ч`;
  if (cam.limitBySign) return 'по знаку';
  return null;
}

/** Short phrase for voice alerts, e.g. "Камера скорости". */
export function spokenKind(cam: Camera): string {
  const prefix = cam.mobile ? 'Передвижная камера' : 'Камера';
  if (cam.tags.includes('speed')) return `${prefix} скорости`;
  if (cam.tags.includes('redlight')) return `${prefix} на светофоре`;
  if (cam.tags.includes('lane')) return `${prefix} на выделенной полосе`;
  if (cam.tags.includes('crossing')) return `${prefix} на переезде`;
  if (cam.tags.includes('parking')) return `${prefix} контроля стоянки`;
  return prefix;
}
