import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { theme } from '../theme';
import { useHousehold } from '../state/HouseholdContext';
import { useUI } from '../components/UIProvider';
import { ConfidenceDot } from '../components/ConfidenceDot';
import { SubScreen } from '../components/SubScreen';
import { EmptyState, SectionHeading } from '../components/hearth';
import { confidenceLevel, effectiveConfidence, isStale } from '../state/memory';

const c = theme.colors;
const f = theme.font;

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

/** Household memory: the usuals and "what you mean by…", each with how sure Hearth is. */
export function MemoryScreen() {
  const { state, forgetPreference, forgetAliasPreference } = useHousehold();
  const { ask } = useUI();
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
    title: `“${a.disambiguationGroup}”`,
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

  const forget = (row: MemoryRow) => ask({
    title: `Forget ${row.title}?`,
    body: 'Hearth will ask again next time instead of suggesting this.',
    options: [{ label: 'Forget', kind: 'danger', onPress: row.onForget }],
  });

  return (
    <SubScreen kicker="Memory" title="What Hearth has learned" sub="Only from things you confirmed.">
      {sections.length === 0 ? (
        <EmptyState title="Nothing learned yet" body="When you confirm a usual — like “100 g coriander seeds” — it's kept here." />
      ) : (
        <ScrollView contentContainerStyle={styles.page}>
          {sections.map((s) => (
            <View key={s.title}>
              <SectionHeading title={s.title} note={`${s.data.length}`} style={{ marginTop: 28 }} />
              {s.data.map((item) => (
                <View key={item.key} style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{item.title}</Text>
                    <Text style={styles.rowMeta}>{item.meta}</Text>
                    <View style={styles.confRow}>
                      <ConfidenceDot level={confidenceLevel(item.confidence)} size={7} />
                      <Text style={styles.rowSub}>
                        {Math.round(item.confidence * 100)}% sure · confirmed {item.timesConfirmed}×
                        {item.timesOverridden ? `, changed ${item.timesOverridden}×` : ''}
                        {item.stale ? ' · not confirmed in a while' : ''}
                      </Text>
                    </View>
                    <Text style={styles.rowSub}>Last confirmed {new Date(item.lastConfirmedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</Text>
                  </View>
                  <Pressable onPress={() => forget(item)} hitSlop={12}>
                    <Text style={styles.forget}>Forget</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          ))}
        </ScrollView>
      )}
    </SubScreen>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: theme.gutter, paddingBottom: 60 },
  row: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 15, borderTopWidth: 1, borderTopColor: c.hairline },
  rowTitle: { fontFamily: f.serif, fontSize: 21, color: c.ink },
  rowMeta: { fontFamily: f.serifItalic, fontSize: 17, color: c.textSoft, marginTop: 2 },
  confRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  rowSub: { fontFamily: f.sans, fontSize: 13, color: c.textFaint, marginTop: 2 },
  forget: { fontFamily: f.sansBold, fontSize: 14, color: c.accent, paddingTop: 4, paddingLeft: 12 },
});
