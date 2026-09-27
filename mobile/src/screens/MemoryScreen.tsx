import React from 'react';
import { View, Text, SectionList, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '../theme';
import { useHousehold } from '../state/HouseholdContext';
import { ConfidenceDot } from '../components/ConfidenceDot';
import { confidenceLevel, effectiveConfidence, isStale } from '../state/memory';

interface MemoryRow {
  key: string;
  title: string;
  meta: string;
  confidence: number;
  stale: boolean;
  lastConfirmedAt: string;
  timesConfirmed: number;
  timesOverridden: number;
  onForget: () => void;
}

export function MemoryScreen() {
  const { state, forgetPreference, forgetAliasPreference } = useHousehold();
  const productName = (id: string) => state.products.find((p) => p.id === id)?.name ?? id;
  const now = new Date();

  const usuals: MemoryRow[] = state.preferences.map((p) => ({
    key: p.productId,
    title: productName(p.productId),
    meta: [
      p.preferredBrand,
      p.typicalQty != null ? `${p.typicalQty} ${p.typicalUnit ?? ''}`.trim() : undefined,
      p.preferredVariant,
      p.typicalIntervalDays != null ? `every ~${p.typicalIntervalDays} days` : undefined,
    ].filter(Boolean).join(' · ') || '—',
    confidence: effectiveConfidence(p, now),
    stale: isStale(p, now),
    lastConfirmedAt: p.lastConfirmedAt,
    timesConfirmed: p.timesConfirmed,
    timesOverridden: p.timesOverridden,
    onForget: () => forgetPreference(p.productId),
  }));

  const meanings: MemoryRow[] = state.aliasPreferences.map((a) => ({
    key: `alias_${a.disambiguationGroup}`,
    title: `"${a.disambiguationGroup}"`,
    meta: `usually means ${productName(a.productId).toLowerCase()}`,
    confidence: effectiveConfidence(a, now),
    stale: isStale(a, now),
    lastConfirmedAt: a.lastConfirmedAt,
    timesConfirmed: a.timesConfirmed,
    timesOverridden: a.timesOverridden,
    onForget: () => forgetAliasPreference(a.disambiguationGroup),
  }));

  const sections = [
    { title: 'Your usuals', data: usuals },
    { title: 'What you mean by…', data: meanings },
  ].filter((s) => s.data.length > 0);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Household memory</Text>
        <Text style={styles.subtitle}>What I've learned you like</Text>
      </View>
      <SectionList
        sections={sections}
        keyExtractor={(r) => r.key}
        renderSectionHeader={({ section }) => <Text style={styles.section}>{section.title}</Text>}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{item.title}</Text>
              <Text style={styles.rowMeta}>{item.meta}</Text>
              <View style={styles.confRow}>
                <ConfidenceDot level={confidenceLevel(item.confidence)} size={8} />
                <Text style={styles.rowSub}>
                  {Math.round(item.confidence * 100)}% sure · confirmed {item.timesConfirmed}×
                  {item.timesOverridden ? `, changed ${item.timesOverridden}×` : ''}
                  {item.stale ? ' · not confirmed in a while' : ''}
                </Text>
              </View>
              <Text style={styles.rowSub}>Last confirmed {new Date(item.lastConfirmedAt).toLocaleDateString()}</Text>
            </View>
            <Pressable onPress={item.onForget} hitSlop={12}>
              <Text style={styles.forget}>Forget</Text>
            </Pressable>
          </View>
        )}
        ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyText}>Nothing learned yet.</Text></View>}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  header: { paddingHorizontal: 16, paddingVertical: 12, backgroundColor: theme.colors.surfaceAlt },
  title: { fontSize: theme.font.title, fontWeight: '700', color: theme.colors.text },
  subtitle: { fontSize: theme.font.small, color: theme.colors.textMuted },
  section: {
    paddingHorizontal: 12, paddingTop: 14, paddingBottom: 6, color: theme.colors.textMuted,
    fontSize: theme.font.small, textTransform: 'uppercase', letterSpacing: 1, backgroundColor: theme.colors.bg,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', padding: 12,
    backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderColor: theme.colors.border,
  },
  rowTitle: { fontSize: theme.font.body, color: theme.colors.text, fontWeight: '600' },
  rowMeta: { color: theme.colors.text, marginTop: 2 },
  confRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  rowSub: { color: theme.colors.textMuted, fontSize: theme.font.small, marginTop: 2 },
  forget: { color: theme.colors.danger, fontWeight: '600', padding: 6 },
  empty: { padding: 30, alignItems: 'center' },
  emptyText: { color: theme.colors.textMuted },
});
