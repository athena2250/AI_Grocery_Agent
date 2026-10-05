import React from 'react';
import {
  View, Text, Pressable, Modal, ScrollView, StyleSheet, KeyboardAvoidingView, Platform,
  type StyleProp, type ViewStyle, type TextStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '../theme';

const c = theme.colors;
const f = theme.font;

/** Small uppercase label above a section ("TODAY", "OR CHOOSE A TYPE"). */
export function Kicker({ children, style, color = c.kicker }: { children: React.ReactNode; style?: StyleProp<TextStyle>; color?: string }) {
  return <Text style={[s.kicker, { color }, style]}>{children}</Text>;
}

/** "TODAY ……… 3 things" — bold tracked section heading with an optional right-hand note. */
export function SectionHeading({ title, note, style }: { title: string; note?: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[s.sectionRow, style]}>
      <Text style={s.sectionTitle}>{title.toUpperCase()}</Text>
      {note ? <Text style={s.sectionNote}>{note}</Text> : null}
    </View>
  );
}

/** Page masthead: date-style kicker, big serif title, heavy ink rule underneath. */
export function Masthead({ kicker, title, italic, right, sub }: {
  kicker?: string; title: string; italic?: string; right?: React.ReactNode; sub?: string;
}) {
  return (
    <View style={s.masthead}>
      <View style={{ flex: 1 }}>
        {kicker ? <Kicker>{kicker}</Kicker> : null}
        <Text style={s.mastTitle}>
          {title}
          {italic ? <Text style={s.mastItalic}>{'\n'}{italic}</Text> : null}
        </Text>
        {sub ? <Text style={s.mastSub}>{sub}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export function Dot({ color, size = 7, style }: { color: string; size?: number; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }, style]} />;
}

export function Avatar({ initial, color, size = 46 }: { initial: string; color: string; size?: number }) {
  return (
    <View style={[s.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: color }]}>
      <Text style={[s.avatarText, { fontSize: Math.round(size * 0.45) }]}>{initial}</Text>
    </View>
  );
}

/** The editorial round check: ink when on (or `onColor`), hairline ring when off. */
export function CheckCircle({ on, onColor = c.ink, size = 26 }: { on: boolean; onColor?: string; size?: number }) {
  return (
    <View style={[s.check, {
      width: size, height: size, borderRadius: size / 2,
      backgroundColor: on ? onColor : 'transparent', borderColor: on ? onColor : c.checkOff,
    }]}>
      {on ? <Text style={s.checkMark}>✓</Text> : null}
    </View>
  );
}

type BtnKind = 'ink' | 'accent' | 'outline' | 'accentOutline' | 'quiet';

export function Button({ label, onPress, kind = 'ink', disabled, style, compact }: {
  label: string; onPress: () => void; kind?: BtnKind; disabled?: boolean; style?: StyleProp<ViewStyle>; compact?: boolean;
}) {
  const k = btnKinds[kind];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        compact ? s.btnCompact : s.btn,
        k.box,
        disabled && kind === 'ink' && { backgroundColor: c.disabled },
        disabled && kind !== 'ink' && { opacity: 0.45 },
        pressed && { transform: [{ scale: 0.985 }] },
        style,
      ]}
    >
      <Text style={[compact ? s.btnTextCompact : s.btnText, k.text]}>{label}</Text>
    </Pressable>
  );
}

const btnKinds: Record<BtnKind, { box: ViewStyle; text: TextStyle }> = {
  ink: { box: { backgroundColor: c.ink }, text: { color: c.onDark } },
  accent: { box: { backgroundColor: c.accent }, text: { color: c.onDark } },
  outline: { box: { borderWidth: 1, borderColor: c.borderStrong }, text: { color: c.ink } },
  accentOutline: { box: { borderWidth: 1, borderColor: c.accentSoft }, text: { color: c.accent } },
  quiet: { box: {}, text: { color: c.textFaint, fontSize: 14 } },
};

