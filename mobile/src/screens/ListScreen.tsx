import React, { useMemo, useState } from 'react';
import { View, Text, SectionList, Pressable, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '../theme';
import { useHousehold } from '../state/HouseholdContext';
import { ItemRow } from '../components/ItemRow';
import type { ListItem, ProposedItem } from '../types';
import { groupByCategory, pendingItems, visibleItems } from '../state/planner';
import { homeSuggestions } from '../state/prediction';
import { ItemDetailModal } from './ItemDetailModal';

export function ListScreen() {
  const { state, markPurchased, approveList, acceptRestock, dismissRestock, dismissPrediction } = useHousehold();
  const [selected, setSelected] = useState<ListItem | null>(null);
  const [suggestedOpen, setSuggestedOpen] = useState(false);

  const sections = useMemo(() => groupByCategory(visibleItems(state.listItems)), [state.listItems]);
  const { restock: suggestions, predicted } = useMemo(() => homeSuggestions(state), [state]);

  const toBuy = pendingItems(state.listItems).length;
  const approved = state.list.status === 'approved';

  const approve = () => {
    Alert.alert('Approve list', `Approve ${toBuy} items and take to the store?`, [
      { text: 'Cancel' },
      { text: 'Approve', onPress: approveList },
    ]);
  };

  // Adding to an approved list reopens it as a draft — ask first (plan_08).
  const add = (p: ProposedItem) => {
    if (!approved) return acceptRestock(p);
    Alert.alert('Reopen list?', `Your list is approved. Adding ${p.product.toLowerCase()} puts it back to draft.`, [
      { text: 'Cancel' },
      { text: 'Add', onPress: () => acceptRestock(p) },
    ]);
  };

  const suggestionRow = (p: ProposedItem, dismiss: (productId: string) => void) => (
    <View key={p.id} style={styles.suggestRow}>
      <Text style={styles.suggestText}>{p.rationale}</Text>
      <View style={styles.chips}>
        <Pressable style={styles.chip} onPress={() => add(p)}>
          <Text style={styles.chipText}>
            Add {p.product.toLowerCase()}{p.qty != null ? ` · ${p.qty} ${p.unit}` : ''}
          </Text>
        </Pressable>
        <Pressable style={[styles.chip, styles.chipQuiet]} onPress={() => dismiss(p.productId)}>
          <Text style={[styles.chipText, styles.chipQuietText]}>Not now</Text>
        </Pressable>
      </View>
    </View>
  );

  const restockBlock = suggestions.length > 0 && (
    <View style={styles.suggestBox}>
      <Text style={styles.suggestTitle}>Running out at home</Text>
      {suggestions.map((p) => suggestionRow(p, dismissRestock))}
    </View>
  );

  // Purchase predictions (plan_10): collapsed by default, kept apart from what Mom added herself.
  const predictedBlock = predicted.length > 0 && (
    <View style={[styles.suggestBox, styles.predictBox]}>
      <Pressable onPress={() => setSuggestedOpen((o) => !o)}>
        <Text style={styles.predictTitle}>
          {suggestedOpen ? '▾' : '▸'} Suggested ({predicted.length}) · usually bought around now
        </Text>
      </Pressable>
      {suggestedOpen && predicted.map((p) => suggestionRow(p, dismissPrediction))}
    </View>
  );

  const suggestionBlock = (restockBlock || predictedBlock) && (
    <View>
      {restockBlock}
      {predictedBlock}
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Shopping list</Text>
          <Text style={styles.subtitle}>
            {toBuy} items to buy · {approved ? 'approved' : 'draft'}
          </Text>
        </View>
        {approved ? (
          <View style={[styles.approve, styles.approvedBadge]}>
            <Text style={[styles.approveText, styles.approvedText]}>Approved ✓</Text>
          </View>
        ) : (
          <Pressable style={[styles.approve, toBuy === 0 && styles.disabled]} onPress={approve} disabled={toBuy === 0}>
            <Text style={styles.approveText}>Approve list</Text>
          </Pressable>
        )}
      </View>

      {sections.length === 0 ? (
        <View style={styles.fill}>
          {suggestionBlock}
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No items yet. Go to Chat and tell me what you need.</Text>
          </View>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(i) => i.id}
          ListHeaderComponent={suggestionBlock || null}
          renderSectionHeader={({ section: { title } }) => (
            <Text style={styles.section}>{title}</Text>
          )}
          renderItem={({ item }) => (
            <ItemRow
              item={item}
              onTogglePurchased={() => item.status === 'pending' && markPurchased(item.id)}
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
  approvedBadge: { backgroundColor: 'transparent', borderWidth: 1, borderColor: theme.colors.primary },
  approvedText: { color: theme.colors.primary },
  disabled: { opacity: 0.5 },
  section: {
    paddingHorizontal: 14, paddingVertical: 6, backgroundColor: theme.colors.bg,
    color: theme.colors.textMuted, fontWeight: '700', fontSize: theme.font.small,
    textTransform: 'uppercase', letterSpacing: 1,
  },
  suggestBox: {
    margin: 10, padding: 12, borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.accent,
  },
  suggestTitle: { fontWeight: '700', color: theme.colors.accent, marginBottom: 6 },
  predictBox: { borderColor: theme.colors.border },
  predictTitle: { fontWeight: '700', color: theme.colors.textMuted },
  suggestRow: { paddingVertical: 6 },
  suggestText: { color: theme.colors.text, fontSize: theme.font.body },
  chips: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 },
  chip: {
    backgroundColor: theme.colors.chipBg, borderColor: theme.colors.chipBorder, borderWidth: 1,
    borderRadius: theme.radius.pill, paddingHorizontal: 12, paddingVertical: 6, marginRight: 8, marginBottom: 4,
  },
  chipText: { color: theme.colors.chipText, fontWeight: '600' },
  chipQuiet: { backgroundColor: 'transparent', borderColor: theme.colors.border },
  chipQuietText: { color: theme.colors.textMuted },
  fill: { flex: 1 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 30 },
  emptyText: { color: theme.colors.textMuted, textAlign: 'center' },
});
