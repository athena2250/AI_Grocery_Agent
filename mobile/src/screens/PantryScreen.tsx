import React, { useMemo } from 'react';
import { View, Text, SectionList, Pressable, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '../theme';
import { useHousehold } from '../state/HouseholdContext';
import type { InventoryEntry, InventoryState } from '../types';

const groupLabel: Record<InventoryState, string> = {
  available: 'Available',
  running_low: 'Running low',
  almost_finished: 'Almost finished',
  out: 'Out of stock',
};

const STATES: InventoryState[] = ['available', 'running_low', 'almost_finished', 'out'];

export function PantryScreen() {
  const { state, setInventory } = useHousehold();

  const sections = useMemo(() => {
    const byState = new Map<InventoryState, InventoryEntry[]>();
    for (const s of STATES) byState.set(s, []);
    for (const inv of state.inventory) byState.get(inv.state)?.push(inv);
    return STATES.filter((s) => byState.get(s)!.length > 0).map((s) => ({ title: groupLabel[s], state: s, data: byState.get(s)! }));
  }, [state.inventory]);

  const productName = (id: string) => state.products.find((p) => p.id === id)?.name ?? id;

  const cycleState = (entry: InventoryEntry) => {
    Alert.alert(
      productName(entry.productId),
      'Change state to:',
      [
        ...STATES.filter((s) => s !== entry.state).map((s) => ({
          text: groupLabel[s],
          onPress: () => setInventory({ productId: entry.productId, state: s }),
        })),
        { text: 'Cancel', style: 'cancel' as const },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Pantry</Text>
        <Text style={styles.subtitle}>Long-press an item to change state</Text>
      </View>
      {state.inventory.length === 0 ? (
        <View style={styles.empty}><Text style={styles.emptyText}>No pantry info yet.</Text></View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(i) => i.productId}
          renderSectionHeader={({ section: { title } }) => <Text style={styles.section}>{title}</Text>}
          renderItem={({ item }) => (
            <Pressable onLongPress={() => cycleState(item)} onPress={() => cycleState(item)} style={styles.row}>
              <Text style={styles.rowTitle}>{productName(item.productId)}</Text>
              {item.approxQty && (
                <Text style={styles.rowMeta}>~{item.approxQty} {item.approxUnit}</Text>
              )}
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  header: { paddingHorizontal: 16, paddingVertical: 12, backgroundColor: theme.colors.surfaceAlt },
  title: { fontSize: theme.font.title, fontWeight: '700', color: theme.colors.text },
  subtitle: { fontSize: theme.font.small, color: theme.colors.textMuted },
  section: {
    paddingHorizontal: 14, paddingVertical: 8, color: theme.colors.textMuted,
    fontWeight: '700', fontSize: theme.font.small, textTransform: 'uppercase', letterSpacing: 1,
  },
  row: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 12, backgroundColor: theme.colors.surface,
    borderBottomWidth: 1, borderColor: theme.colors.border,
  },
  rowTitle: { fontSize: theme.font.body, color: theme.colors.text, fontWeight: '600' },
  rowMeta: { color: theme.colors.textMuted, fontSize: theme.font.small },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 30 },
  emptyText: { color: theme.colors.textMuted },
});
