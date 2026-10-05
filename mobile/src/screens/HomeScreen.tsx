import React, { useMemo } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '../theme';
import { useHousehold } from '../state/HouseholdContext';
import { useProfile } from '../state/ProfileContext';
import { useUI } from '../components/UIProvider';
import { Avatar, Button, Dot, Masthead, SectionHeading } from '../components/hearth';
import { pendingItems } from '../state/planner';
import { homeSuggestions, predict } from '../state/prediction';
import { useAddProposal } from './useAddProposal';

const c = theme.colors;
const f = theme.font;
const DAY_MS = 86_400_000;

interface Card {
  key: string;
  dot: string;
  title: string;
  sub: string;
  action: string;
  primary?: boolean;
  onAction: () => void;
  secondary?: { label: string; onPress: () => void };
}

const greeting = (d: Date) => (d.getHours() < 12 ? 'Good morning,' : d.getHours() < 17 ? 'Good afternoon,' : 'Good evening,');
const shortDate = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

export function HomeScreen({ navigation }: { navigation: any }) {
  const { state, dismissRestock } = useHousehold();
  const { me, activeMembers } = useProfile();
  const { openAdd } = useUI();
  const addProposal = useAddProposal();
  const now = new Date();

  const { restock, predicted } = useMemo(() => homeSuggestions(state), [state]);
  const toBuy = pendingItems(state.listItems).length;
  const approved = state.list.status === 'approved';

  const cards: Card[] = [];
  const question = state.pendingClarifications[state.pendingClarifications.length - 1];
  if (question) {
    cards.push({
      key: 'question', dot: c.red, title: 'Hearth has a question', sub: question.question,
      action: 'Answer', primary: true, onAction: () => navigation.navigate('Conversation'),
    });
  }
  for (const p of restock) {
    const amount = p.qty != null ? `${p.qty} ${p.unit ?? ''}`.trim() : '';
    cards.push({
      key: `restock_${p.productId}`, dot: c.amber, title: `${p.product} is running out`, sub: p.rationale,
      action: amount ? `Add ${amount}` : 'Add to list', primary: !question,
      onAction: () => addProposal(p),
      secondary: { label: 'Not now', onPress: () => dismissRestock(p.productId) },
    });
  }
  if (toBuy > 0) {
    cards.push({
      key: 'groceries', dot: approved ? c.green : c.amber, title: 'Groceries',
      sub: `${toBuy} ${toBuy === 1 ? 'item' : 'items'} to buy · ${approved ? 'approved, ready for the store' : 'waiting for your OK'}`,
      action: approved ? 'View list' : 'Review list',
      onAction: () => navigation.navigate('Groceries'),
    });
  }

  // Upcoming: what the purchase history says is due soon (plan_10 statistics), soonest first.
  const upcoming = useMemo(() => {
    const onList = new Set(pendingItems(state.listItems).map((li) => li.productId));
    const askable = new Map(predicted.map((p) => [p.productId, p]));
    const at = new Date();
    return predict(state.history, state.inventory, at)
      .filter((p) => p.status !== 'NOT_NEEDED' && !onList.has(p.productId) && !restock.some((r) => r.productId === p.productId))
      .map((p) => {
        const due = new Date(new Date(p.lastPurchasedAt).getTime() + p.meanIntervalDays * DAY_MS);
        const name = state.products.find((x) => x.id === p.productId)?.name ?? p.productId;
        return { id: p.productId, name, due, proposal: askable.get(p.productId), status: p.status };
      })
      .sort((a, b) => a.due.getTime() - b.due.getTime())
      .slice(0, 4);
  }, [state, predicted, restock]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.page}>
        <Masthead
          kicker={now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
          title={greeting(now)}
          italic={me?.name}
          right={me ? <View style={{ marginTop: 4 }}><Avatar initial={me.name[0]} color={me.color} size={44} /></View> : null}
        />

        <SectionHeading title="Today" note={cards.length ? `${cards.length} ${cards.length === 1 ? 'thing' : 'things'}` : undefined} style={{ marginTop: 26 }} />
        {cards.length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.calm}>Nothing needs you today.</Text>
            <Button label="Add something" kind="outline" compact onPress={openAdd} style={{ marginTop: 14 }} />
          </View>
        ) : cards.map((card) => (
          <View key={card.key} style={styles.card}>
            <View style={styles.cardHead}>
              <Dot color={card.dot} style={{ transform: [{ translateY: -2 }] }} />
              <Text style={styles.cardTitle}>{card.title}</Text>
            </View>
            <Text style={styles.cardSub}>{card.sub}</Text>
            <View style={styles.cardActions}>
              <Button label={card.action} kind={card.primary ? 'accent' : 'outline'} compact onPress={card.onAction} />
              {card.secondary ? (
                <Pressable onPress={card.secondary.onPress} hitSlop={8} style={styles.secondary}>
                  <Text style={styles.secondaryText}>{card.secondary.label}</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ))}

        <SectionHeading title="Upcoming" />
        {upcoming.length === 0 ? (
          <Text style={[styles.cardSub, styles.upEmpty]}>Nothing due soon. Hearth learns your rhythm as you shop.</Text>
        ) : upcoming.map((u) => (
          <Pressable
            key={u.id}
            disabled={!u.proposal}
            onPress={() => u.proposal && addProposal(u.proposal)}
            style={styles.upRow}
          >
            <Text style={styles.upDate}>{u.due <= now ? 'DUE' : shortDate(u.due).toUpperCase()}</Text>
            <Text style={styles.upTitle}>{u.name}</Text>
            <Dot color={u.status === 'BUY_NOW' ? c.amber : c.green} style={{ transform: [{ translateY: -4 }] }} />
          </Pressable>
        ))}

        <SectionHeading title="Your family" />
        {activeMembers.map((m) => (
          <View key={m.name} style={styles.famRow}>
            <Avatar initial={m.name[0]} color={m.color} size={42} />
            <View style={{ flex: 1 }}>
              <Text style={styles.famName}>{m.name}</Text>
              <Text style={styles.famRole}>{m.role}</Text>
            </View>
            {m === me ? <Text style={styles.famNote}>This phone</Text> : null}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.bg },
  page: { paddingTop: 8, paddingHorizontal: theme.gutter, paddingBottom: 48 },
  card: { paddingVertical: 18, borderTopWidth: 1, borderTopColor: c.hairline },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  cardTitle: { flex: 1, fontFamily: f.serif, fontSize: 24, lineHeight: 27, color: c.ink },
  cardSub: { fontFamily: f.sans, fontSize: 15, lineHeight: 21, color: c.textMuted, marginTop: 5, paddingLeft: 16 },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: 18, paddingLeft: 16, marginTop: 14 },
  secondary: { paddingVertical: 8 },
  secondaryText: { fontFamily: f.sansBold, fontSize: 14, color: c.textFaint },
  calm: { fontFamily: f.serifItalic, fontSize: 20, color: c.textSoft },
  upEmpty: { paddingLeft: 0, paddingVertical: 15, borderTopWidth: 1, borderTopColor: c.hairline, marginTop: 0 },
  upRow: { flexDirection: 'row', alignItems: 'center', gap: 18, paddingVertical: 15, borderTopWidth: 1, borderTopColor: c.hairline },
  upDate: { width: 56, fontFamily: f.sansBold, fontSize: 12, letterSpacing: 1, color: c.textFaint },
  upTitle: { flex: 1, fontFamily: f.serif, fontSize: 20, color: c.ink },
  famRow: { flexDirection: 'row', alignItems: 'center', gap: 15, paddingVertical: 14, borderTopWidth: 1, borderTopColor: c.hairline },
  famName: { fontFamily: f.serif, fontSize: 20, color: c.ink },
  famRole: { fontFamily: f.sans, fontSize: 13, letterSpacing: 0.4, color: c.textFaint },
  famNote: { fontFamily: f.sansMedium, fontSize: 13, color: c.textMuted },
});
