import React, { useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, FlatList, Pressable, StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import { theme } from '../theme';
import { useHousehold } from '../state/HouseholdContext';
import { useConversation } from '../state/useConversation';
import { ChatBubble } from '../components/ChatBubble';
import { SubScreen } from '../components/SubScreen';
import { pendingItems } from '../state/planner';
import { homeSuggestions } from '../state/prediction';
import { useAddProposal } from './useAddProposal';
import type { ProposedItem } from '../types';

const NOT_NOW = 'Not now';
const addLabel = (p: ProposedItem) => `Add ${p.product.toLowerCase()}`;
const c = theme.colors;

/** The full conversation log with Hearth — every turn, with chips live on open questions. */
export function ChatScreen({ navigation }: { navigation: any }) {
  const { state } = useHousehold();
  const { send, busy, liveChipTurnIds } = useConversation();
  const addProposal = useAddProposal();
  const [text, setText] = useState('');
  // The "may be running low" note opens a session; it goes away once Mom starts talking or says Not now (plan_10).
  const [suggestionsOpen, setSuggestionsOpen] = useState(true);
  const listRef = useRef<FlatList<any>>(null);

  const submit = async (raw: string, clarificationId?: string) => {
    if (!raw.trim() || busy) return;
    setText('');
    setSuggestionsOpen(false);
    await send(raw, clarificationId);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 30);
  };

  const draftCount = pendingItems(state.listItems).length;

  const suggestions = useMemo(() => {
    const { restock, predicted } = homeSuggestions(state);
    return [...restock, ...predicted];
  }, [state]);

  // Never auto-add: each chip is Mom confirming one item.
  const onSuggestionChip = (label: string) => {
    if (label === NOT_NOW) return setSuggestionsOpen(false);
    const p = suggestions.find((s) => addLabel(s) === label);
    if (p) addProposal(p);
  };

  const suggestionBubble = suggestionsOpen && suggestions.length > 0 && (
    <ChatBubble
      role="agent"
      system
      text={`${suggestions.length === 1 ? '1 item may be' : `${suggestions.length} items may be`} running low: ${
        suggestions.map((p) => p.product.toLowerCase()).join(', ')}. Add to list?`}
      chips={[...suggestions.map(addLabel), NOT_NOW]}
      onChipPress={onSuggestionChip}
    />
  );

  return (
    <SubScreen kicker="Conversation" title="Talk to Hearth" sub="Say it the way you'd tell family.">
      <FlatList
        ref={listRef}
        data={state.turns}
        keyExtractor={(t) => t.id}
        renderItem={({ item, index }) => {
          // Turns persisted before plan_04 have no clarificationId: chips only on the last one.
          const live = item.clarificationId
            ? liveChipTurnIds.has(item.id)
            : item.role === 'agent' && index === state.turns.length - 1;
          const clar = state.pendingClarifications.find((x) => x.id === item.clarificationId);
          return (
            <ChatBubble
              role={item.role}
              text={item.text}
              chips={live ? item.chips : undefined}
              suggestedChip={clar?.suggestedOption}
              onChipPress={(label) => submit(label, item.clarificationId)}
            />
          );
        }}
        ListEmptyComponent={<Text style={styles.empty}>Nothing said yet. Try “get coriander”.</Text>}
        ListFooterComponent={suggestionBubble || null}
        contentContainerStyle={{ paddingVertical: 16 }}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
      />

      {draftCount > 0 && (
        <Pressable style={styles.banner} onPress={() => navigation.navigate('Tabs', { screen: 'Groceries' })}>
          <Text style={styles.bannerText}>{draftCount} on your list · review ›</Text>
        </Pressable>
      )}

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder="e.g. get coriander"
            placeholderTextColor={c.textFaint}
            editable={!busy}
            onSubmitEditing={() => submit(text)}
            returnKeyType="send"
          />
          <Pressable
            style={[styles.sendBtn, (busy || !text.trim()) && { backgroundColor: c.disabled }]}
            onPress={() => submit(text)}
            disabled={busy || !text.trim()}
            accessibilityLabel="Send"
          >
            <Text style={styles.sendText}>↑</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SubScreen>
  );
}

const styles = StyleSheet.create({
  empty: { fontFamily: theme.font.serifItalic, fontSize: 18, color: c.textFaint, paddingHorizontal: theme.gutter, paddingTop: 12 },
  banner: {
    marginHorizontal: theme.gutter - 8, marginBottom: 8, paddingVertical: 11, paddingHorizontal: 16,
    borderRadius: theme.radius.md, borderWidth: 1, borderColor: c.accentSoft,
  },
  bannerText: { fontFamily: theme.font.sansBold, fontSize: 14, color: c.accent, textAlign: 'center' },
  inputRow: {
    flexDirection: 'row', gap: 10, paddingHorizontal: theme.gutter - 8, paddingTop: 12, paddingBottom: 14,
    borderTopWidth: 1, borderTopColor: c.hairline, backgroundColor: c.bg,
  },
  input: {
    flex: 1, borderWidth: 1, borderColor: c.border, borderRadius: 12, backgroundColor: c.paper,
    paddingHorizontal: 14, paddingVertical: 12, fontFamily: theme.font.serif, fontSize: 17, color: c.ink,
  },
  sendBtn: { width: 48, borderRadius: 12, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center' },
  sendText: { color: c.onDark, fontSize: 20, fontFamily: theme.font.sansBold },
});
