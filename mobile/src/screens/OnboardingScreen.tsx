import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '../theme';
import { useProfile } from '../state/ProfileContext';
import { useUI } from '../components/UIProvider';
import { Avatar, Button, CheckCircle } from '../components/hearth';

const c = theme.colors;
const f = theme.font;

/** Welcome → Who lives here? → What should we help with? (Hearth.html onboarding). */
export function OnboardingScreen() {
  const { profile, toggleMember, addMember, toggleManage, finishOnboarding } = useProfile();
  const { flash } = useUI();
  const [step, setStep] = useState<'welcome' | 'who' | 'manage'>('welcome');

  if (step === 'welcome') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.welcome}>
          <Text style={styles.est}>EST. AT HOME</Text>
          <View style={styles.rule} />
          <Text style={styles.brand}>Hearth</Text>
          <Text style={styles.tagline}>Everything your family needs to remember, kept in one calm and considered place.</Text>
          <View style={{ flex: 1 }} />
          <Button label="Set up your home" onPress={() => setStep('who')} />
          <Text style={styles.fine}>Under a minute · no account needed</Text>
        </View>
      </SafeAreaView>
    );
  }

  const finish = () => {
    finishOnboarding();
    const me = profile.members.find((m) => m.on) ?? profile.members[0];
    flash(`Welcome home, ${me.name}`, c.accent);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.step}>
        <View style={styles.progress}>
          <Text style={styles.progressNum}>{step === 'who' ? '01' : '02'}</Text>
          <View style={styles.progressLine} />
          <Text style={styles.progressOf}>OF 02</Text>
        </View>

        {step === 'who' ? (
          <>
            <Text style={styles.h1}>Who lives here?</Text>
            <Text style={styles.lede}>Add the people in your home. The first person ticked is you.</Text>
            <View style={styles.list}>
              {profile.members.map((m, i) => (
                <Pressable key={m.id} onPress={() => toggleMember(i)} style={styles.row}>
                  <Avatar initial={m.name[0]} color={m.color} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowName}>{m.name}</Text>
                    <Text style={styles.rowMeta}>{m.relation}</Text>
                  </View>
                  <CheckCircle on={m.on} />
                </Pressable>
              ))}
              <Pressable onPress={() => { if (!addMember()) flash("That's a full house", c.accent); }} style={styles.row}>
                <View style={styles.addCircle}><Text style={styles.addPlus}>+</Text></View>
                <Text style={styles.addText}>Add someone</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <>
            <Text style={styles.h1}>What should we help with?</Text>
            <Text style={styles.lede}>Choose a few to begin. Add more whenever you like.</Text>
            <View style={styles.list}>
              {profile.manage.map((g, i) => (
                <Pressable key={g.key} onPress={() => toggleManage(i)} style={[styles.row, { paddingVertical: 15 }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowName}>{g.name}</Text>
                    <Text style={styles.rowMeta}>{g.desc}</Text>
                  </View>
                  <CheckCircle on={g.on} />
                </Pressable>
              ))}
            </View>
          </>
        )}

        <View style={{ flex: 1, minHeight: 24 }} />
        {step === 'who' ? (
          <Button label="Continue" onPress={() => setStep('manage')} disabled={!profile.members.some((m) => m.on)} />
        ) : (
          <Button label="Open my home" onPress={finish} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.bg },
  welcome: { flex: 1, paddingTop: 52, paddingHorizontal: 40, paddingBottom: 32 },
  est: { fontFamily: f.sansBold, fontSize: 12, letterSpacing: 3, color: c.kicker },
  rule: { width: 44, height: 1, backgroundColor: c.ink, marginTop: 16, marginBottom: 30 },
  brand: { fontFamily: f.serif, fontSize: 64, lineHeight: 66, color: c.ink, letterSpacing: -1 },
  tagline: { fontFamily: f.serifItalic, fontSize: 23, lineHeight: 32, color: c.textSoft, maxWidth: 280, marginTop: 22 },
  fine: { fontFamily: f.sans, fontSize: 13, color: c.textFaint, marginTop: 16, textAlign: 'center' },
  step: { flexGrow: 1, paddingTop: 22, paddingHorizontal: theme.gutter, paddingBottom: 32 },
  progress: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 30 },
  progressNum: { fontFamily: f.sansHeavy, fontSize: 12, letterSpacing: 2, color: c.accent },
  progressLine: { flex: 1, height: 1, backgroundColor: c.hairline },
  progressOf: { fontFamily: f.sansBold, fontSize: 12, letterSpacing: 2, color: '#B7AE9D' },
  h1: { fontFamily: f.serif, fontSize: 38, lineHeight: 41, color: c.ink, letterSpacing: -0.5, marginBottom: 8 },
  lede: { fontFamily: f.sans, fontSize: 15, lineHeight: 22, color: c.textMuted, marginBottom: 20 },
  list: { borderTopWidth: 1, borderTopColor: c.hairline },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 14, paddingHorizontal: 2,
    borderBottomWidth: 1, borderBottomColor: c.hairline,
  },
  rowName: { fontFamily: f.serif, fontSize: 21, color: c.ink },
  rowMeta: { fontFamily: f.sans, fontSize: 13, letterSpacing: 0.4, color: c.textFaint, marginTop: 1 },
  addCircle: {
    width: 46, height: 46, borderRadius: 23, borderWidth: 1, borderStyle: 'dashed', borderColor: '#C7BDA9',
    alignItems: 'center', justifyContent: 'center',
  },
  addPlus: { fontSize: 24, color: c.kicker },
  addText: { fontFamily: f.sansMedium, fontSize: 16, color: '#8A8276' },
});
