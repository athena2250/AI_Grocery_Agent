import React, { useMemo, useState } from 'react';
import { View, Text, SectionList, Pressable, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '../theme';
import { useHousehold } from '../state/HouseholdContext';
import { INVENTORY_STATES } from '../state/inventory';
import type { InventoryEntry, InventoryState } from '../types';

const stateLabel: Record<InventoryState, string> = {
  available: 'Available',
  running_low: 'Running low',
  almost_finished: 'Almost finished',
  out: 'Out of stock',
};

/** Three sections (plan_06): "almost finished" sits under Running low, tagged, at the top. */
type SectionKey = 'available' | 'low' | 'out';
const SECTIONS: { key: SectionKey; title: string; states: InventoryState[] }[] = [
  { key: 'available', title: 'Available', states: ['available'] },
  { key: 'low', title: 'Running low', states: ['almost_finished', 'running_low'] },
  { key: 'out', title: 'Out of stock', states: ['out'] },
];

const DAY_MS = 86_400_000;
function updatedAgo(iso: string, now: Date): string {
  const days = Math.floor((now.getTime() - new Date(iso).getTime()) / DAY_MS);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

export function PantryScreen() {
  const { state, setInventory } = useHousehold();
  const [collapsed, setCollapsed] = useState<Set<SectionKey>>(new Set());

  const productName = (id: string) => state.products.find((p) => p.id === id)?.name ?? id;

  const sections = useMemo(() => {
    const now = new Date();
    return SECTIONS.map((s) => {
      const rows = state.inventory
        .filter((i) => s.states.includes(i.state))
        .sort((a, b) => s.states.indexOf(a.state) - s.states.indexOf(b.state));
      return { ...s, count: rows.length, now, data: collapsed.has(s.key) ? [] : rows };
    }).filter((s) => s.count > 0);
  }, [state.inventory, collapsed]);

  const toggle = (key: SectionKey) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const changeState = (entry: InventoryEntry) => {
    Alert.alert(
      productName(entry.productId),
      'Change state to:',
      [
        ...INVENTORY_STATES.filter((s) => s !== entry.state).map((s) => ({
          text: stateLabel[s],
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
        <Text style={styles.subtitle}>Tell me in chat — or long-press an item to change it</Text>
      </View>
      {state.inventory.length === 0 ? (
        <View style={styles.empty}><Text style={styles.emptyText}>No pantry info yet.</Text></View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(i) => i.productId}
          stickySectionHeadersEnabled={false}
          renderSectionHeader={({ section }) => (
            <Pressable onPress={() => toggle(section.key)} style={styles.sectionHeader}>
              <Text style={styles.section}>{section.title} · {section.count}</Text>
              <Text style={styles.chevron}>{collapsed.has(section.key) ? '▸' : '▾'}</Text>
            </Pressable>
          )}
          renderItem={({ item, section }) => (
            <Pressable onLongPress={() => changeState(item)} style={styles.row}>
              <View style={styles.rowMain}>
                <Text style={styles.rowTitle}>{productName(item.productId)}</Text>
                <Text style={styles.rowMeta}>
                  {item.approxQty != null ? `~${item.approxQty} ${item.approxUnit} · ` : ''}updated {updatedAgo(item.updatedAt, section.now)}
                </Text>
              </View>
              {item.state === 'almost_finished' && (
                <Text style={styles.tag}>Almost finished</Text>
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
  sectionHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 10,
  },
  section: {
    color: theme.colors.textMuted, fontWeight: '700', fontSize: theme.font.small,
    textTransform: 'uppercase', letterSpacing: 1,
  },
  chevron: { color: theme.colors.textMuted, fontSize: theme.font.body },
  row: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 12, backgroundColor: theme.colors.surface,
    borderBottomWidth: 1, borderColor: theme.colors.border,
  },
  rowMain: { flex: 1 },
  rowTitle: { fontSize: theme.font.body, color: theme.colors.text, fontWeight: '600' },
  rowMeta: { color: theme.colors.textMuted, fontSize: theme.font.small, marginTop: 2 },
  tag: {
    color: theme.colors.accent, fontSize: theme.font.small, fontWeight: '700',
    borderWidth: 1, borderColor: theme.colors.accent, borderRadius: theme.radius.pill,
    paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden',
  },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 30 },
  emptyText: { color: theme.colors.textMuted },
});
