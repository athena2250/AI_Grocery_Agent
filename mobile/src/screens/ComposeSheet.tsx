import React, { useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { theme } from '../theme';
import { useHousehold } from '../state/HouseholdContext';
import { useConversation } from '../state/useConversation';
import { Button, CheckCircle, Chip, CloseButton, Dot, Kicker, Sheet, hearthText } from '../components/hearth';
import { MicIcon } from '../components/icons';
import { useUI } from '../components/UIProvider';
import type { Turn } from '../types';

const EXAMPLES = [
  'get coriander',
  "tomatoes I don't know how much",
  'rice is almost finished',
  'the usual biscuits',
];

const c = theme.colors;

/**
 * "Type or speak" (Hearth.html's NL sheet), driven by the real AI service.
 * Input → "Does this look right?": the agent's reply with its clarification
 * chips, and the items this session put on the draft list. Mom can untick any
 * before saving; unticked ones are removed. Nothing is invented here — every
 * item and question comes from the same pipeline as the conversation screen.
 */
export function ComposeSheet({ seed, onClose }: { seed: string; onClose: () => void }) {
  const { state, removeItem } = useHousehold();
  const { send, busy, liveChipTurnIds } = useConversation();
  const { flash } = useUI();
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
    const r = await send(msg, clarificationId);
    if (r) { setPhase('result'); setText(''); setReply(''); }
  };

  const save = () => {
    excluded.forEach((id) => removeItem(id));
    onClose();
    if (keepCount > 0) flash(`Added ${keepCount} to groceries`);
    else if (newItems.length > 0) flash('Nothing added', c.amber);
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
        label={newItems.length === 0 ? 'Done'
          : keepCount === newItems.length ? `Save all ${keepCount} ${keepCount === 1 ? 'item' : 'items'}`
            : `Save ${keepCount} of ${newItems.length}`}
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
