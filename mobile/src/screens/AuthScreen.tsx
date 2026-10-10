import React, { useState } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '../theme';
import { useAuth } from '../state/AuthContext';
import { useUI } from '../components/UIProvider';
import { Button, Sheet } from '../components/hearth';
import { getAuthService } from '../services/serviceFactory';
import { PASSKEY_LENGTH, formatPasskey, passkeyKey } from '../state/auth';
import { COUNTRIES, INDIA, formatPhone, localDigits, toE164, type Country } from '../state/phone';

const c = theme.colors;
const f = theme.font;
const auth = getAuthService();

type Step = 'start' | 'details' | 'passkey';

/**
 * The first thing a signed-out phone sees. Name + number (which lets the admin
 * know who is asking), then the passkey the admin gives each person. The same
 * two steps for someone new and for someone signing in on a new phone. In the
 * sandbox there is no admin, so the passkey is shown on screen.
 */
export function AuthScreen() {
  const { signIn, endedBecause } = useAuth();
  const { flash } = useUI();

  const [step, setStep] = useState<Step>('start');
  const [name, setName] = useState('');
  const [country, setCountry] = useState<Country>(INDIA);
  const [digits, setDigits] = useState('');
  const [picking, setPicking] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; phone?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [phone, setPhone] = useState<string | null>(null);
  const [sandboxPasskey, setSandboxPasskey] = useState<string | undefined>();
  const [passkey, setPasskey] = useState('');
  const [passkeyError, setPasskeyError] = useState<string | null>(null);

  const next = async () => {
    const e164 = toE164(country, digits);
    const errs: typeof fieldErrors = {};
    if (!name.trim()) errs.name = 'Please tell us your name.';
    if (e164 === null) errs.phone = 'Please enter your mobile number.';
    else if (e164 === 'invalid') errs.phone = `That doesn’t look like a ${country.digits}-digit ${country.name} mobile number.`;
    setFieldErrors(errs);
    setFormError(null);
    if (Object.keys(errs).length || !e164 || e164 === 'invalid') return;

    setBusy(true);
    const r = await auth.requestAccess({ name, phone: e164 });
    setBusy(false);
    if (!r.ok) { setFormError(r.message); return; }
    if (e164 !== phone) setPasskey('');
    setPhone(e164);
    setSandboxPasskey(r.sandboxPasskey);
    setPasskeyError(null);
    setStep('passkey');
  };

  const submit = async () => {
    if (!phone || busy || passkeyKey(passkey).length < PASSKEY_LENGTH) return;
    setBusy(true);
    const r = await auth.signInWithPasskey({ name, phone, passkey });
    setBusy(false);
    if (!r.ok) { setPasskeyError(r.message); return; }
    flash(r.created ? `Welcome to Hearth, ${r.account.name}` : `Welcome back, ${r.account.name}`, c.accent);
    signIn(r.account, { token: r.token, created: r.created });
  };

  if (step === 'start') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.welcome}>
          <Text style={styles.est}>EST. AT HOME</Text>
          <View style={styles.rule} />
          <Text style={styles.brand}>Hearth</Text>
          <Text style={styles.tagline}>Everything your family needs to remember, kept in one calm and considered place.</Text>
          {endedBecause ? (
            <View style={[styles.notice, { marginTop: 24 }]}>
              <Text style={styles.noticeText}>{endedBecause} Please sign in again.</Text>
            </View>
          ) : null}
          <View style={{ flex: 1 }} />
          <Button label="Get started" onPress={() => { setFormError(null); setStep('details'); }} />
          <Text style={styles.fine}>Your admin gives each person in the home a passkey</Text>
        </View>
      </SafeAreaView>
    );
  }

  const ready = passkeyKey(passkey).length === PASSKEY_LENGTH;

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
          <Pressable
            onPress={() => setStep(step === 'passkey' ? 'details' : 'start')}
            hitSlop={10}
            style={styles.back}
          >
            <Text style={styles.backText}>{step === 'passkey' ? '‹  Change name or number' : '‹  Back'}</Text>
          </Pressable>

          {step === 'details' ? (
            <>
              <Text style={styles.h1}>Welcome</Text>
              <Text style={styles.lede}>Tell us who you are. Use the same name and number each time.</Text>

              <Text style={styles.label}>YOUR NAME</Text>
              <TextInput
                value={name}
                onChangeText={(v) => { setName(v); setFieldErrors((e) => ({ ...e, name: undefined })); }}
                placeholder="e.g. Lakshmi"
                placeholderTextColor={c.textFaint}
                autoCapitalize="words"
                autoComplete="name"
                textContentType="name"
                returnKeyType="next"
                style={[styles.input, fieldErrors.name && styles.inputError]}
              />
              {fieldErrors.name ? <Text style={styles.error}>{fieldErrors.name}</Text> : null}

              <Text style={styles.label}>MOBILE NUMBER</Text>
              <View style={styles.phoneRow}>
                <Pressable
                  onPress={() => setPicking(true)}
                  style={styles.country}
                  accessibilityLabel={`Country code ${country.dial}, ${country.name}. Change`}
                >
                  <Text style={styles.countryText}>{country.flag}  {country.dial}</Text>
                  <Text style={styles.caret}>▾</Text>
                </Pressable>
                <TextInput
                  value={digits}
                  onChangeText={(v) => { setDigits(localDigits(country, v)); setFieldErrors((e) => ({ ...e, phone: undefined })); }}
                  placeholder={`${country.digits}-digit mobile`}
                  placeholderTextColor={c.textFaint}
                  keyboardType="number-pad"
                  inputMode="tel"
                  autoComplete="tel-national"
                  textContentType="telephoneNumber"
                  maxLength={country.digits}
                  returnKeyType="done"
                  onSubmitEditing={next}
                  style={[styles.input, { flex: 1 }, fieldErrors.phone && styles.inputError]}
                />
              </View>
              {fieldErrors.phone ? <Text style={styles.error}>{fieldErrors.phone}</Text> : null}

              {formError ? (
                <View style={styles.notice}>
                  <Text style={styles.noticeText}>{formError}</Text>
                </View>
              ) : null}

              <View style={{ flex: 1, minHeight: 28 }} />
              <Button label={busy ? 'One moment…' : 'Continue'} onPress={next} disabled={busy} />
            </>
          ) : (
            <>
              <Text style={styles.h1}>Your passkey</Text>
              <Text style={styles.lede}>
                Please ask the admin for your passkey to complete sign-up. They’ll see that{' '}
                <Text style={styles.ledeStrong}>{name.trim()}</Text> ({phone ? formatPhone(phone) : ''}) is asking.
              </Text>
              <Text style={styles.lede}>Already have one? Enter it below.</Text>

              {sandboxPasskey ? (
                <View style={styles.sandbox}>
                  <Text style={styles.sandboxKicker}>SANDBOX · NO ADMIN ON THIS PHONE</Text>
                  <Text style={styles.sandboxText}>Your passkey is <Text style={styles.sandboxCode}>{formatPasskey(sandboxPasskey)}</Text></Text>
                </View>
              ) : null}

              <TextInput
                value={formatPasskey(passkey)}
                onChangeText={(v) => { setPasskey(passkeyKey(v)); setPasskeyError(null); }}
                placeholder="XXXX-XXXX"
                placeholderTextColor={c.checkOff}
                autoCapitalize="characters"
                autoCorrect={false}
                autoComplete="off"
                spellCheck={false}
                maxLength={PASSKEY_LENGTH + 1}
                returnKeyType="done"
                onSubmitEditing={submit}
                accessibilityLabel="Passkey"
                style={[styles.code, passkeyError && styles.inputError]}
              />
              {passkeyError ? <Text style={[styles.error, { textAlign: 'center' }]}>{passkeyError}</Text> : null}
              <Text style={styles.meta}>{PASSKEY_LENGTH} letters and numbers, from your admin</Text>

              <View style={{ flex: 1, minHeight: 28 }} />
              <Button label={busy ? 'Checking…' : 'Sign in'} onPress={submit} disabled={busy || !ready} />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <Sheet visible={picking} onClose={() => setPicking(false)} title="Country" sub="Where is your mobile number from?">
        {COUNTRIES.map((x) => (
          <Pressable
            key={x.code}
            onPress={() => { setCountry(x); setDigits((d) => localDigits(x, d)); setFieldErrors((e) => ({ ...e, phone: undefined })); setPicking(false); }}
            style={styles.countryRow}
            accessibilityState={{ selected: x.code === country.code }}
          >
            <Text style={styles.countryFlag}>{x.flag}</Text>
            <Text style={styles.countryName}>{x.name}</Text>
            <Text style={[styles.countryDial, x.code === country.code && { color: c.accent }]}>{x.dial}</Text>
          </Pressable>
        ))}
      </Sheet>
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

  page: { flexGrow: 1, paddingTop: 8, paddingHorizontal: theme.gutter, paddingBottom: 32 },
  back: { paddingTop: 8, paddingBottom: 14, alignSelf: 'flex-start' },
  backText: { fontFamily: f.sansBold, fontSize: 14, color: c.accent },
  h1: { fontFamily: f.serif, fontSize: 38, lineHeight: 41, color: c.ink, letterSpacing: -0.5, marginBottom: 8 },
  lede: { fontFamily: f.sans, fontSize: 15, lineHeight: 22, color: c.textMuted, marginBottom: 8 },
  ledeStrong: { fontFamily: f.sansBold, color: c.ink },
  label: { fontFamily: f.sansBold, fontSize: 12, letterSpacing: 1.5, color: c.kicker, marginTop: 22, marginBottom: 8 },
  input: {
    fontFamily: f.serif, fontSize: 19, color: c.ink, paddingVertical: 12, paddingHorizontal: 14,
    borderWidth: 1, borderColor: c.border, borderRadius: theme.radius.md, backgroundColor: c.paper,
  },
  inputError: { borderColor: c.red },
  error: { fontFamily: f.sans, fontSize: 13, lineHeight: 18, color: c.red, marginTop: 6 },
  phoneRow: { flexDirection: 'row', gap: 8 },
  country: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12,
    borderWidth: 1, borderColor: c.border, borderRadius: theme.radius.md, backgroundColor: c.paper,
  },
  countryText: { fontFamily: f.sansMedium, fontSize: 16, color: c.ink },
  caret: { fontSize: 11, color: c.kicker },
  notice: {
    marginTop: 22, padding: 14, borderRadius: theme.radius.md, borderWidth: 1, borderColor: c.accentSoft,
    backgroundColor: '#F8EDE6', gap: 8,
  },
  noticeText: { fontFamily: f.sans, fontSize: 14, lineHeight: 20, color: c.accentDeep },

  sandbox: {
    marginTop: 18, paddingVertical: 12, paddingHorizontal: 14, borderRadius: theme.radius.md,
    borderWidth: 1, borderStyle: 'dashed', borderColor: c.checkOff,
  },
  sandboxKicker: { fontFamily: f.sansBold, fontSize: 11, letterSpacing: 1.5, color: c.kicker },
  sandboxText: { fontFamily: f.sans, fontSize: 15, color: c.textSoft, marginTop: 4 },
  sandboxCode: { fontFamily: f.sansHeavy, color: c.ink, letterSpacing: 2 },
  code: {
    marginTop: 26, fontFamily: f.sansBold, fontSize: 32, letterSpacing: 6, textAlign: 'center', color: c.ink,
    paddingVertical: 14, borderWidth: 1, borderColor: c.border, borderRadius: theme.radius.lg, backgroundColor: c.paper,
  },
  meta: { fontFamily: f.sans, fontSize: 13, color: c.textFaint, textAlign: 'center', marginTop: 12 },

  countryRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14,
    borderTopWidth: 1, borderTopColor: c.hairline,
  },
  countryFlag: { fontSize: 22 },
  countryName: { flex: 1, fontFamily: f.serif, fontSize: 19, color: c.ink },
  countryDial: { fontFamily: f.sansBold, fontSize: 15, color: c.textMuted },
});
