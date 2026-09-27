import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { theme } from '../theme';
import { QuickReplyChip } from './QuickReplyChip';

interface Props {
  role: 'user' | 'agent';
  /** A quiet, app-initiated note (plan_10 suggestions) rather than a reply. */
  system?: boolean;
  text: string;
  chips?: string[];
  onChipPress?: (label: string) => void;
}

export function ChatBubble({ role, text, system, chips, onChipPress }: Props) {
  const isUser = role === 'user';
  return (
    <View style={[styles.row, isUser ? styles.rowRight : styles.rowLeft]}>
      <View style={[styles.bubble, isUser ? styles.userBubble : styles.agentBubble, system && styles.systemBubble]}>
        <Text style={[styles.text, system && styles.systemText]}>{text}</Text>
        {chips && chips.length > 0 && (
          <View style={styles.chipRow}>
            {chips.map((c) => (
              <QuickReplyChip key={c} label={c} onPress={() => onChipPress?.(c)} />
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: 10, marginVertical: 4, flexDirection: 'row' },
  rowLeft: { justifyContent: 'flex-start' },
  rowRight: { justifyContent: 'flex-end' },
  bubble: {
    maxWidth: '82%',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: theme.radius.lg,
  },
  userBubble: { backgroundColor: theme.colors.userBubble, borderTopRightRadius: 4 },
  agentBubble: {
    backgroundColor: theme.colors.agentBubble,
    borderTopLeftRadius: 4,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  systemBubble: { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.surfaceAlt },
  text: { color: theme.colors.text, fontSize: theme.font.body },
  systemText: { color: theme.colors.textMuted },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 },
});