/** Chip for quick replies / suggestions. `suggested` = pre-filled from household memory. */
export function Chip({ label, onPress, suggested, quiet }: { label: string; onPress: () => void; suggested?: boolean; quiet?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        s.chip,
        suggested && s.chipSuggested,
        quiet && s.chipQuiet,
        pressed && { transform: [{ scale: 0.97 }] },
      ]}
    >
      <Text style={[s.chipText, suggested && s.chipTextSuggested, quiet && s.chipTextQuiet]}>{label}</Text>
    </Pressable>
  );
}

/**
 * Bottom sheet with scrim + handle (hs-sheetUp). `footer` is pinned under the
 * scrolling body — the design's action bar.
 */
export function Sheet({ visible, onClose, title, sub, right, children, footer, tall }: {
  visible: boolean; onClose: () => void; title?: string; sub?: string; right?: React.ReactNode;
  children: React.ReactNode; footer?: React.ReactNode; tall?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const bottom = Math.max(insets.bottom, 12);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={s.scrim}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[s.sheetWrap, tall && { height: '94%' }]}>
          <View style={[s.sheet, tall && { flex: 1 }]}>
            <View style={s.sheetHead}>
              <View style={s.handle} />
              {title ? (
                <View style={s.sheetTitleRow}>
                  <Text style={s.sheetTitle}>{title}</Text>
                  {right}
                </View>
              ) : null}
              {sub ? <Text style={s.sheetSub}>{sub}</Text> : null}
            </View>
            <ScrollView
              style={tall ? { flex: 1 } : undefined}
              contentContainerStyle={[s.sheetBody, !footer && { paddingBottom: bottom + 24 }]}
              keyboardShouldPersistTaps="handled"
            >
              {children}
            </ScrollView>
            {footer ? <View style={[s.sheetFooter, { paddingBottom: bottom + 14 }]}>{footer}</View> : null}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

export function CloseButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={s.close} hitSlop={8} accessibilityLabel="Close">
      <Text style={s.closeText}>✕</Text>
    </Pressable>
  );
}

/** "Chapter" empty state from the design's secondary tabs. */
export function EmptyState({ icon, kicker = 'Chapter', title, body, cta, onCta }: {
  icon?: React.ReactNode; kicker?: string; title: string; body: string; cta?: string; onCta?: () => void;
}) {
  return (
    <View style={s.empty}>
      {icon ? <View style={{ marginBottom: 10 }}>{icon}</View> : null}
      <Kicker style={{ letterSpacing: 3 }}>{kicker}</Kicker>
      <Text style={s.emptyTitle}>{title}</Text>
      <Text style={s.emptyBody}>{body}</Text>
      {cta && onCta ? <Button label={cta} onPress={onCta} kind="accentOutline" compact style={{ marginTop: 24, paddingHorizontal: 26 }} /> : null}
    </View>
  );
}

/** A label/value row ("QUANTITY ……… 1 kg") with a hairline on top. */
export function FieldRow({ k, v, children }: { k: string; v?: string; children?: React.ReactNode }) {
  return (
    <View style={s.field}>
      <Text style={s.fieldKey}>{k.toUpperCase()}</Text>
      {children ?? <Text style={s.fieldVal}>{v}</Text>}
    </View>
  );
}

