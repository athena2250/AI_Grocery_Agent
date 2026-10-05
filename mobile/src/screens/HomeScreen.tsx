import React, { useMemo } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '../theme';
import { useHousehold } from '../state/HouseholdContext';
import { useProfile } from '../state/ProfileContext';
import { useUI } from '../components/UIProvider';
import { Avatar, Button, Dot, Masthead, SectionHeading } from '../components/hearth';
import { pendingItems } from '../state/planner';
import { homeSuggestions } from '../state/prediction';
import { useAddProposal } from './useAddProposal';
import { useTasks } from '../state/TasksContext';
import { SECTIONS } from '../state/tasks';

const c = theme.colors;
const f = theme.font;

interface ListRow {
  key: string;
  dot: string;
  title: string;
  sub: string;
  action: string;
  onAction: () => void;
}

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

export function HomeScreen({ navigation }: { navigation: any }) {
  const { state, dismissRestock } = useHousehold();
  const { me, profile } = useProfile();
  const { openAdd } = useUI();
  const { tasks } = useTasks();
  const addProposal = useAddProposal();
  const now = new Date();

  const { restock } = useMemo(() => homeSuggestions(state), [state]);
  const toBuy = pendingItems(state.listItems);
  const approved = state.list.status === 'approved';

  const cards: Card[] = [];
  const question = state.pendingClarifications[state.pendingClarifications.length - 1];
  for (const p of restock) {
    const amount = p.qty != null ? `${p.qty} ${p.unit ?? ''}`.trim() : '';
    cards.push({
      key: `restock_${p.productId}`, dot: c.amber, title: `${p.product} is running out`, sub: p.rationale,
      action: amount ? `Add ${amount}` : 'Add to list', primary: true,
      onAction: () => addProposal(p),
      secondary: { label: 'Not now', onPress: () => dismissRestock(p.productId) },
    });
  }

  // One row per category with something open: groceries, then each task section from +.
  const posterNames = (ids: (string | undefined)[]) =>
    [...new Set(ids)]
      .map((id) => (id === me.id ? 'You' : profile.members.find((m) => m.id === id)?.name))
      .filter(Boolean)
      .join(', ');
  const lists: ListRow[] = [];
  if (toBuy.length > 0) {
    const from = posterNames(toBuy.map((li) => li.addedByMemberId));
    lists.push({
      key: 'groceries', dot: approved ? c.green : c.amber, title: 'Groceries',
      sub: `${toBuy.length} ${toBuy.length === 1 ? 'item' : 'items'}${from ? ` from ${from}` : ''}`,
      action: approved ? 'View list' : 'Review list',
      onAction: () => navigation.navigate('Groceries'),
    });
  }
  const taskGroups = useMemo(() => SECTIONS
    .map((section) => ({ section, items: tasks.filter((t) => t.section === section && !t.done) }))
    .filter((g) => g.items.length), [tasks]);
  for (const g of taskGroups) {
    const from = posterNames(g.items.map((t) => t.createdBy));
    lists.push({
      key: `tasks_${g.section}`, dot: c.amber, title: g.section,
      sub: `${g.items.length} ${g.items.length === 1 ? 'task' : 'tasks'}${from ? ` from ${from}` : ''}`,
      action: 'Review list',
      onAction: () => navigation.navigate('Tasks'),
    });
  }
  const open = cards.length + lists.length;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.page}>
        <Masthead
          kicker={now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
          title={greeting(now)}
          italic={me?.name}
          right={me ? (
            <Pressable onPress={() => navigation.navigate('Profile')} hitSlop={8} style={{ marginTop: 4 }} accessibilityLabel="Your profile">
              <Avatar initial={me.name[0]} color={me.color} size={44} />
            </Pressable>
          ) : null}
        />

        {question ? (
          <Pressable
            onPress={() => navigation.navigate('Conversation')}
            style={styles.ask}
            accessibilityRole="button"
            accessibilityLabel={`Hearth asks: ${question.question}. Answer`}
          >
            <Dot color={c.accent} />
            <Text style={styles.askText} numberOfLines={2}>
              <Text style={styles.askLead}>Hearth asks · </Text>
              {question.question}
            </Text>
            <Text style={styles.askAction}>Answer ›</Text>
          </Pressable>
        ) : null}

        <SectionHeading title="TODO" note={open ? `${open} ${open === 1 ? 'thing' : 'things'}` : undefined} style={{ marginTop: 26 }} />
        {open === 0 ? (
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

        {lists.map((row) => (
          <Pressable key={row.key} onPress={row.onAction} style={styles.listRow}>
            <Dot color={row.dot} style={{ transform: [{ translateY: -2 }] }} />
            <View style={{ flex: 1 }}>
              <Text style={styles.listTitle}>{row.title}</Text>
              <Text style={styles.listSub}>{row.sub}</Text>
            </View>
            <Button label={row.action} kind="outline" compact onPress={row.onAction} />
          </Pressable>
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
  ask: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 22,
    paddingVertical: 11, paddingHorizontal: 14, borderRadius: theme.radius.lg,
    backgroundColor: c.paper, borderWidth: 1, borderColor: c.accentSoft,
  },
  askText: { flex: 1, fontFamily: f.sans, fontSize: 15, lineHeight: 20, color: c.text },
  askLead: { fontFamily: f.sansBold, color: c.accent },
  askAction: { fontFamily: f.sansBold, fontSize: 14, color: c.accent },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 16, borderTopWidth: 1, borderTopColor: c.hairline },
  listTitle: { fontFamily: f.serif, fontSize: 22, lineHeight: 26, color: c.ink },
  listSub: { fontFamily: f.sans, fontSize: 14, color: c.textMuted, marginTop: 2 },
});
