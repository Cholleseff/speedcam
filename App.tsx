import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Callout, Marker } from 'react-native-maps';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { DriveState, say, subscribe } from './src/alerts';
import { Camera, CAMERAS, DIRECTION_LABELS, limitText, spokenKind, tagLabel } from './src/cameras';
import { isTracking, startTracking, StartResult, stopTracking } from './src/tracking';

type Mode = 'off' | StartResult;

const INITIAL_REGION = {
  latitude: 45.04,
  longitude: 42.0,
  latitudeDelta: 1.2,
  longitudeDelta: 1.2,
};

function pinColor(cam: Camera) {
  if (cam.mobile) return 'purple';
  if (cam.tags.includes('speed')) return 'red';
  return 'orange';
}

function formatDist(m: number) {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} км` : `${Math.round(m / 10) * 10} м`;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <MainScreen />
    </SafeAreaProvider>
  );
}

function MainScreen() {
  const map = useRef<MapView>(null);
  const [mode, setMode] = useState<Mode>('off');
  const [busy, setBusy] = useState(false);
  const [drive, setDrive] = useState<DriveState | null>(null);
  const [follow, setFollow] = useState(true);

  useEffect(() => subscribe(setDrive), []);

  useEffect(() => {
    isTracking().then((on) => on && setMode('background'));
  }, []);

  const fix = drive?.fix;
  useEffect(() => {
    if (follow && fix && mode !== 'off') {
      map.current?.animateCamera({ center: { latitude: fix.lat, longitude: fix.lon }, zoom: 15 }, { duration: 500 });
    }
  }, [fix, follow, mode]);

  // Markers never change, so render them once.
  const markers = useMemo(
    () =>
      CAMERAS.map((cam) => (
        <Marker
          key={cam.id}
          coordinate={{ latitude: cam.lat, longitude: cam.lon }}
          pinColor={pinColor(cam)}
          tracksViewChanges={false}
        >
          <Callout style={styles.callout}>
            <Text style={styles.calloutTitle}>{cam.address}</Text>
            {cam.km ? <Text style={styles.calloutText}>км {cam.km}</Text> : null}
            {limitText(cam) ? <Text style={styles.calloutText}>Ограничение: {limitText(cam)}</Text> : null}
            <Text style={styles.calloutText}>Фиксирует: {cam.tags.map(tagLabel).join(', ') || '—'}</Text>
            <Text style={styles.calloutText}>Направление: {DIRECTION_LABELS[cam.direction]}</Text>
            <Text style={styles.calloutText}>Режим: {cam.schedule}</Text>
          </Callout>
        </Marker>
      )),
    [],
  );

  async function toggle() {
    setBusy(true);
    try {
      if (mode !== 'off') {
        await stopTracking();
        setMode('off');
        return;
      }
      const result = await startTracking();
      setMode(result === 'denied' ? 'off' : result);
      if (result === 'denied') {
        Alert.alert('Нет доступа к геолокации', 'Разрешите доступ в настройках, иначе приложение не сможет предупреждать о камерах.', [
          { text: 'Отмена', style: 'cancel' },
          { text: 'Настройки', onPress: () => Linking.openURL('app-settings:') },
        ]);
      } else if (result === 'foreground-only') {
        Alert.alert(
          'Только при открытом экране',
          'Для предупреждений в фоне выберите в настройках «Геопозиция → Всегда».',
          [
            { text: 'Позже', style: 'cancel' },
            { text: 'Настройки', onPress: () => Linking.openURL('app-settings:') },
          ],
        );
      }
    } catch (e) {
      Alert.alert('Ошибка', String(e));
    } finally {
      setBusy(false);
    }
  }

  const speedKmh = fix?.speed != null ? Math.round(fix.speed * 3.6) : null;
  const next = drive?.next;
  const limit = next?.cam.speedLimit ?? null;
  const speedStyle =
    limit != null && speedKmh != null
      ? speedKmh > limit + 20
        ? styles.overDanger
        : speedKmh > limit
          ? styles.overWarn
          : null
      : null;

  return (
    <View style={styles.root}>
      <MapView
        ref={map}
        style={StyleSheet.absoluteFill}
        initialRegion={INITIAL_REGION}
        showsUserLocation
        showsCompass
        onPanDrag={() => setFollow(false)}
      >
        {markers}
      </MapView>

      <SafeAreaView edges={['bottom']} style={styles.panel}>
        <Text style={styles.status}>
          {mode === 'off' && `Выключено · ${CAMERAS.length} камер в базе`}
          {mode === 'background' && 'Предупреждения включены (работает в фоне)'}
          {mode === 'foreground-only' && 'Включено, но только пока экран открыт'}
        </Text>

        {mode !== 'off' && (
          <View style={styles.row}>
            <View style={[styles.box, speedStyle]}>
              <Text style={styles.big}>{speedKmh ?? '—'}</Text>
              <Text style={styles.small}>км/ч</Text>
            </View>
            {next && limitText(next.cam) && (
              <View style={styles.limitSign}>
                <Text style={[styles.limitText, limit == null && styles.limitTextSmall]}>
                  {limit ?? 'знак'}
                </Text>
              </View>
            )}
            <View style={[styles.box, styles.grow]}>
              {next ? (
                <>
                  <Text style={styles.big}>{formatDist(next.dist)}</Text>
                  <Text style={styles.small} numberOfLines={2}>
                    {spokenKind(next.cam)} · {next.cam.address}
                  </Text>
                </>
              ) : (
                <>
                  <Text style={styles.big}>—</Text>
                  <Text style={styles.small}>Впереди в пределах 1 км камер нет</Text>
                </>
              )}
            </View>
          </View>
        )}

        <View style={styles.row}>
          <Pressable
            style={[styles.button, mode === 'off' ? styles.start : styles.stop, styles.grow]}
            onPress={toggle}
            disabled={busy}
          >
            <Text style={styles.buttonText}>{busy ? '…' : mode === 'off' ? 'Поехали' : 'Остановить'}</Text>
          </Pressable>
          <Pressable style={styles.button} onPress={() => say('Камера скорости через 300 метров')}>
            <Text style={styles.buttonText}>🔊</Text>
          </Pressable>
          {!follow && mode !== 'off' && (
            <Pressable style={styles.button} onPress={() => setFollow(true)}>
              <Text style={styles.buttonText}>◎</Text>
            </Pressable>
          )}
        </View>
      </SafeAreaView>
      <StatusBar style="dark" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(20,20,24,0.92)',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 16,
    paddingTop: 14,
    gap: 12,
  },
  status: { color: '#c9c9d1', fontSize: 14 },
  row: { flexDirection: 'row', gap: 10, marginBottom: 4 },
  box: { backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 12, padding: 10, minWidth: 80 },
  grow: { flex: 1 },
  big: { color: '#fff', fontSize: 28, fontWeight: '700' },
  small: { color: '#c9c9d1', fontSize: 13 },
  button: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overWarn: { backgroundColor: '#8a6d00' },
  overDanger: { backgroundColor: '#b3261e' },
  limitSign: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 6,
    borderColor: '#d32f2f',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  limitText: { fontSize: 22, fontWeight: '800', color: '#111' },
  limitTextSmall: { fontSize: 13 },
  start: { backgroundColor: '#1f8f4e' },
  stop: { backgroundColor: '#b3261e' },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '600' },
  callout: { width: 260 },
  calloutTitle: { fontWeight: '700', marginBottom: 4 },
  calloutText: { fontSize: 12, color: '#333' },
});
