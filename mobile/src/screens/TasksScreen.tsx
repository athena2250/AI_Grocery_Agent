import React, { useMemo } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '../theme';
import { CheckCircle, EmptyState, Masthead, SectionHeading } from '../components/hearth';
import { CheckIcon, TrashIcon } from '../components/icons';
import { useUI } from '../components/UIProvider';
import { useProfile } from '../state/ProfileContext';
import { useTasks, type Task } from '../state/TasksContext';
import { SECTIONS, daysLeftOnBoard, dueLabel, isOverdue } from '../state/tasks';
import { detailsLine } from '../state/taskFields';

const c = theme.colors;

/**
 * Tasks tab: what the family added from +, by section; tap to tick off. A
 * finished task stays for KEEP_ON_BOARD_DAYS so everyone sees it, then moves to
 * Task history.
 */
export function TasksScreen() {
  const { tasks, toggleTask, removeTask } = useTasks();
  const { profile } = useProfile();
  const { openAddTask, ask, flash } = useUI();

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
          onCta={() => openAddTask()}
        />
      </SafeAreaView>
    );
  }

  // Small button, so a stray tap only opens the confirm — nothing is deleted without it.
  const confirmDelete = (t: Task) => ask({
    title: `Delete "${t.title}"?`,
    body: 'For a task added by mistake. It won\'t go to Task history.',
    options: [{ label: 'Delete task', kind: 'danger', onPress: () => { removeTask(t.id); flash('Task deleted', c.red); } }],
  });

  const row = (t: Task) => {
    const name = (id: string) => profile.members.find((m) => m.id === id)?.name;
    const who = t.whoId ? name(t.whoId) : undefined;
    const extra = detailsLine(t, name);
    const late = !t.done && isOverdue(t.due);
    const left = daysLeftOnBoard(t);
    return (
      <Pressable key={t.id} onPress={() => toggleTask(t.id)} style={styles.row}>
        <CheckCircle on={t.done} onColor={c.green} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, t.done && styles.done]}>{t.title}</Text>
          <Text style={[styles.meta, late && styles.late]}>
            {[who, t.due === null ? null : dueLabel(t.due), late ? 'overdue' : null].filter(Boolean).join(' · ')}
          </Text>
          {extra ? <Text style={styles.meta}>{extra}</Text> : null}
          {left != null ? (
            <Text style={styles.clears}>{t.done ? 'Done' : 'Saved before task details'} · clears {left === 0 ? 'today' : `in ${left} ${left === 1 ? 'day' : 'days'}`}</Text>
          ) : null}
          {t.notes ? <Text style={styles.notes} numberOfLines={2}>{t.notes}</Text> : null}
        </View>
        <Pressable
          onPress={() => confirmDelete(t)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Delete ${t.title}`}
          style={({ pressed }) => [styles.delete, pressed && { opacity: 0.5 }]}
        >
          <TrashIcon size={16} color={c.textFaint} />
        </Pressable>
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
  late: { color: c.red },
  clears: { fontFamily: theme.font.sans, fontSize: 12, color: c.textFaint, marginTop: 3 },
  delete: { padding: 4, marginTop: 2 },
  notes: { fontFamily: theme.font.serifItalic, fontSize: 15, color: c.textSoft, marginTop: 4 },
});
