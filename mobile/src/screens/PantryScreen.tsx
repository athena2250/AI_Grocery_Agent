import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { theme } from '../theme';
import { useHousehold } from '../state/HouseholdContext';
import { INVENTORY_STATES } from '../state/inventory';
import { useUI } from '../components/UIProvider';
import { SubScreen } from '../components/SubScreen';
import { Dot, EmptyState } from '../components/hearth';
import type { InventoryEntry, InventoryState } from '../types';

const c = theme.colors;
const f = theme.font;

const stateLabel: Record<InventoryState, string> = {
  available: 'Available',
  running_low: 'Running low',
  almost_finished: 'Almost finished',
  out: 'Out of stock',
};

/** Three sections (plan_06): "almost finished" sits under Running low, tagged, at the top. */
type SectionKey = 'available' | 'low' | 'out';
const SECTIONS: { key: SectionKey; title: string; dot: string; states: InventoryState[] }[] = [
  { key: 'low', title: 'Running low', dot: c.amber, states: ['almost_finished', 'running_low'] },
  { key: 'out', title: 'Out of stock', dot: c.red, states: ['out'] },
  { key: 'available', title: 'Available', dot: c.green, states: ['available'] },
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
  const { ask } = useUI();
  const [collapsed, setCollapsed] = useState<Set<SectionKey>>(new Set());

  const productName = (id: string) => state.products.find((p) => p.id === id)?.name ?? id;

  const sections = useMemo(() => {
    const now = new Date();
    return SECTIONS.map((s) => {
      const rows = state.inventory
        .filter((i) => s.states.includes(i.state))
        .sort((a, b) => s.states.indexOf(a.state) - s.states.indexOf(b.state));
      return { ...s, now, rows };
    }).filter((s) => s.rows.length > 0);
  }, [state.inventory]);

  const toggle = (key: SectionKey) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const changeState = (entry: InventoryEntry) => ask({
    title: productName(entry.productId),
    body: `Now: ${stateLabel[entry.state].toLowerCase()}. Change it to…`,
    options: INVENTORY_STATES.filter((s) => s !== entry.state).map((s) => ({
      label: stateLabel[s],
      kind: 'outline' as const,
      onPress: () => setInventory({ productId: entry.productId, state: s }),
    })),
  });

  return (
    <SubScreen kicker="Pantry" title="What's at home" sub="Tell Hearth in your words — or tap an item to change it.">
      {state.inventory.length === 0 ? (
        <EmptyState title="Nothing noted yet" body="Say “rice is almost finished” and it shows up here." />
      ) : (
        <ScrollView contentContainerStyle={styles.page}>
          {sections.map((section) => (
            <View key={section.key}>
              <Pressable onPress={() => toggle(section.key)} style={styles.sectionHead}>
                <Dot color={section.dot} />
                <Text style={styles.sectionTitle}>{section.title.toUpperCase()}</Text>
                <Text style={styles.sectionNote}>{section.rows.length}  {collapsed.has(section.key) ? '+' : '–'}</Text>
              </Pressable>
              {!collapsed.has(section.key) && section.rows.map((item) => (
                <Pressable key={item.productId} onPress={() => changeState(item)} style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{productName(item.productId)}</Text>
                    <Text style={styles.rowMeta}>
                      {item.approxQty != null ? `~${item.approxQty} ${item.approxUnit} · ` : ''}updated {updatedAgo(item.updatedAt, section.now)}
                    </Text>
                  </View>
                  {item.state === 'almost_finished' && <Text style={styles.tag}>Almost finished</Text>}
                </Pressable>
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
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 30, marginBottom: 4 },
  sectionTitle: { flex: 1, fontFamily: f.sansHeavy, fontSize: 13, letterSpacing: 3, color: c.ink },
  sectionNote: { fontFamily: f.sansMedium, fontSize: 14, color: c.textFaint },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderTopWidth: 1, borderTopColor: c.hairline },
  rowTitle: { fontFamily: f.serif, fontSize: 20, color: c.ink },
  rowMeta: { fontFamily: f.sans, fontSize: 13, color: c.textFaint, marginTop: 2 },
  tag: {
    fontFamily: f.sansBold, fontSize: 12, color: c.amber, borderWidth: 1, borderColor: c.amber,
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, overflow: 'hidden',
  },
});
