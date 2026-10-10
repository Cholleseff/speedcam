import { setAudioModeAsync } from 'expo-audio';
import * as Speech from 'expo-speech';

import { angleDiff, bearingDeg, camerasNear, Camera, distanceM, Nearby, spokenKind } from './cameras';

export type Fix = {
  lat: number;
  lon: number;
  speed: number | null; // m/s
  heading: number | null; // degrees, null when unknown
  timestamp: number;
};

export type DriveState = {
  fix: Fix | null;
  next: Nearby | null; // nearest camera ahead
  lastAlert: { cam: Camera; dist: number; at: number } | null;
};

const SEARCH_RADIUS = 1000;
const RESET_RADIUS = 900; // forget an alerted camera once we are this far from it
const PASSED_RADIUS = 60; // closer than this the camera is treated as "being passed"
const AHEAD_CONE = 50; // degrees either side of heading
const OVERSPEED_RADIUS = 300; // warn about speeding only this close to a camera
const OVERSPEED_TOLERANCE = 20; // km/h; fines start above +20

let state: DriveState = { fix: null, next: null, lastAlert: null };
const alerted = new Set<string>();
const overspeedWarned = new Set<string>();
const listeners = new Set<(s: DriveState) => void>();

export function subscribe(fn: (s: DriveState) => void): () => void {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}

function emit(patch: Partial<DriveState>) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn(state));
}

let audioReady: Promise<void> | null = null;

/** Playback category: ignores the silent switch, keeps working in background, mixes over music. */
export function prepareAudio(): Promise<void> {
  audioReady ??= setAudioModeAsync({
    playsInSilentMode: true,
    shouldPlayInBackground: true,
    interruptionMode: 'mixWithOthers',
  }).catch((e) => {
    audioReady = null;
    throw e;
  });
  return audioReady;
}

export async function say(text: string) {
  try {
    await prepareAudio();
  } catch {
    // Speak anyway - worst case it is muted by the silent switch.
  }
  Speech.speak(text, { language: 'ru-RU', rate: 1.05 });
}

/** Alert distance grows with speed: ~18 s of driving, clamped to 250..600 m. */
function alertDistance(speed: number | null): number {
  const s = speed != null && speed > 0 ? speed : 0;
  return Math.min(600, Math.max(250, s * 18));
}

function isAhead(fix: Fix, cam: Camera): boolean {
  // Without a usable heading (standing still, bad GPS) we cannot tell - assume ahead.
  if (fix.heading == null || fix.heading < 0 || (fix.speed ?? 0) < 2) return true;
  const b = bearingDeg(fix.lat, fix.lon, cam.lat, cam.lon);
  return angleDiff(b, fix.heading) <= AHEAD_CONE;
}

function spokenLimit(cam: Camera): string {
  if (cam.speedLimit != null) return `, ограничение ${cam.speedLimit}`;
  if (cam.limitBySign) return ', ограничение по знаку';
  return '';
}

function roundDistance(m: number): number {
  return m >= 100 ? Math.round(m / 50) * 50 : Math.round(m / 10) * 10;
}

export function handleFix(fix: Fix) {
  const near = camerasNear(fix.lat, fix.lon, SEARCH_RADIUS);

  for (const set of [alerted, overspeedWarned]) {
    for (const id of set) {
      if (!near.some((n) => n.cam.id === id && n.dist < RESET_RADIUS)) set.delete(id);
    }
  }

  const ahead = near.filter((n) => n.dist > PASSED_RADIUS && isAhead(fix, n.cam));
  const next = ahead[0] ?? null;
  const limit = alertDistance(fix.speed);

  let lastAlert = state.lastAlert;
  const target = ahead.find((n) => n.dist <= limit && !alerted.has(n.cam.id));
  if (target) {
    // Cameras installed in pairs (both directions, same pole) get a single alert.
    for (const n of near) {
      if (distanceM(target.cam.lat, target.cam.lon, n.cam.lat, n.cam.lon) < 80) alerted.add(n.cam.id);
    }
    say(`${spokenKind(target.cam)}${spokenLimit(target.cam)}, через ${roundDistance(target.dist)} метров`);
    lastAlert = { cam: target.cam, dist: target.dist, at: fix.timestamp };
  }

  const speedKmh = (fix.speed ?? 0) * 3.6;
  if (
    next &&
    next.dist <= OVERSPEED_RADIUS &&
    next.cam.speedLimit != null &&
    speedKmh > next.cam.speedLimit + OVERSPEED_TOLERANCE &&
    !overspeedWarned.has(next.cam.id)
  ) {
    for (const n of near) {
      if (distanceM(next.cam.lat, next.cam.lon, n.cam.lat, n.cam.lon) < 80) overspeedWarned.add(n.cam.id);
    }
    say('Снизьте скорость');
  }

  emit({ fix, next, lastAlert });
}

export function resetAlerts() {
  alerted.clear();
  overspeedWarned.clear();
  emit({ next: null, lastAlert: null });
}
