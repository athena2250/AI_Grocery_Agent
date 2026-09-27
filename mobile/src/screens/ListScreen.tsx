import React, { useMemo, useState } from 'react';
import { View, Text, SectionList, Pressable, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '../theme';
import { useHousehold } from '../state/HouseholdContext';
import { ItemRow } from '../components/ItemRow';
import type { Category, ListItem } from '../types';
import { ItemDetailModal } from './ItemDetailModal';

export function ListScreen() {
  const { state, markPurchased } = useHousehold();
  const [selected, setSelected] = useState<ListItem | null>(null);

  const sections = useMemo(() => {
    const byCat = new Map<Category, ListItem[]>();
    for (const item of state.listItems) {
      if (!byCat.has(item.category)) byCat.set(item.category, []);
      byCat.get(item.category)!.push(item);
    }
    return Array.from(byCat.entries()).map(([title, data]) => ({ title, data }));
  }, [state.listItems]);

  const unpurchased = state.listItems.filter((i) => !i.purchased).length;

  const approve = () => {
    Alert.alert('Approve list', `Approve ${unpurchased} items and take to the store?`, [
      { text: 'Cancel' },
      { text: 'Approve', onPress: () => {} },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Shopping list</Text>
          <Text style={styles.subtitle}>{unpurchased} items to buy</Text>
        </View>
        <Pressable style={styles.approve} onPress={approve} disabled={unpurchased === 0}>
          <Text style={styles.approveText}>Approve</Text>
        </Pressable>
      </View>

      {state.listItems.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No items yet. Go to Chat and tell me what you need.</Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(i) => i.id}
          renderSectionHeader={({ section: { title } }) => (
            <Text style={styles.section}>{title}</Text>
          )}
          renderItem={({ item }) => (
            <ItemRow
              item={item}
              onTogglePurchased={() => !item.purchased && markPurchased(item.id)}
              onPress={() => setSelected(item)}
            />
          )}
          stickySectionHeadersEnabled={false}
        />
      )}

      <ItemDetailModal item={selected} onClose={() => setSelected(null)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12, backgroundColor: theme.colors.surfaceAlt,
  },
  title: { fontSize: theme.font.title, fontWeight: '700', color: theme.colors.text },
  subtitle: { fontSize: theme.font.small, color: theme.colors.textMuted },
  approve: {
    backgroundColor: theme.colors.primary, paddingHorizontal: 16, paddingVertical: 8,
    borderRadius: theme.radius.pill,
  },
  approveText: { color: 'white', fontWeight: '700' },
  section: {
    paddingHorizontal: 14, paddingVertical: 6, backgroundColor: theme.colors.bg,
    color: theme.colors.textMuted, fontWeight: '700', fontSize: theme.font.small,
    textTransform: 'uppercase', letterSpacing: 1,
  },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 30 },
  emptyText: { color: theme.colors.textMuted, textAlign: 'center' },
});
