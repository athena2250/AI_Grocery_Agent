import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { theme } from '../theme';
import { Button, Chip, CloseButton, Dot, FieldRow, Kicker, Sheet } from '../components/hearth';
import { TaskFieldInput } from '../components/TaskFieldInput';
import { useUI } from '../components/UIProvider';
import { useProfile } from '../state/ProfileContext';
import { useTasks } from '../state/TasksContext';
import { SECTIONS, dueLabel, type Section } from '../state/tasks';
import { draftFromText, identifyTask, withCatalog } from '../state/identifyTask';
import { answer, draftToTask, fieldsFor, missingLabels, withSection, type TaskDraft } from '../state/taskFields';
import { suggestedWho } from '../state/taskMemory';
import type { CatalogTask } from '../data/taskCatalog';

const c = theme.colors;
/** Task sections — groceries have their own button on the + chooser. */
const TASK_SECTIONS = SECTIONS.filter((s) => s !== 'Groceries');

/**
 * + → Task, in two pages like Add item. 1: she types what needs doing and
 * Hearth works out what it is from the task catalog ("plumber" → Home Repair).
 * 2: the fields that kind of task needs (backend `post_kind_field`) — who, by
 * when, amount, from/to … Memory and keyword guesses only mark chips; Add stays
 * off until every required field is answered.
 */
