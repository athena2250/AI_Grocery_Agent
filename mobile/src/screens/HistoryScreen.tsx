import React from 'react';
import { View, Text, FlatList, StyleSheet, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '../theme';
import { useHousehold } from '../state/HouseholdContext';

export function HistoryScreen() {
  const { state, reset } = useHousehold();
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Purchase history</Text>
          <Text style={styles.subtitle}>{state.history.length} purchases</Text>
        </View>
        <Pressable
          onPress={() =>
            Alert.alert('Reset sandbox?', 'Clear all state and reload seed data.', [
              { text: 'Cancel' },
              { text: 'Reset', style: 'destructive', onPress: () => reset() },
            ])
          }
        >
          <Text style={styles.reset}>Reset</Text>
        </Pressable>
      </View>
      <FlatList
        data={state.history}
        keyExtractor={(h) => h.id}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{item.product}{item.brand ? ` · ${item.brand}` : ''}</Text>
              <Text style={styles.rowMeta}>{item.qty ?? '?'} {item.unit ?? ''}</Text>
            </View>
            <Text style={styles.date}>{new Date(item.purchasedAt).toLocaleDateString()}</Text>
          </View>
        )}
        ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyText}>No purchases yet.</Text></View>}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12, backgroundColor: theme.colors.surfaceAlt,
  },
  title: { fontSize: theme.font.title, fontWeight: '700', color: theme.colors.text },
  subtitle: { fontSize: theme.font.small, color: theme.colors.textMuted },
  reset: { color: theme.colors.danger, fontWeight: '700' },
  row: {
    flexDirection: 'row', alignItems: 'center', padding: 12,
    backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderColor: theme.colors.border,
  },
  rowTitle: { fontSize: theme.font.body, color: theme.colors.text, fontWeight: '600' },
  rowMeta: { color: theme.colors.textMuted, fontSize: theme.font.small, marginTop: 2 },
  date: { color: theme.colors.textMuted, fontSize: theme.font.small },
  empty: { padding: 30, alignItems: 'center' },
  emptyText: { color: theme.colors.textMuted },
});
