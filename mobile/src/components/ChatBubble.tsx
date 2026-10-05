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
  /** The chip pre-filled from household memory — drawn filled. */
  suggestedChip?: string;
  onChipPress?: (label: string) => void;
}

/** Journal-style turn: Mom's words in an ink bubble on the right, Hearth's in serif on the paper. */
export function ChatBubble({ role, text, system, chips, suggestedChip, onChipPress }: Props) {
  const isUser = role === 'user';
  return (
    <View style={[styles.row, isUser ? styles.rowRight : styles.rowLeft]}>
      <View style={[styles.bubble, isUser ? styles.userBubble : styles.agentBubble, system && styles.systemBubble]}>
        <Text style={[isUser ? styles.userText : styles.agentText, system && styles.systemText]}>{text}</Text>
        {chips && chips.length > 0 && (
          <View style={styles.chipRow}>
            {chips.map((c) => (
              <QuickReplyChip key={c} label={c} suggested={c === suggestedChip} onPress={() => onChipPress?.(c)} />
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: theme.gutter - 8, marginVertical: 6, flexDirection: 'row' },
  rowLeft: { justifyContent: 'flex-start' },
  rowRight: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '86%' },
  userBubble: { backgroundColor: theme.colors.ink, borderRadius: 16, borderBottomRightRadius: 4, paddingHorizontal: 14, paddingVertical: 10 },
  agentBubble: { paddingVertical: 4, paddingLeft: 12, borderLeftWidth: 2, borderLeftColor: theme.colors.accentSoft },
  systemBubble: { borderLeftColor: theme.colors.green },
  userText: { fontFamily: theme.font.sans, fontSize: 16, lineHeight: 22, color: theme.colors.onDark },
  agentText: { fontFamily: theme.font.serif, fontSize: 19, lineHeight: 26, color: theme.colors.ink },
  systemText: { fontFamily: theme.font.serifItalic, color: theme.colors.textSoft },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 2 },
});
