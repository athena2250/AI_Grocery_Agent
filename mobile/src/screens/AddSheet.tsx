import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { theme } from '../theme';
import { Dot, Kicker, Sheet } from '../components/hearth';
import { MicIcon } from '../components/icons';

/**
 * The + sheet: "Type or speak" first, then a grid of starter phrases. Every
 * type here is something the sandbox AI understands today; bills, repairs and
 * plans arrive with the family feed.
 */
const TYPES = [
  { label: 'Groceries', seed: 'We need tomatoes and onions' },
  { label: 'Running low', seed: 'rice is almost finished' },
  { label: 'Ran out', seed: 'we are out of oil' },
  { label: 'The usual', seed: 'the usual biscuits' },
  { label: 'Bought it', seed: 'mark tomatoes purchased' },
  { label: 'Your own', seed: '' },
];

export function AddSheet({ visible, onClose, onCompose }: {
  visible: boolean; onClose: () => void; onCompose: (seed?: string) => void;
}) {
  return (
    <Sheet visible={visible} onClose={onClose} title="Add to your journal" sub="Describe it in your own words, or pick a type.">
      <Pressable onPress={() => onCompose('')} style={({ pressed }) => [styles.primary, pressed && styles.pressed]}>
        <MicIcon color={theme.colors.onDark} />
        <View style={{ flex: 1 }}>
          <Text style={styles.primaryTitle}>Type or speak</Text>
          <Text style={styles.primaryHint}>“Get coriander”</Text>
        </View>
        <Text style={styles.chev}>›</Text>
      </Pressable>

      <Kicker style={styles.kicker}>Or choose a type</Kicker>
      <View style={styles.grid}>
        {TYPES.map((t) => (
          <Pressable key={t.label} onPress={() => onCompose(t.seed)} style={({ pressed }) => [styles.cell, pressed && styles.pressed]}>
            <Dot color={theme.colors.accent} size={6} />
            <Text style={styles.cellText}>{t.label}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.soon}>Bills, repairs and plans are coming with the family feed.</Text>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  primary: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingVertical: 16, paddingHorizontal: 18, backgroundColor: theme.colors.ink, borderRadius: theme.radius.lg,
  },
  pressed: { transform: [{ scale: 0.985 }] },
  primaryTitle: { fontFamily: theme.font.sansBold, fontSize: 16, color: theme.colors.onDark },
  primaryHint: { fontFamily: theme.font.serifItalic, fontSize: 14, color: theme.colors.onDarkMuted, marginTop: 1 },
  chev: { color: theme.colors.onDarkMuted, fontSize: 22 },
  kicker: { fontSize: 11, letterSpacing: 2, marginTop: 22, marginBottom: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  cell: {
    flexBasis: '47%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 14, paddingHorizontal: 16, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md,
  },
  cellText: { fontFamily: theme.font.sansMedium, fontSize: 15, color: theme.colors.ink },
  soon: { fontFamily: theme.font.sans, fontSize: 13, color: theme.colors.textFaint, marginTop: 16, textAlign: 'center' },
});
