import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '../theme';
import { useHousehold } from '../state/HouseholdContext';
import { ItemRow } from '../components/ItemRow';
import type { ListItem, ProposedItem } from '../types';
import { groupByCategory, pendingItems, visibleItems } from '../state/planner';
import { homeSuggestions } from '../state/prediction';
import { ItemDetailModal } from './ItemDetailModal';
import { useAddProposal } from './useAddProposal';
import { useUI } from '../components/UIProvider';
import { Button, Dot, EmptyState, Masthead, SectionHeading } from '../components/hearth';
import { CartIcon } from '../components/icons';

const c = theme.colors;
const f = theme.font;

/** Groceries tab: the draft/approved list by store aisle, plus restock and predicted suggestions. */
export function ListScreen() {
  const { state, markPurchased, approveList, dismissRestock, dismissPrediction } = useHousehold();
  const { ask, flash, openCompose } = useUI();
  const addProposal = useAddProposal();
  const [selected, setSelected] = useState<ListItem | null>(null);
  const [suggestedOpen, setSuggestedOpen] = useState(false);

  const sections = useMemo(() => groupByCategory(visibleItems(state.listItems)), [state.listItems]);
  const { restock, predicted } = useMemo(() => homeSuggestions(state), [state]);

  const toBuy = pendingItems(state.listItems).length;
  const approved = state.list.status === 'approved';

  const approve = () => ask({
    title: 'Approve this list?',
    body: `${toBuy} ${toBuy === 1 ? 'item' : 'items'}, ready to take to the store.`,
    options: [{ label: 'Approve', kind: 'accent', onPress: () => { approveList(); flash('List approved'); } }],
  });

  const suggestionRow = (p: ProposedItem, dismiss: (productId: string) => void) => (
    <View key={p.id} style={styles.suggest}>
      <Text style={styles.suggestName}>{p.product}</Text>
      <Text style={styles.suggestWhy}>{p.rationale}</Text>
      <View style={styles.suggestActions}>
        <Button
          compact kind="accent"
          label={`Add${p.qty != null ? ` ${p.qty} ${p.unit ?? ''}` : ''}`.trim()}
          onPress={() => addProposal(p)}
        />
        <Pressable onPress={() => dismiss(p.productId)} hitSlop={8} style={{ paddingVertical: 8 }}>
          <Text style={styles.notNow}>Not now</Text>
        </Pressable>
      </View>
    </View>
  );

  const suggestions = (
    <>
      {restock.length > 0 && (
        <>
          <SectionHeading title="Running out at home" note={`${restock.length}`} style={{ marginTop: 26 }} />
          {restock.map((p) => suggestionRow(p, dismissRestock))}
        </>
      )}
      {/* Purchase predictions (plan_10): collapsed by default, kept apart from what Mom added herself. */}
      {predicted.length > 0 && (
        <Pressable onPress={() => setSuggestedOpen((o) => !o)} style={styles.predictToggle}>
          <Dot color={c.green} />
          <Text style={styles.predictText}>
            {predicted.length} usually bought around now
          </Text>
          <Text style={styles.predictChev}>{suggestedOpen ? '–' : '+'}</Text>
        </Pressable>
      )}
      {suggestedOpen && predicted.map((p) => suggestionRow(p, dismissPrediction))}
    </>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.page}>
        <Masthead
          kicker="Groceries"
          title={sections.length ? 'Your list' : 'Groceries'}
          sub={sections.length ? `${toBuy} to buy · ${approved ? 'approved' : 'draft'}` : undefined}
          right={sections.length ? (
            approved ? (
              <View style={styles.approved}><Text style={styles.approvedText}>Approved ✓</Text></View>
            ) : (
              <Button label="Approve" kind="ink" compact onPress={approve} disabled={toBuy === 0} style={{ marginTop: 22 }} />
            )
          ) : undefined}
        />

        {suggestions}

        {sections.length === 0 ? (
          <View style={{ minHeight: 420 }}>
            <EmptyState
              icon={<CartIcon size={40} color="#C0B6A3" strokeWidth={1.3} />}
              title="Your list is empty"
              body="Add groceries by typing or speaking — they sort neatly into aisles."
              cta="Add groceries"
              onCta={() => openCompose('')}
            />
          </View>
        ) : sections.map((section) => (
          <View key={section.title}>
            <SectionHeading title={section.title} note={`${section.data.length}`} style={{ marginTop: 30 }} />
            {section.data.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                onTogglePurchased={() => {
                  if (item.status !== 'pending') return;
                  markPurchased(item.id);
                  flash(`${item.product} bought`);
                }}
                onPress={() => setSelected(item)}
              />
            ))}
          </View>
        ))}
      </ScrollView>

      <ItemDetailModal item={selected} onClose={() => setSelected(null)} onSaved={(m) => flash(m, c.accent)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.bg },
  page: { paddingTop: 8, paddingHorizontal: theme.gutter, paddingBottom: 48 },
  approved: { marginTop: 22, paddingVertical: 10, paddingHorizontal: 14, borderRadius: theme.radius.sm, borderWidth: 1, borderColor: c.green },
  approvedText: { fontFamily: f.sansBold, fontSize: 14, color: c.green },
  suggest: { paddingVertical: 16, borderTopWidth: 1, borderTopColor: c.hairline },
  suggestName: { fontFamily: f.serif, fontSize: 22, color: c.ink },
  suggestWhy: { fontFamily: f.sans, fontSize: 14, lineHeight: 20, color: c.textMuted, marginTop: 4 },
  suggestActions: { flexDirection: 'row', alignItems: 'center', gap: 18, marginTop: 12 },
  notNow: { fontFamily: f.sansBold, fontSize: 14, color: c.textFaint },
  predictToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 22,
    paddingVertical: 13, borderTopWidth: 1, borderBottomWidth: 1, borderColor: c.hairline,
  },
  predictText: { flex: 1, fontFamily: f.sansMedium, fontSize: 14, color: c.textSoft },
  predictChev: { fontFamily: f.sansBold, fontSize: 18, color: c.textFaint },
});
