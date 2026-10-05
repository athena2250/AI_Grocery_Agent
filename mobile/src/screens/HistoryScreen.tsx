import React from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { theme } from '../theme';
import { useHousehold } from '../state/HouseholdContext';
import { SubScreen } from '../components/SubScreen';
import { EmptyState } from '../components/hearth';

const c = theme.colors;
const f = theme.font;

export function HistoryScreen() {
  const { state } = useHousehold();
  const n = state.history.length;
  return (
    <SubScreen kicker="History" title="What we've bought" sub={`${n} ${n === 1 ? 'purchase' : 'purchases'}`}>
      <FlatList
        data={state.history}
        keyExtractor={(h) => h.id}
        contentContainerStyle={styles.page}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text style={styles.date}>
              {new Date(item.purchasedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }).toUpperCase()}
            </Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{item.product}</Text>
              <Text style={styles.rowMeta}>
                {[item.qty != null ? `${item.qty} ${item.unit ?? ''}`.trim() : null, item.brand].filter(Boolean).join(' · ') || '—'}
              </Text>
            </View>
          </View>
        )}
        ListEmptyComponent={<EmptyState title="No purchases yet" body="Tick an item on your list as bought and it lands here." />}
      />
    </SubScreen>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: theme.gutter, paddingTop: 16, paddingBottom: 60 },
  row: { flexDirection: 'row', alignItems: 'baseline', gap: 18, paddingVertical: 15, borderTopWidth: 1, borderTopColor: c.hairline },
  date: { width: 56, fontFamily: f.sansBold, fontSize: 12, letterSpacing: 1, color: c.textFaint },
  rowTitle: { fontFamily: f.serif, fontSize: 20, color: c.ink },
  rowMeta: { fontFamily: f.sans, fontSize: 13, color: c.textFaint, marginTop: 2 },
});
