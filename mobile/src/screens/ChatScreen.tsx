import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, FlatList, Pressable, StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '../theme';
import { useHousehold } from '../state/HouseholdContext';
import { getAIService } from '../services/serviceFactory';
import { ChatBubble } from '../components/ChatBubble';

export function ChatScreen({ navigation }: { navigation: any }) {
  const { state, addUserTurn, addAgentTurn, applyAI, buildChatContext } = useHousehold();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const listRef = useRef<FlatList<any>>(null);
  const ai = useMemo(() => getAIService(), []);

  const send = useCallback(async (raw?: string, clarificationId?: string) => {
    const message = (raw ?? text).trim();
    if (!message || busy) return;
    setBusy(true);
    setText('');
    addUserTurn(message);
    try {
      const ctx = { ...buildChatContext(), answeringClarificationId: clarificationId };
      const response = await ai.chat(message, ctx);
      const clar = response.clarifications[0];
      addAgentTurn(response.reply, clar?.options, clar?.id);
      applyAI(response);
    } finally {
      setBusy(false);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 30);
    }
  }, [text, busy, addUserTurn, addAgentTurn, applyAI, buildChatContext, ai]);

  // Chips stay live on the newest bubble for each clarification still pending,
  // so an unrelated request doesn't strand an earlier question (plan_04).
  const liveChipTurnIds = useMemo(() => {
    const pendingIds = new Set(state.pendingClarifications.map((c) => c.id));
    const byClar = new Map<string, string>();
    for (const t of state.turns) {
      if (t.clarificationId && pendingIds.has(t.clarificationId)) byClar.set(t.clarificationId, t.id);
    }
    return new Set(byClar.values());
  }, [state.turns, state.pendingClarifications]);

  const draftCount = state.listItems.filter((i) => !i.purchased).length;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Text style={styles.title}>Grocery chat</Text>
        <Text style={styles.subtitle}>Talk like you'd talk to family</Text>
      </View>

      <FlatList
        ref={listRef}
        data={state.turns}
        keyExtractor={(t) => t.id}
        renderItem={({ item, index }) => {
          // Turns persisted before plan_04 have no clarificationId: chips only on the last one.
          const live = item.clarificationId
            ? liveChipTurnIds.has(item.id)
            : item.role === 'agent' && index === state.turns.length - 1;
          return (
            <ChatBubble
              role={item.role}
              text={item.text}
              chips={live ? item.chips : undefined}
              onChipPress={(label) => send(label, item.clarificationId)}
            />
          );
        }}
        contentContainerStyle={{ paddingVertical: 8 }}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
      />

      {draftCount > 0 && (
        <Pressable style={styles.banner} onPress={() => navigation.navigate('List')}>
          <Text style={styles.bannerText}>{draftCount} items in list · tap to review</Text>
        </Pressable>
      )}

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={0}>
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder="e.g. get coriander"
            placeholderTextColor={theme.colors.textMuted}
            editable={!busy}
            onSubmitEditing={() => send()}
            returnKeyType="send"
          />
          <Pressable style={[styles.sendBtn, busy && styles.sendBtnDisabled]} onPress={() => send()} disabled={busy}>
            <Text style={styles.sendText}>Send</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  header: { paddingHorizontal: 16, paddingVertical: 10, backgroundColor: theme.colors.surfaceAlt },
  title: { fontSize: theme.font.title, fontWeight: '700', color: theme.colors.text },
  subtitle: { fontSize: theme.font.small, color: theme.colors.textMuted },
  banner: {
    backgroundColor: theme.colors.primary,
    paddingHorizontal: 14, paddingVertical: 8, marginHorizontal: 10, marginBottom: 6,
    borderRadius: theme.radius.md,
  },
  bannerText: { color: 'white', fontWeight: '600', textAlign: 'center' },
  inputRow: {
    flexDirection: 'row', padding: 8, borderTopWidth: 1, borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  input: {
    flex: 1, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.pill,
    paddingHorizontal: 14, paddingVertical: 10, fontSize: theme.font.body, color: theme.colors.text,
    backgroundColor: theme.colors.surfaceAlt,
  },
  sendBtn: {
    marginLeft: 8, backgroundColor: theme.colors.primary, paddingHorizontal: 18,
    justifyContent: 'center', borderRadius: theme.radius.pill,
  },
  sendBtnDisabled: { opacity: 0.5 },
  sendText: { color: 'white', fontWeight: '700' },
});
