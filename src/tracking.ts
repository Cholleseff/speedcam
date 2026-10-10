import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { handleFix, prepareAudio, resetAlerts } from './alerts';

export const LOCATION_TASK = 'speedcam-location';

// Must run at module load (imported from index.ts) so iOS can deliver
// background updates even when the app is relaunched without UI.
TaskManager.defineTask<{ locations: Location.LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => {
  if (error || !data) return;
  for (const loc of data.locations) handleLocation(loc);
});

function handleLocation(loc: Location.LocationObject) {
  const { latitude, longitude, speed, heading } = loc.coords;
  handleFix({
    lat: latitude,
    lon: longitude,
    speed: speed != null && speed >= 0 ? speed : null,
    heading: heading != null && heading >= 0 ? heading : null,
    timestamp: loc.timestamp,
  });
}

export type StartResult = 'background' | 'foreground-only' | 'denied';

let foregroundSub: Location.LocationSubscription | null = null;

const OPTIONS = {
  accuracy: Location.Accuracy.BestForNavigation,
  distanceInterval: 10,
};

export async function startTracking(): Promise<StartResult> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') return 'denied';

  await prepareAudio().catch(() => {});

  const bg = await Location.requestBackgroundPermissionsAsync();
  if (bg.status === 'granted') {
    await Location.startLocationUpdatesAsync(LOCATION_TASK, {
      ...OPTIONS,
      activityType: Location.ActivityType.AutomotiveNavigation,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'Speedcam',
        notificationBody: 'Предупреждения о камерах включены',
      },
    });
    return 'background';
  }

  // Only "When In Use": works while the app is on screen.
  foregroundSub?.remove();
  foregroundSub = await Location.watchPositionAsync(OPTIONS, handleLocation);
  return 'foreground-only';
}

export async function stopTracking() {
  foregroundSub?.remove();
  foregroundSub = null;
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  }
  resetAlerts();
}

export async function isTracking(): Promise<boolean> {
  return foregroundSub != null || (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK));
}
