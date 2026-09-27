import AsyncStorage from '@react-native-async-storage/async-storage';
import type { HouseholdState } from '../types';
import { migrateState } from './migrate';

const KEY = 'household_state_v1';

export async function loadPersisted(): Promise<HouseholdState | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    return migrateState(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function savePersisted(state: HouseholdState): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

export async function clearPersisted(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
