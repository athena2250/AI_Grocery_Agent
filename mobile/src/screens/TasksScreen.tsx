import React, { useMemo } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '../theme';
import { CheckCircle, EmptyState, Masthead, SectionHeading } from '../components/hearth';
import { CheckIcon } from '../components/icons';
import { useUI } from '../components/UIProvider';
import { useProfile } from '../state/ProfileContext';
import { useTasks, type Task } from '../state/TasksContext';
import { SECTIONS, dueLabel } from '../state/tasks';

const c = theme.colors;

/** Tasks tab: what the family added from +, by section; tap to tick off. */
export function TasksScreen() {
  const { tasks, toggleTask } = useTasks();
  const { profile } = useProfile();
  const { openAdd } = useUI();

  const groups = useMemo(() => SECTIONS
    .map((s) => ({ section: s, items: tasks.filter((t) => t.section === s) }))
    .filter((g) => g.items.length), [tasks]);
  const open = tasks.filter((t) => !t.done).length;

  if (!tasks.length) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <EmptyState
          icon={<CheckIcon size={40} color="#C0B6A3" strokeWidth={1.3} />}
          title="Family tasks, tidy"
          body="Repairs, bills, appointments and errands — tap + to add one and Hearth will fill in the rest."
          cta="Add a task"
          onCta={openAdd}
        />
      </SafeAreaView>
    );
  }

  const row = (t: Task) => {
    const who = profile.members.find((m) => m.id === t.whoId)?.name;
    return (
      <Pressable key={t.id} onPress={() => toggleTask(t.id)} style={styles.row}>
        <CheckCircle on={t.done} onColor={c.green} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, t.done && styles.done]}>{t.title}</Text>
          <Text style={styles.meta}>{[who, dueLabel(t.due)].filter(Boolean).join(' · ')}</Text>
          {t.notes ? <Text style={styles.notes} numberOfLines={2}>{t.notes}</Text> : null}
        </View>
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.body}>
        <Masthead kicker="Tasks" title="Family tasks" sub={`${open} open`} />
        {groups.map((g) => (
          <View key={g.section}>
            <SectionHeading title={g.section} note={`${g.items.length}`} style={{ marginTop: 26 }} />
            {g.items.map(row)}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.bg },
  body: { paddingHorizontal: theme.gutter, paddingBottom: 120 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, paddingVertical: 14, borderTopWidth: 1, borderTopColor: c.hairline },
  title: { fontFamily: theme.font.serif, fontSize: 19, color: c.ink },
  done: { color: c.textFaint, textDecorationLine: 'line-through' },
  meta: { fontFamily: theme.font.sans, fontSize: 13, color: c.textMuted, marginTop: 2 },
  notes: { fontFamily: theme.font.serifItalic, fontSize: 15, color: c.textSoft, marginTop: 4 },
});
