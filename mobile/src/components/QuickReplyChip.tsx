import React from 'react';
import { Pressable, Text, StyleSheet } from 'react-native';
import { theme } from '../theme';

export function QuickReplyChip({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.chip} onPress={onPress}>
      <Text style={styles.text}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    backgroundColor: theme.colors.chipBg,
    borderColor: theme.colors.chipBorder,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
    marginRight: 6,
    marginTop: 6,
  },
  text: { color: theme.colors.chipText, fontWeight: '600', fontSize: theme.font.small + 1 },
});
