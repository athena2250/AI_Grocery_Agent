import React from 'react';
import { Platform, View, Text, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { HouseholdProvider } from './src/state/HouseholdContext';
import { RootNavigator } from './src/navigation/RootNavigator';

function AppInner() {
  return (
    <SafeAreaProvider>
      <HouseholdProvider>
        <RootNavigator />
        <StatusBar style="auto" />
      </HouseholdProvider>
    </SafeAreaProvider>
  );
}

export default function App() {
  if (Platform.OS !== 'web') return <AppInner />;

  return (
    <View style={styles.stage}>
      <View style={styles.phone}>
        <View style={styles.punchHole} />
        <View style={styles.screen}>
          <AppInner />
        </View>
        <View style={styles.navBar}>
          <View style={styles.navTriangle} />
          <View style={styles.navCircle} />
          <View style={styles.navSquare} />
        </View>
      </View>
      <Text style={styles.label}>Pixel-style · sandbox preview</Text>
    </View>
  );
}

const PHONE_W = 412;
const PHONE_H = 820;

const styles = StyleSheet.create({
  stage: {
    flex: 1,
    backgroundColor: '#0f172a',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    minHeight: '100%' as any,
  },
  phone: {
    width: PHONE_W,
    height: PHONE_H,
    backgroundColor: '#0b0b0b',
    borderRadius: 36,
    padding: 10,
    paddingBottom: 42,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.5,
    shadowRadius: 40,
    borderWidth: 2,
    borderColor: '#2a2a2a',
    position: 'relative',
  },
  punchHole: {
    position: 'absolute',
    top: 18,
    left: '50%',
    marginLeft: -7,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#000',
    borderWidth: 1,
    borderColor: '#1f2937',
    zIndex: 10,
  },
  screen: {
    flex: 1,
    borderRadius: 28,
    overflow: 'hidden',
    backgroundColor: '#fff',
  },
  navBar: {
    position: 'absolute',
    bottom: 0,
    left: 10,
    right: 10,
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 40,
  },
  navTriangle: {
    width: 0,
    height: 0,
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderBottomWidth: 12,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#e5e7eb',
    transform: [{ rotate: '-90deg' }],
  },
  navCircle: {
    width: 14, height: 14, borderRadius: 7,
    borderWidth: 2, borderColor: '#e5e7eb',
  },
  navSquare: {
    width: 12, height: 12,
    borderWidth: 2, borderColor: '#e5e7eb', borderRadius: 2,
  },
  label: {
    marginTop: 12,
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
});