export function AddTaskSheet({ seed, onClose }: { seed: string; onClose: () => void }) {
  const { flash, openCompose } = useUI();
  const { me, activeMembers } = useProfile();
  const { addTask, taskPrefs } = useTasks();
  const [step, setStep] = useState<'name' | 'details'>('name');
  const [text, setText] = useState(seed);
  const [draft, setDraft] = useState<TaskDraft | null>(null);

  const match = useMemo(() => identifyTask(text), [text]);
  const activeIds = activeMembers.map((m) => m.id);

  const next = () => {
    if (!text.trim()) return;
    setDraft(draftFromText(text, activeMembers, me.id));
    setStep('details');
  };

  const pickCatalog = (entry: CatalogTask) => setDraft((d) => (d ? withCatalog(withSection(d, entry.section), entry) : d));
  const pickSection = (s: Section) => setDraft((d) => (d ? withSection({ ...d, catalogId: undefined }, s) : d));

  // ── Page 1: what needs doing? ──
  if (step === 'name' || !draft) {
    const n = match?.candidates.length ?? 0;
    const preview = !match ? null
      : n === 1 ? `${match.candidates[0].section} › ${match.candidates[0].name}`
        : n > 1 ? `${match.candidates.length} kinds — ${match.candidates.map((e) => e.name).join(' or ')}`
          : `New task${match.guess ? ` — maybe ${match.guess}` : ''}`;
    return (
      <Sheet
        visible
        onClose={onClose}
        title="Add task"
        right={<CloseButton onPress={onClose} />}
        footer={<Button kind="accent" label="Next ›" onPress={next} disabled={!text.trim()} />}
      >
        <TextInput
          style={styles.big}
          value={text}
          onChangeText={setText}
          autoFocus
          placeholder="e.g. Kitchen tap leaking, pay current bill"
          placeholderTextColor={c.textFaint}
          onSubmitEditing={next}
          returnKeyType="next"
        />
        {preview ? (
          <View style={styles.preview}>
            <Dot color={n ? c.green : c.amber} />
            <Text style={styles.previewText}>{preview}</Text>
          </View>
        ) : null}
        <Pressable onPress={() => openCompose(text)} style={styles.freeform}>
          <Text style={styles.freeformText}>Several things at once? Type or speak it ›</Text>
        </Pressable>
      </Sheet>
    );
  }

  // ── Page 2: the details this kind of task needs ──
  const candidates = match?.candidates ?? [];
  const fields = draft.section ? fieldsFor(draft) : [];
  const missing = missingLabels(draft);
  const marked = suggestedWho(taskPrefs, draft, activeIds);
  const entry = candidates.find((e) => e.id === draft.catalogId);

  const save = () => {
    const t = draftToTask(draft);
    if (!t) return;
    addTask(t);
    onClose();
    flash(`Added to ${t.section}${t.due ? ` · ${dueLabel(t.due)}` : ''}`);
  };

  const fieldBlock = (required: boolean) => fields
    .filter((fl) => fl.required === required)
    .map((fl) => (
      <View key={fl.key}>
        <Kicker style={styles.kicker}>{fl.question}</Kicker>
        <TaskFieldInput
          field={fl}
          draft={draft}
          onAnswer={(v) => setDraft((d) => (d ? answer(d, fl, v) : d))}
          members={activeMembers}
          meId={me.id}
          suggestedWhoId={marked}
        />
      </View>
    ));

  return (
    <Sheet
      visible
      onClose={onClose}
      tall
      title={draft.title || 'New task'}
      sub={draft.section ? `${draft.section}${entry ? ` › ${entry.name}` : ''}` : 'What kind of task is it?'}
      right={<CloseButton onPress={onClose} />}
      footer={
        <Button
          kind="accent"
          label={missing.length ? `Still need: ${missing.join(', ')}` : 'Add task'}
          onPress={save}
          disabled={missing.length > 0}
        />
      }
    >
      {candidates.length > 1 && (
        <>
          <Kicker style={styles.kicker}>Which one?</Kicker>
          <View style={styles.chips}>
            {candidates.map((e) => (
              <Chip key={e.id} label={draft.catalogId === e.id ? `✓ ${e.name}` : e.name} suggested={draft.catalogId === e.id} onPress={() => pickCatalog(e)} />
            ))}
          </View>
        </>
      )}

      {candidates.length === 0 && (
        <>
          <Kicker style={styles.kicker}>Which section?</Kicker>
          <View style={styles.chips}>
            {TASK_SECTIONS.map((s) => (
              <Chip
                key={s}
                label={draft.section === s ? `✓ ${s}` : s}
                suggested={draft.section ? draft.section === s : match?.guess === s}
                onPress={() => pickSection(s)}
              />
            ))}
          </View>
        </>
      )}

      {draft.section && (
        <>
          {fieldBlock(true)}
          {fields.some((fl) => !fl.required) && (
            <>
              <View style={styles.optional}><Text style={styles.optionalText}>Optional — skip if you like</Text></View>
              {fieldBlock(false)}
            </>
          )}
          <Kicker style={styles.kicker}>Anything else?</Kicker>
          <TextInput
            style={[styles.input, styles.multi]}
            value={draft.notes}
            onChangeText={(v) => setDraft((d) => (d ? { ...d, notes: v } : d))}
            multiline
            placeholder="Notes for whoever does it"
            placeholderTextColor={c.textFaint}
          />
          {draft.due ? <View style={{ marginTop: 18 }}><FieldRow k="Deadline" v={dueLabel(draft.due)} /></View> : null}
        </>
      )}

      <Button label="← Change task" kind="quiet" onPress={() => setStep('name')} style={{ marginTop: 10, paddingVertical: 12 }} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  big: {
    borderWidth: 1, borderColor: c.border, borderRadius: 14, backgroundColor: c.paper,
    paddingHorizontal: 16, paddingVertical: 14, fontFamily: theme.font.serif, fontSize: 22, color: c.ink,
  },
  preview: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingTop: 16 },
  previewText: { fontFamily: theme.font.sansMedium, fontSize: 15, color: c.textSoft, flex: 1 },
  kicker: { fontSize: 11, letterSpacing: 2, marginTop: 20, marginBottom: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap' },
  input: {
    borderWidth: 1, borderColor: c.border, borderRadius: 12, backgroundColor: c.paper, marginTop: 6,
    paddingHorizontal: 14, paddingVertical: 12, fontFamily: theme.font.serif, fontSize: 17, color: c.ink,
  },
  multi: { minHeight: 64, textAlignVertical: 'top' },
  optional: { marginTop: 26, paddingTop: 12, borderTopWidth: 1, borderTopColor: c.hairline },
  optionalText: { fontFamily: theme.font.serifItalic, fontSize: 15, color: c.textSoft },
  freeform: { paddingVertical: 16, marginTop: 14 },
  freeformText: { fontFamily: theme.font.serifItalic, fontSize: 16, color: c.textSoft, textAlign: 'center' },
});
