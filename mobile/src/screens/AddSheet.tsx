import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { theme } from '../theme';
import { Button, Chip, Dot, FieldRow, Kicker, Sheet } from '../components/hearth';
import { useUI } from '../components/UIProvider';
import { useProfile } from '../state/ProfileContext';
import { useTasks } from '../state/TasksContext';
import { SECTIONS, dueChoices, dueLabel, fillTask, withMissing, type Section, type TaskDraft } from '../state/tasks';

const c = theme.colors;

/**
 * The + sheet: Add task · Add section · Additional information, then "Fill
 * with Hearth AI". A grocery item goes to Add item (AddItemSheet); other grocery
 * text to the grocery AI (ComposeSheet); every
 * other section is filled by `fillTask`, which asks — as chips — for whoever
 * does it and by when when the words don't say. Save stays off until it's complete.
 */
export function AddSheet({ visible, onClose, onCompose, onAddItem }: {
  visible: boolean; onClose: () => void; onCompose: (seed?: string) => void; onAddItem: (seed?: string) => void;
}) {
  const { flash } = useUI();
  const { me, activeMembers } = useProfile();
  const { addTask } = useTasks();
  const [title, setTitle] = useState('');
  const [section, setSection] = useState<Section | null>(null);
  const [info, setInfo] = useState('');
  const [draft, setDraft] = useState<TaskDraft | null>(null);

  // Every way out starts the next + fresh.
  const reset = () => { setTitle(''); setSection(null); setInfo(''); setDraft(null); };
  const close = () => { reset(); onClose(); };
  const compose = (seed: string) => { reset(); onCompose(seed); };

  // Any edit to the form makes the filled-in draft stale.
  const edit = <T,>(set: (v: T) => void) => (v: T) => { set(v); setDraft(null); };

  const fill = () => {
    // One grocery item → "Add item" (identify it, then its details); free text with no item name → the grocery AI.
    if (section === 'Groceries' && title.trim()) {
      const seed = title.trim();
      reset();
      onAddItem(seed);
      return;
    }
    if (section === 'Groceries') {
      compose([title, info].map((s) => s.trim()).filter(Boolean).join(', '));
      return;
    }
    const d = fillTask({ title, section, info }, activeMembers, me.id);
    setDraft(d);
    if (d.section && !section) setSection(d.section);
  };

  const answer = (patch: Partial<TaskDraft>) => setDraft((d) => (d ? withMissing({ ...d, ...patch }) : d));

  const save = () => {
    if (!draft || draft.missing.length || !draft.section || !draft.whoId || draft.due === undefined) return;
    addTask({ title: draft.title, section: draft.section, notes: draft.notes, whoId: draft.whoId, due: draft.due });
    close();
    flash(`Added to ${draft.section}`);
  };

  const who = activeMembers.find((m) => m.id === draft?.whoId);
  const canFill = !!(title.trim() || info.trim());

  const footer = !draft ? (
    <Button kind="accent" label="✦  Fill with Hearth AI" onPress={fill} disabled={!canFill} />
  ) : (
    <Button
      kind="accent"
      label={draft.missing.length ? `${draft.missing.length} more to answer` : 'Save task'}
      onPress={save}
      disabled={draft.missing.length > 0}
    />
  );

  return (
    <Sheet visible={visible} onClose={close} tall={!!draft} title="Add to your journal" footer={footer}>
      <Kicker style={styles.kicker}>Add task</Kicker>
      <TextInput
        style={styles.input}
        value={title}
        onChangeText={edit(setTitle)}
        placeholder="e.g. Kitchen tap is leaking"
        placeholderTextColor={c.textFaint}
      />

      <Kicker style={styles.kicker}>Add section</Kicker>
      <View style={styles.chips}>
        {SECTIONS.map((s) => (
          <Chip key={s} label={s} suggested={section === s} onPress={() => edit(setSection)(section === s ? null : s)} />
        ))}
      </View>

      <Kicker style={styles.kicker}>Additional information</Kicker>
      <TextInput
        style={[styles.input, styles.multi]}
        value={info}
        onChangeText={edit(setInfo)}
        multiline
        placeholder="Who should do it, by when, anything else…"
        placeholderTextColor={c.textFaint}
      />

      {draft ? (
        <View style={{ marginTop: 22 }}>
          <View style={styles.filled}>
            <Dot color={draft.missing.length ? c.amber : c.green} />
            <Text style={styles.filledText}>
              {draft.missing.length ? 'Hearth filled what it could — a little more, please.' : 'Hearth filled this in — check it before saving.'}
            </Text>
          </View>

          <FieldRow k="Task" v={draft.title || 'Add a task above'} />
          <FieldRow k="Section" v={draft.section ? `${draft.section}${draft.sectionFromAI ? '  · from your words' : ''}` : 'Pick a section above'} />

          <FieldRow k="Who does it" v={who?.name ?? 'Not said yet'} />
          <View style={styles.chips}>
            {activeMembers.map((m) => (
              <Chip key={m.id} label={m.id === me.id ? `${m.name} (me)` : m.name} suggested={m.id === draft.whoId} onPress={() => answer({ whoId: m.id })} />
            ))}
          </View>

          <FieldRow k="By when" v={draft.due === undefined ? 'Not said yet' : dueLabel(draft.due)} />
          <View style={styles.chips}>
            {dueChoices().map((o) => (
              <Chip key={o.label} label={o.label} suggested={o.due === draft.due} quiet={o.due === null} onPress={() => answer({ due: o.due })} />
            ))}
          </View>

          {draft.notes ? <FieldRow k="Notes" v={draft.notes} /> : null}
        </View>
      ) : (
        <Pressable onPress={() => compose('')} style={styles.freeform}>
          <Text style={styles.freeformText}>Or just type or speak it in your words ›</Text>
        </Pressable>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  kicker: { fontSize: 11, letterSpacing: 2, marginTop: 18, marginBottom: 10 },
  input: {
    borderWidth: 1, borderColor: c.border, borderRadius: 12, backgroundColor: c.paper,
    paddingHorizontal: 14, paddingVertical: 12, fontFamily: theme.font.serif, fontSize: 18, color: c.ink,
  },
  multi: { minHeight: 76, textAlignVertical: 'top' },
  chips: { flexDirection: 'row', flexWrap: 'wrap' },
  filled: {
    flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 12, marginBottom: 4,
    borderTopWidth: 1, borderTopColor: c.ink,
  },
  filledText: { fontFamily: theme.font.sansMedium, fontSize: 14, color: c.textSoft, flex: 1 },
  freeform: { paddingVertical: 16, marginTop: 8 },
  freeformText: { fontFamily: theme.font.serifItalic, fontSize: 16, color: c.textSoft, textAlign: 'center' },
});