export const hearthText = StyleSheet.create({
  serif: { fontFamily: f.serif, color: c.text },
  serifItalic: { fontFamily: f.serifItalic, color: c.textSoft },
  sans: { fontFamily: f.sans, color: c.textMuted },
  meta: { fontFamily: f.sans, fontSize: 13, letterSpacing: 0.4, color: c.textFaint },
  catLabel: { fontFamily: f.sans, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', color: c.kicker },
});

const s = StyleSheet.create({
  kicker: { fontFamily: f.sansBold, fontSize: 12, letterSpacing: 2.5, textTransform: 'uppercase' },
  sectionRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 34, marginBottom: 4 },
  sectionTitle: { fontFamily: f.sansHeavy, fontSize: 13, letterSpacing: 3, color: c.ink },
  sectionNote: { fontFamily: f.sansMedium, fontSize: 13, color: c.textFaint },
  masthead: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    paddingTop: 12, paddingBottom: 22, borderBottomWidth: 1.5, borderBottomColor: c.ink,
  },
  mastTitle: { fontFamily: f.serif, fontSize: 34, lineHeight: 37, color: c.ink, marginTop: 8, letterSpacing: -0.5 },
  mastItalic: { fontFamily: f.serifItalic },
  mastSub: { fontFamily: f.sans, fontSize: 15, color: c.textMuted, marginTop: 6 },
  avatar: { alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  avatarText: { fontFamily: f.serif, color: c.onDark },
  check: { borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  checkMark: { color: c.onDark, fontFamily: f.sansBold, fontSize: 14, lineHeight: 17 },
  btn: { paddingVertical: 17, paddingHorizontal: 18, borderRadius: theme.radius.lg, alignItems: 'center', justifyContent: 'center' },
  btnCompact: { paddingVertical: 11, paddingHorizontal: 20, borderRadius: theme.radius.sm, alignItems: 'center', alignSelf: 'flex-start' },
  btnText: { fontFamily: f.sansBold, fontSize: 16, letterSpacing: 0.3 },
  btnTextCompact: { fontFamily: f.sansBold, fontSize: 14 },
  chip: {
    borderWidth: 1, borderColor: c.border, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 9, marginRight: 8, marginTop: 8, backgroundColor: c.paper,
  },
  chipSuggested: { backgroundColor: c.ink, borderColor: c.ink },
  chipQuiet: { backgroundColor: 'transparent' },
  chipText: { fontFamily: f.sansMedium, fontSize: 15, color: c.ink },
  chipTextSuggested: { color: c.onDark },
  chipTextQuiet: { color: c.textFaint },
  scrim: { flex: 1, backgroundColor: c.scrim, justifyContent: 'flex-end' },
  sheetWrap: { maxHeight: '94%' },
  sheet: {
    backgroundColor: c.bg, borderTopLeftRadius: theme.radius.sheet, borderTopRightRadius: theme.radius.sheet,
    shadowColor: c.inkDeep, shadowOpacity: 0.14, shadowRadius: 40, shadowOffset: { width: 0, height: -12 }, elevation: 16,
  },
  sheetHead: { paddingTop: 12, paddingHorizontal: 26 },
  handle: { width: 40, height: 4, borderRadius: 3, backgroundColor: c.handle, alignSelf: 'center', marginBottom: 18 },
  sheetTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { fontFamily: f.serif, fontSize: 27, color: c.ink, letterSpacing: -0.4, flex: 1 },
  sheetSub: { fontFamily: f.sans, fontSize: 14, color: c.textMuted, marginTop: 2 },
  sheetBody: { paddingHorizontal: 26, paddingTop: 16 },
  sheetFooter: { paddingTop: 14, paddingHorizontal: 26, borderTopWidth: 1, borderTopColor: c.hairline, backgroundColor: c.bg },
  close: {
    width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: c.border,
    alignItems: 'center', justifyContent: 'center', marginLeft: 12,
  },
  closeText: { fontSize: 15, color: '#8A8276' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 46, paddingTop: 40, paddingBottom: 80 },
  emptyTitle: { fontFamily: f.serif, fontSize: 30, lineHeight: 33, color: c.ink, marginTop: 14, textAlign: 'center', letterSpacing: -0.4 },
  emptyBody: { fontFamily: f.sans, fontSize: 15, lineHeight: 23, color: c.textMuted, maxWidth: 260, marginTop: 12, textAlign: 'center' },
  field: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 13, borderTopWidth: 1, borderTopColor: c.hairline,
  },
  fieldKey: { fontFamily: f.sansBold, fontSize: 13, letterSpacing: 1, color: c.kicker },
  fieldVal: { fontFamily: f.serif, fontSize: 18, color: c.ink, flexShrink: 1, textAlign: 'right', marginLeft: 16 },
});
