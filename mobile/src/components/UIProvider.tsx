import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Text, View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '../theme';
import { Button, Dot, Sheet } from './hearth';
import { AddSheet } from '../screens/AddSheet';
import { ComposeSheet } from '../screens/ComposeSheet';

/**
 * App-wide UI: the toast, a choice sheet (replaces Alert.alert — styled, and
 * it works on web where Alert is a no-op), and the + composer sheets.
 */
export interface Choice {
  label: string;
  kind?: 'ink' | 'accent' | 'outline' | 'danger';
  onPress: () => void;
}
interface AskArgs {
  title: string;
  body?: string;
  options: Choice[];
  cancelLabel?: string;
}

interface Ctx {
  flash: (msg: string, dot?: string) => void;
  ask: (a: AskArgs) => void;
  openAdd: () => void;
  openCompose: (seed?: string) => void;
}

const UICtx = createContext<Ctx | null>(null);

export function UIProvider({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<{ msg: string; dot: string } | null>(null);
  const [anim] = useState(() => new Animated.Value(0));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [asking, setAsking] = useState<AskArgs | null>(null);
  const [sheet, setSheet] = useState<'add' | 'compose' | null>(null);
  const [seed, setSeed] = useState('');
  const sheetRef = useRef(sheet);
  useEffect(() => { sheetRef.current = sheet; }, [sheet]);

  const flash = useCallback((msg: string, dot: string = theme.colors.green) => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ msg, dot });
    anim.setValue(0);
    Animated.timing(anim, { toValue: 1, duration: 260, useNativeDriver: true }).start();
    timer.current = setTimeout(() => {
      Animated.timing(anim, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => setToast(null));
    }, 2400);
  }, [anim]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const ask = useCallback((a: AskArgs) => setAsking(a), []);
  const openAdd = useCallback(() => setSheet('add'), []);
  const openCompose = useCallback((s?: string) => {
    setSeed(s ?? '');
    // iOS drops a modal presented while another is still dismissing — let the add sheet go first.
    if (sheetRef.current === 'add') {
      setSheet(null);
      setTimeout(() => setSheet('compose'), 350);
    } else {
      setSheet('compose');
    }
  }, []);
  const close = useCallback(() => setSheet(null), []);

  const value = useMemo(() => ({ flash, ask, openAdd, openCompose }), [flash, ask, openAdd, openCompose]);

  return (
    <UICtx.Provider value={value}>
      {children}

      <AddSheet visible={sheet === 'add'} onClose={close} onCompose={openCompose} />
      {sheet === 'compose' && <ComposeSheet seed={seed} onClose={close} />}

      <Sheet visible={!!asking} onClose={() => setAsking(null)} title={asking?.title} sub={asking?.body}>
        <View style={{ gap: 10, marginTop: 6 }}>
          {asking?.options.map((o) => (
            <Button
              key={o.label}
              label={o.label}
              kind={o.kind === 'danger' ? 'accent' : o.kind ?? 'ink'}
              onPress={() => { setAsking(null); o.onPress(); }}
            />
          ))}
          <Button label={asking?.cancelLabel ?? 'Cancel'} kind="quiet" onPress={() => setAsking(null)} />
        </View>
      </Sheet>

      {toast && (
        <Animated.View
          pointerEvents="none"
          style={[styles.toast, {
            bottom: insets.bottom + 96,
            opacity: anim,
            transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
          }]}
        >
          <Dot color={toast.dot} />
          <Text style={styles.toastText} numberOfLines={1}>{toast.msg}</Text>
        </Animated.View>
      )}
    </UICtx.Provider>
  );
}

export function useUI(): Ctx {
  const ctx = useContext(UICtx);
  if (!ctx) throw new Error('useUI must be used inside UIProvider');
  return ctx;
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute', alignSelf: 'center', maxWidth: '88%', zIndex: 60,
    flexDirection: 'row', alignItems: 'center', gap: 11,
    backgroundColor: theme.colors.ink, paddingVertical: 14, paddingHorizontal: 20, borderRadius: 12,
    shadowColor: theme.colors.inkDeep, shadowOpacity: 0.3, shadowRadius: 24, shadowOffset: { width: 0, height: 10 }, elevation: 12,
  },
  toastText: { fontFamily: theme.font.sansMedium, fontSize: 15, color: theme.colors.onDark, flexShrink: 1 },
});
