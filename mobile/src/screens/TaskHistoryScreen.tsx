import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { theme } from '../theme';
import { SubScreen } from '../components/SubScreen';
import { Chip, EmptyState } from '../components/hearth';
import { useProfile } from '../state/ProfileContext';
import { useTasks } from '../state/TasksContext';
import { dueLabel, type ArchivedTask } from '../state/tasks';
import { detailsLine } from '../state/taskFields';

const c = theme.colors;
const f = theme.font;

const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * Task history — every task that has left the board (finished 3 days ago, or
 * saved before task details existed), as a table for the home's admin (the
 * owner). Read-only: nothing here goes back to the family's board.
 */
export function TaskHistoryScreen() {
  const { archive } = useTasks();
  const { profile, me, ownerId } = useProfile();
  const [section, setSection] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const name = (id: string | null | undefined) => (id ? profile.members.find((m) => m.id === id)?.name : undefined);

  const sections = useMemo(() => [...new Set(archive.map((t) => t.section))], [archive]);
  const rows = useMemo(
    () => archive
      .filter((t) => !section || t.section === section)
      .sort((a, b) => b.archivedAt.localeCompare(a.archivedAt)),
    [archive, section],
  );

  if (me.id !== ownerId) {
    return (
      <SubScreen kicker="History" title="Task history">
        <EmptyState title="For the home's admin" body={`Only ${name(ownerId) ?? 'the admin'} can look up past tasks.`} />
      </SubScreen>
    );
  }

  return (
    <SubScreen kicker="History" title="Task history" sub={`${archive.length} past ${archive.length === 1 ? 'task' : 'tasks'} · only you can see this`}>
      {archive.length === 0 ? (
        <EmptyState title="Nothing here yet" body="Finished tasks stay on the board for 3 days so the family sees them, then they're kept here." />
      ) : (
        <ScrollView contentContainerStyle={styles.page}>
          <View style={styles.filters}>
            <Chip label="All" suggested={!section} quiet={!!section} onPress={() => setSection(null)} />
            {sections.map((s) => <Chip key={s} label={s} suggested={section === s} quiet={section !== s} onPress={() => setSection(s)} />)}
          </View>

          <View style={[styles.tr, styles.th]}>
            <Text style={[styles.thText, styles.colTask]}>TASK</Text>
            <Text style={[styles.thText, styles.colWho]}>WHO</Text>
            <Text style={[styles.thText, styles.colDate]}>CLEARED</Text>
          </View>
          {rows.map((t: ArchivedTask) => {
            const expanded = open === t.id;
            const extra = detailsLine(t, name);
            return (
              <Pressable key={`${t.id}_${t.archivedAt}`} onPress={() => setOpen(expanded ? null : t.id)} style={styles.tr}>
                <View style={styles.colTask}>
                  <Text style={styles.task}>{t.title}</Text>
                  <Text style={styles.sub}>{t.section}{t.reason === 'legacy' ? ' · older task' : t.done ? '' : ' · not done'}</Text>
                  {expanded && (
                    <View style={{ marginTop: 6 }}>
                      {t.due !== null ? <Text style={styles.detail}>Deadline: {dueLabel(t.due)}</Text> : null}
                      {extra ? <Text style={styles.detail}>{extra}</Text> : null}
                      <Text style={styles.detail}>Added {fmt(t.createdAt)} by {name(t.createdBy) ?? 'someone'}</Text>
                      {t.doneAt ? <Text style={styles.detail}>Done {fmt(t.doneAt)}</Text> : null}
                      {t.notes ? <Text style={styles.notes}>{t.notes}</Text> : null}
                    </View>
                  )}
                </View>
                <Text style={[styles.cell, styles.colWho]} numberOfLines={1}>{name(t.whoId) ?? '—'}</Text>
                <Text style={[styles.cell, styles.colDate]}>{fmt(t.archivedAt)}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </SubScreen>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: theme.gutter, paddingBottom: 60 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 14, marginBottom: 6 },
  tr: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 13, borderTopWidth: 1, borderTopColor: c.hairline },
  th: { borderTopColor: c.ink, paddingVertical: 8 },
  thText: { fontFamily: f.sansBold, fontSize: 11, letterSpacing: 1.5, color: c.kicker },
  colTask: { flex: 1 },
  colWho: { width: 68 },
  colDate: { width: 86, textAlign: 'right' },
  task: { fontFamily: f.serif, fontSize: 17, color: c.ink },
  sub: { fontFamily: f.sans, fontSize: 12, color: c.textFaint, marginTop: 2 },
  cell: { fontFamily: f.sans, fontSize: 13, color: c.textSoft, paddingTop: 3 },
  detail: { fontFamily: f.sans, fontSize: 13, color: c.textMuted, marginTop: 2 },
  notes: { fontFamily: f.serifItalic, fontSize: 15, color: c.textSoft, marginTop: 4 },
});
