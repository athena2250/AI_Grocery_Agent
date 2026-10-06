import React, { useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { theme } from '../theme';
import { useHousehold } from '../state/HouseholdContext';
import { useConversation } from '../state/useConversation';
import { Button, CheckCircle, Chip, CloseButton, Dot, Kicker, Sheet, hearthText } from '../components/hearth';
import { MicIcon } from '../components/icons';
import { useUI } from '../components/UIProvider';
import { TaskFieldInput } from '../components/TaskFieldInput';
import { useProfile } from '../state/ProfileContext';
import { useTasks } from '../state/TasksContext';
import { SECTIONS, dueLabel, type Section } from '../state/tasks';
import { splitMessage } from '../state/splitMessage';
import { draftFromText, identifyTask, withCatalog } from '../state/identifyTask';
import { answer, draftToTask, fieldsFor as fieldsOf, isComplete, missingFields, nextQuestion, withSection, type TaskDraft } from '../state/taskFields';
import { suggestedWho } from '../state/taskMemory';
import type { CatalogTask } from '../data/taskCatalog';
import type { Turn } from '../types';

const EXAMPLES = [
  'get coriander',
  "tomatoes I don't know how much",
  'rice is almost finished',
  'the usual biscuits',
  'call the plumber tomorrow',
  'pay the current bill by Friday',
];

const TASK_SECTIONS = SECTIONS.filter((s) => s !== 'Groceries');

/** A task found in the message, filled in here one question at a time. */
interface TaskCard {
  id: string;
  text: string;
  candidates: CatalogTask[];
  guess?: Section;
  draft: TaskDraft;
  /** Field being asked now; it stays until she taps Next, so typing an amount doesn't skip ahead. */
  asking: string | null;
  on: boolean;
}

const c = theme.colors;

/**
 * "Type or speak" (Hearth.html's NL sheet) for groceries and tasks together.
 * `splitMessage` sends the grocery part through the AI service (the same
 * pipeline as the conversation screen) and turns each task part into a task
 * draft that asks one question at a time (backend `post_kind_field` order).
 * Input → "Does this look right?": the agent's reply with its chips, the items
 * this session put on the list, and the tasks. Mom can untick any before
 * saving; nothing is invented, and a ticked task must be complete to save.
 */
export function ComposeSheet({ seed, onClose }: { seed: string; onClose: () => void }) {
  const { state, removeItem } = useHousehold();
  const { send, busy, liveChipTurnIds } = useConversation();
  const { flash } = useUI();
  const { me, activeMembers } = useProfile();
  const { addTask, taskPrefs } = useTasks();
  const [cards, setCards] = useState<TaskCard[]>([]);
  const [phase, setPhase] = useState<'input' | 'result'>('input');
  const [text, setText] = useState(seed);
  const [reply, setReply] = useState('');
  const [voiceHint, setVoiceHint] = useState(false);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const inputRef = useRef<TextInput>(null);
  // What existed before this sheet opened — everything after is "this session".
  const [beforeIds] = useState(() => new Set(state.listItems.map((li) => li.id)));
  const [sessionStart] = useState(state.turns.length);

  const sessionTurns = state.turns.slice(sessionStart);
  // The latest exchange, plus any earlier question from this session still waiting for an answer.
  const lastUserIdx = sessionTurns.map((t) => t.role).lastIndexOf('user');
  const shownTurns = sessionTurns.filter((t, i) => i >= lastUserIdx || liveChipTurnIds.has(t.id));

  const newItems = useMemo(
    () => state.listItems.filter((li) => !beforeIds.has(li.id) && li.status !== 'removed'),
    [state.listItems, beforeIds],
  );
  const keepCount = newItems.filter((li) => !excluded.has(li.id)).length;

  const understand = async (msg: string, clarificationId?: string) => {
    if (!msg.trim()) return;
    setVoiceHint(false);
    if (clarificationId) {
      if (await send(msg, clarificationId)) setPhase('result');
      return;
    }
    const split = splitMessage(msg, state);
    if (split.tasks.length) {
      const found = split.tasks.map((t, i): TaskCard => {
        const m = identifyTask(t);
        const draft = draftFromText(t, activeMembers, me.id);
        return {
          id: `${Date.now()}_${i}`, text: t, candidates: m?.candidates ?? [], draft,
          ...(m?.guess ? { guess: m.guess } : {}), asking: nextQuestion(draft)?.key ?? null, on: true,
        };
      });
      setCards((prev) => [...prev, ...found]);
    }
    const r = split.grocery ? await send(split.grocery) : null;
    if (r || split.tasks.length) { setPhase('result'); setText(''); setReply(''); }
  };

  const updateCard = (id: string, fn: (card: TaskCard) => TaskCard) =>
    setCards((prev) => prev.map((k) => (k.id === id ? fn(k) : k)));
  /** New draft for a card: keep asking the same field until it's answered, then move on. */
  const setDraft = (id: string, fn: (d: TaskDraft) => TaskDraft, advance = false) => updateCard(id, (k) => {
    const draft = fn(k.draft);
    return { ...k, draft, asking: (!advance && k.asking) || (nextQuestion(draft)?.key ?? null) };
  });

  const tickedTasks = cards.filter((k) => k.on);
  const openTasks = tickedTasks.filter((k) => !isComplete(k.draft)).length;

  const save = () => {
    if (openTasks) return;
    excluded.forEach((id) => removeItem(id));
    for (const k of tickedTasks) {
      const t = draftToTask(k.draft);
      if (t) addTask(t);
    }
    onClose();
    const parts = [
      keepCount ? `${keepCount} to groceries` : '',
      tickedTasks.length ? `${tickedTasks.length} ${tickedTasks.length === 1 ? 'task' : 'tasks'}` : '',
    ].filter(Boolean);
    if (parts.length) flash(`Added ${parts.join(' · ')}`);
    else if (newItems.length || cards.length) flash('Nothing added', c.amber);
  };

  const toggle = (id: string) => setExcluded((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const renderTurn = (t: Turn) => {
    if (t.role === 'user') return <Text key={t.id} style={styles.said}>“{t.text}”</Text>;
    const clar = state.pendingClarifications.find((x) => x.id === t.clarificationId);
    const live = liveChipTurnIds.has(t.id);
    return (
      <View key={t.id} style={styles.agentBlock}>
        <Text style={styles.agentText}>{t.text}</Text>
        {live && t.chips?.length ? (
          <View style={styles.chips}>
            {t.chips.map((label) => (
              <Chip
                key={label}
                label={label}
                suggested={clar?.suggestedOption === label}
                quiet={label === 'Not now'}
                onPress={() => !busy && understand(label, t.clarificationId)}
              />
            ))}
          </View>
        ) : null}
      </View>
    );
  };

  const renderCard = (k: TaskCard) => {
    const d = k.draft;
    const q = d.section ? nextQuestionFor(k) : null;
    const done = isComplete(d);
    const who = activeMembers.find((m) => m.id === d.whoId)?.name;
    const pick = (entry: CatalogTask) => setDraft(k.id, (x) => withCatalog(withSection(x, entry.section), entry), true);
    return (
      <View key={k.id} style={styles.task}>
        <Pressable onPress={() => updateCard(k.id, (x) => ({ ...x, on: !x.on }))} style={styles.taskHead}>
          <CheckCircle on={k.on} onColor={c.green} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.itemName, !k.on && { color: c.textFaint }]}>{d.title}</Text>
            <Text style={hearthText.catLabel}>
              {[d.section ?? 'Which kind?', done ? [who, d.due === undefined ? null : dueLabel(d.due)].filter(Boolean).join(' · ') : null].filter(Boolean).join('  ·  ')}
            </Text>
          </View>
        </Pressable>
        {k.on && !d.section && (
          <View style={styles.taskBody}>
            <Text style={styles.taskQ}>{k.candidates.length > 1 ? 'Which one?' : 'Which section is it?'}</Text>
            <View style={styles.chips}>
              {k.candidates.length > 1
                ? k.candidates.map((e) => <Chip key={e.id} label={e.name} onPress={() => pick(e)} />)
                : TASK_SECTIONS.map((sec) => (
                  <Chip key={sec} label={sec} suggested={k.guess === sec} onPress={() => setDraft(k.id, (x) => withSection(x, sec), true)} />
                ))}
            </View>
          </View>
        )}
        {k.on && q && (
          <View style={styles.taskBody}>
            <Text style={styles.taskQ}>{q.question}</Text>
            <TaskFieldInput
              field={q}
              draft={d}
              onAnswer={(v) => setDraft(k.id, (x) => answer(x, q, v), q.type === 'member')}
              members={activeMembers}
              meId={me.id}
              suggestedWhoId={suggestedWho(taskPrefs, d, activeMembers.map((m) => m.id))}
            />
            {q.type !== 'member' && (
              <Button label={missingFields(d).some((fl) => fl.key !== q.key) ? 'Next ›' : 'Done ✓'} kind="outline" compact onPress={() => setDraft(k.id, (x) => x, true)} style={{ marginTop: 10, alignSelf: 'flex-start' }} />
            )}
          </View>
        )}
      </View>
    );
  };

  /** The field this card is asking: the one held open, else the next missing. */
  const nextQuestionFor = (k: TaskCard) => {
    const held = k.asking ? fieldsForCard(k).find((fl) => fl.key === k.asking) : undefined;
    return held ?? nextQuestion(k.draft);
  };
  const fieldsForCard = (k: TaskCard) => (k.draft.section ? fieldsOf(k.draft) : []);

  const inputFooter = (
    <View style={styles.row}>
      <Pressable
        onPress={() => { setVoiceHint(true); inputRef.current?.focus(); }}
        style={({ pressed }) => [styles.mic, voiceHint && { backgroundColor: c.accentDeep }, pressed && styles.pressed]}
        accessibilityLabel="Speak"
      >
        <MicIcon color={c.onDark} />
      </Pressable>
      <Button label="Understand this" onPress={() => understand(text)} disabled={!text.trim() || busy} style={{ flex: 1 }} />
    </View>
  );

  const resultFooter = (
    <View>
      <View style={[styles.row, { marginBottom: 12 }]}>
        <TextInput
          style={styles.replyInput}
          value={reply}
          onChangeText={setReply}
          placeholder="Say more, or answer in your words…"
          placeholderTextColor={c.textFaint}
          onSubmitEditing={() => understand(reply)}
          returnKeyType="send"
          editable={!busy}
        />
        <Pressable
          onPress={() => understand(reply)}
          disabled={!reply.trim() || busy}
          style={[styles.send, (!reply.trim() || busy) && { backgroundColor: c.disabled }]}
          accessibilityLabel="Send"
        >
          <Text style={styles.sendText}>↑</Text>
        </Pressable>
      </View>
      <Button
        kind="accent"
        onPress={save}
        disabled={openTasks > 0}
        label={openTasks ? `Answer ${openTasks === 1 ? 'the task' : `${openTasks} tasks`} first`
          : newItems.length === 0 && tickedTasks.length === 0 ? 'Done'
            : `Save ${[
              newItems.length ? `${keepCount} of ${newItems.length} ${newItems.length === 1 ? 'item' : 'items'}` : '',
              tickedTasks.length ? `${tickedTasks.length} ${tickedTasks.length === 1 ? 'task' : 'tasks'}` : '',
            ].filter(Boolean).join(' · ')}`}
      />
    </View>
  );

  return (
    <Sheet
      visible
      onClose={onClose}
      tall={phase === 'result'}
      title={phase === 'result' ? 'Does this look right?' : 'Add something'}
      right={<CloseButton onPress={onClose} />}
      footer={phase === 'input' ? inputFooter : resultFooter}
    >
      {phase === 'input' ? (
        <View>
          <View style={styles.textBox}>
            <TextInput
              ref={inputRef}
              style={styles.textArea}
              value={text}
              onChangeText={setText}
              multiline
              autoFocus={!seed}
              placeholder="e.g. We need tomatoes and coriander"
              placeholderTextColor={c.textFaint}
            />
          </View>
          {voiceHint ? (
            <View style={styles.voice}>
              <Dot color={c.accent} />
              <Text style={styles.voiceText}>Tap the mic on your keyboard and speak naturally.</Text>
            </View>
          ) : null}
          <Kicker style={styles.kicker}>Try saying</Kicker>
          {EXAMPLES.map((e) => (
            <Pressable key={e} onPress={() => setText(e)} style={styles.example}>
              <Text style={styles.exampleText}>“{e}”</Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <View>
          <View style={styles.understood}>
            <Dot color={c.green} />
            <Text style={styles.understoodText}>Here’s what I understood — check it before saving.</Text>
          </View>

          {shownTurns.map(renderTurn)}

          {newItems.length > 0 && (
            <View style={{ marginTop: 18 }}>
              <Kicker style={styles.kicker}>On your list</Kicker>
              {newItems.map((li) => {
                const on = !excluded.has(li.id);
                const amount = [li.qty != null ? `${li.qty} ${li.unit ?? ''}`.trim() : null, li.brand].filter(Boolean).join(' · ');
                return (
                  <Pressable key={li.id} onPress={() => toggle(li.id)} style={styles.item}>
                    <CheckCircle on={on} onColor={c.green} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.itemName, !on && { color: c.textFaint }]}>
                        {li.product}{amount ? <Text style={styles.itemAmount}>  {amount}</Text> : null}
                      </Text>
                      <Text style={hearthText.catLabel}>{li.category}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}

          {cards.length > 0 && (
            <View style={{ marginTop: 18 }}>
              <Kicker style={styles.kicker}>Tasks</Kicker>
              {cards.map(renderCard)}
            </View>
          )}

          <Button label="← Say something else" kind="quiet" onPress={() => setPhase('input')} style={{ marginTop: 10, paddingVertical: 12 }} />
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  pressed: { transform: [{ scale: 0.985 }] },
  mic: { width: 56, height: 56, borderRadius: theme.radius.lg, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center' },
  textBox: { borderWidth: 1, borderColor: c.border, borderRadius: 14, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, backgroundColor: c.paper },
  textArea: { minHeight: 72, fontFamily: theme.font.serif, fontSize: 20, lineHeight: 29, color: c.ink, textAlignVertical: 'top' },
  voice: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingTop: 16 },
  voiceText: { fontFamily: theme.font.sansBold, fontSize: 14, color: c.accent, flex: 1 },
  kicker: { fontSize: 11, letterSpacing: 2, marginTop: 22, marginBottom: 12 },
  example: { paddingVertical: 13, paddingHorizontal: 2, borderTopWidth: 1, borderTopColor: c.hairline },
  exampleText: { fontFamily: theme.font.serifItalic, fontSize: 18, color: c.textSoft },
  understood: {
    flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 12, marginBottom: 14,
    borderTopWidth: 1, borderTopColor: c.ink, borderBottomWidth: 1, borderBottomColor: c.hairline,
  },
  understoodText: { fontFamily: theme.font.sansMedium, fontSize: 14, color: c.textSoft, flex: 1 },
  said: { fontFamily: theme.font.serifItalic, fontSize: 16, color: c.textFaint, marginTop: 10 },
  agentBlock: { marginTop: 6, marginBottom: 6 },
  agentText: { fontFamily: theme.font.serif, fontSize: 22, lineHeight: 28, color: c.ink, letterSpacing: -0.2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 },
  task: { paddingVertical: 12, borderTopWidth: 1, borderTopColor: c.hairline },
  taskHead: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 2 },
  taskBody: { marginTop: 10, marginLeft: 40 },
  taskQ: { fontFamily: theme.font.serif, fontSize: 19, lineHeight: 25, color: c.ink, marginBottom: 6 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, paddingHorizontal: 2, borderTopWidth: 1, borderTopColor: c.hairline },
  itemName: { fontFamily: theme.font.serif, fontSize: 19, color: c.ink },
  itemAmount: { fontFamily: theme.font.sans, fontSize: 14, color: c.textMuted },
  replyInput: {
    flex: 1, borderWidth: 1, borderColor: c.border, borderRadius: 12, backgroundColor: c.paper,
    paddingHorizontal: 14, paddingVertical: 12, fontFamily: theme.font.serif, fontSize: 17, color: c.ink,
  },
  send: { width: 46, height: 46, borderRadius: 12, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center' },
  sendText: { color: c.onDark, fontSize: 20, fontFamily: theme.font.sansBold },
});
