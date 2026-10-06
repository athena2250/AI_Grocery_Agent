import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '../theme';
import { useAuth } from '../state/AuthContext';
import { useUI } from '../components/UIProvider';
import { Button, Chip, Sheet } from '../components/hearth';
import { getAuthService } from '../services/serviceFactory';
import { isOnline } from '../services/api';
import { OTP_LENGTH, RELATIONS, clock, type AuthError, type AuthMode } from '../state/auth';
import { COUNTRIES, INDIA, formatPhone, localDigits, toE164, type Country } from '../state/phone';

const c = theme.colors;
const f = theme.font;
const auth = getAuthService();

type Step = 'start' | 'form' | 'otp';

interface Sent {
  phone: string;
  expiresAt: number;
  resendAt: number;
  devCode?: string;
}

/**
 * The first thing a signed-out phone sees: Sign in (name + number) or Sign up
 * (name + who you are + number), then the 6-digit code. In the sandbox the
 * code is shown on screen; Phase 2's service texts it instead.
 */
export function AuthScreen() {
  const { signIn, endedBecause } = useAuth();
  const { flash } = useUI();

  const [step, setStep] = useState<Step>('start');
  const [mode, setMode] = useState<AuthMode>('sign_up');
  const [name, setName] = useState('');
  const [relation, setRelation] = useState('');
  const [otherRelation, setOtherRelation] = useState(false);
  const [country, setCountry] = useState<Country>(INDIA);
  const [digits, setDigits] = useState('');
  const [homeCode, setHomeCode] = useState('');
  const [picking, setPicking] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; relation?: string; phone?: string }>({});
  const [formError, setFormError] = useState<{ error: AuthError; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const [sent, setSent] = useState<Sent | null>(null);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const codeRef = useRef<TextInput>(null);

  useEffect(() => {
    if (step !== 'otp') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [step]);

  const open = (m: AuthMode) => {
    setMode(m);
    setFieldErrors({});
    setFormError(null);
    setStep('form');
  };

  const send = async () => {
    const phone = toE164(country, digits);
    const errs: typeof fieldErrors = {};
    if (!name.trim()) errs.name = 'Please tell us your name.';
    if (mode === 'sign_up' && !relation.trim()) errs.relation = 'Please choose who you are at home.';
    if (phone === null) errs.phone = 'Please enter your mobile number.';
    else if (phone === 'invalid') errs.phone = `That doesn’t look like a ${country.digits}-digit ${country.name} mobile number.`;
    setFieldErrors(errs);
    setFormError(null);
    if (Object.keys(errs).length || !phone || phone === 'invalid') return;

    setBusy(true);
    const r = await auth.requestOtp({ mode, name, phone, relation: mode === 'sign_up' ? relation : undefined, inviteCode: mode === 'sign_up' ? homeCode : undefined });
    setBusy(false);
    if (!r.ok) {
      // Still waiting out the resend timer for this number — go back to the code.
      if (r.error === 'resend_too_soon' && sent?.phone === phone) { setStep('otp'); return; }
      setFormError({ error: r.error, message: r.message });
      return;
    }
    setSent({ phone, expiresAt: r.expiresAt, resendAt: r.resendAt, devCode: r.devCode });
    setCode('');
    setCodeError(null);
    setNow(Date.now());
    setStep('otp');
  };

  const resend = async () => {
    if (!sent) return;
    setBusy(true);
    const r = await auth.requestOtp({ mode, name, phone: sent.phone, relation: mode === 'sign_up' ? relation : undefined, inviteCode: mode === 'sign_up' ? homeCode : undefined });
    setBusy(false);
    if (!r.ok) { setCodeError(r.message); return; }
    setSent({ ...sent, expiresAt: r.expiresAt, resendAt: r.resendAt, devCode: r.devCode });
    setCode('');
    setCodeError(null);
    setNow(Date.now());
    flash('New code sent', c.accent);
    codeRef.current?.focus();
  };

  const verify = async (typed = code) => {
    if (!sent || typed.length < OTP_LENGTH || busy) return;
    setBusy(true);
    const r = await auth.verifyOtp(sent.phone, typed);
    setBusy(false);
    if (!r.ok) {
      setCode('');
      setCodeError(r.attemptsLeft ? `${r.message} ${r.attemptsLeft} ${r.attemptsLeft === 1 ? 'try' : 'tries'} left.` : r.message);
      if (['account_exists', 'no_account', 'invalid_invite', 'phone_in_other_home'].includes(r.error)) {
        setFormError({ error: r.error, message: r.message });
        setStep('form');
      }
      return;
    }
    flash(r.created ? `Welcome to Hearth, ${r.account.name}` : `Welcome back, ${r.account.name}`, c.accent);
    signIn(r.account, { token: r.token, created: r.created });
  };

  const onCode = (v: string) => {
    const d = v.replace(/\D/g, '').slice(0, OTP_LENGTH);
    setCode(d);
    setCodeError(null);
    if (d.length === OTP_LENGTH) verify(d);
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
          <Button label="Create an account" onPress={() => open('sign_up')} />
          <Button label="I already have an account" kind="outline" onPress={() => open('sign_in')} style={{ marginTop: 10 }} />
          <Text style={styles.fine}>We’ll send a 6-digit code to your phone</Text>
        </View>
      </SafeAreaView>
    );
  }

  const signingUp = mode === 'sign_up';
  const expired = !!sent && now >= sent.expiresAt;
  const waitMs = sent ? sent.resendAt - now : 0;

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
          <Pressable
            onPress={() => setStep(step === 'otp' ? 'form' : 'start')}
            hitSlop={10}
            style={styles.back}
          >
            <Text style={styles.backText}>{step === 'otp' ? '‹  Change number' : '‹  Back'}</Text>
          </Pressable>

          {step === 'form' ? (
            <>
              <View style={styles.tabs} accessibilityRole="tablist">
                {(['sign_in', 'sign_up'] as const).map((m) => (
                  <Pressable
                    key={m}
                    onPress={() => open(m)}
                    style={[styles.tab, mode === m && styles.tabOn]}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: mode === m }}
                  >
                    <Text style={[styles.tabText, mode === m && styles.tabTextOn]}>{m === 'sign_in' ? 'Sign in' : 'Sign up'}</Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.h1}>{signingUp ? 'Create your account' : 'Welcome back'}</Text>
              <Text style={styles.lede}>
                {signingUp
                  ? 'Your name and number set up your place in the home.'
                  : 'Use the name and number you signed up with.'}
              </Text>

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

              {signingUp ? (
                <>
                  <Text style={styles.label}>WHO ARE YOU AT HOME?</Text>
                  <View style={styles.chips}>
                    {RELATIONS.map((r) => (
                      <Chip
                        key={r}
                        label={r}
                        suggested={!otherRelation && relation === r}
                        onPress={() => { setOtherRelation(false); setRelation(r); setFieldErrors((e) => ({ ...e, relation: undefined })); }}
                      />
                    ))}
                    <Chip
                      label="Someone else"
                      suggested={otherRelation}
                      onPress={() => { setOtherRelation(true); setRelation(''); }}
                    />
                  </View>
                  {otherRelation ? (
                    <TextInput
                      value={relation}
                      onChangeText={(v) => { setRelation(v); setFieldErrors((e) => ({ ...e, relation: undefined })); }}
                      placeholder="e.g. Aunt, Cook, Flatmate"
                      placeholderTextColor={c.textFaint}
                      autoCapitalize="words"
                      autoFocus
                      style={[styles.input, { marginTop: 12 }, fieldErrors.relation && styles.inputError]}
                    />
                  ) : null}
                  {fieldErrors.relation ? <Text style={styles.error}>{fieldErrors.relation}</Text> : null}
                </>
              ) : null}

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
                  onSubmitEditing={send}
                  style={[styles.input, { flex: 1 }, fieldErrors.phone && styles.inputError]}
                />
              </View>
              {fieldErrors.phone ? <Text style={styles.error}>{fieldErrors.phone}</Text> : null}

              {signingUp && isOnline() ? (
                <>
                  <Text style={styles.label}>HOME CODE · IF YOUR FAMILY IS ALREADY ON HEARTH</Text>
                  <TextInput
                    value={homeCode}
                    onChangeText={(v) => setHomeCode(v.toUpperCase())}
                    placeholder="e.g. HRTH-4K9P"
                    placeholderTextColor={c.textFaint}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    maxLength={12}
                    style={styles.input}
                  />
                  <Text style={styles.hint}>Leave it empty to start a new home. Anyone in the home can make a code from More → Invite family.</Text>
                </>
              ) : null}

              {formError ? (
                <View style={styles.notice}>
                  <Text style={styles.noticeText}>{formError.message}</Text>
                  {formError.error === 'no_account' || formError.error === 'account_exists' ? (
                    <Pressable onPress={() => open(formError.error === 'no_account' ? 'sign_up' : 'sign_in')} hitSlop={8}>
                      <Text style={styles.link}>{formError.error === 'no_account' ? 'Sign up with this number' : 'Sign in with this number'}</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}

              <View style={{ flex: 1, minHeight: 28 }} />
              <Button label={busy ? 'Sending…' : 'Send code'} onPress={send} disabled={busy} />
            </>
          ) : (
            <>
              <Text style={styles.h1}>Enter the code</Text>
              <Text style={styles.lede}>
                We sent a {OTP_LENGTH}-digit code to <Text style={styles.ledeStrong}>{sent ? formatPhone(sent.phone) : ''}</Text>.
              </Text>

              {sent?.devCode ? (
                <View style={styles.sandbox}>
                  <Text style={styles.sandboxKicker}>SANDBOX · NO SMS IS SENT</Text>
                  <Text style={styles.sandboxText}>Your code is <Text style={styles.sandboxCode}>{sent.devCode}</Text></Text>
                </View>
              ) : null}

              <TextInput
                ref={codeRef}
                value={code}
                onChangeText={onCode}
                placeholder={'•'.repeat(OTP_LENGTH)}
                placeholderTextColor={c.checkOff}
                keyboardType="number-pad"
                inputMode="numeric"
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
                maxLength={OTP_LENGTH}
                autoFocus
                editable={!expired}
                accessibilityLabel={`${OTP_LENGTH}-digit code`}
                style={[styles.code, codeError && styles.inputError, expired && { opacity: 0.5 }]}
              />
              {codeError ? <Text style={[styles.error, { textAlign: 'center' }]}>{codeError}</Text> : null}

              <Text style={styles.meta}>
                {expired ? 'This code has expired.' : `Code expires in ${clock(sent ? sent.expiresAt - now : 0)}`}
              </Text>
              {waitMs > 0 ? (
                <Text style={styles.meta}>Resend code in {clock(waitMs)}</Text>
              ) : (
                <Pressable onPress={resend} disabled={busy} hitSlop={8} style={{ alignSelf: 'center' }}>
                  <Text style={[styles.link, { textAlign: 'center', marginTop: 10 }]}>Send a new code</Text>
                </Pressable>
              )}

              <View style={{ flex: 1, minHeight: 28 }} />
              <Button
                label={busy ? 'Checking…' : signingUp ? 'Create account' : 'Sign in'}
                onPress={() => verify()}
                disabled={busy || expired || code.length < OTP_LENGTH}
              />
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
  tabs: {
    flexDirection: 'row', borderWidth: 1, borderColor: c.border, borderRadius: theme.radius.md,
    padding: 3, marginBottom: 28, backgroundColor: c.paper,
  },
  tab: { flex: 1, paddingVertical: 10, borderRadius: theme.radius.sm, alignItems: 'center' },
  tabOn: { backgroundColor: c.ink },
  tabText: { fontFamily: f.sansBold, fontSize: 14, color: c.textMuted },
  tabTextOn: { color: c.onDark },
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
  hint: { fontFamily: f.sans, fontSize: 13, lineHeight: 18, color: c.textMuted, marginTop: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', marginTop: -8 },
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
  link: { fontFamily: f.sansBold, fontSize: 14, color: c.accent },

  sandbox: {
    marginTop: 18, paddingVertical: 12, paddingHorizontal: 14, borderRadius: theme.radius.md,
    borderWidth: 1, borderStyle: 'dashed', borderColor: c.checkOff,
  },
  sandboxKicker: { fontFamily: f.sansBold, fontSize: 11, letterSpacing: 1.5, color: c.kicker },
  sandboxText: { fontFamily: f.sans, fontSize: 15, color: c.textSoft, marginTop: 4 },
  sandboxCode: { fontFamily: f.sansHeavy, color: c.ink, letterSpacing: 2 },
  code: {
    marginTop: 26, fontFamily: f.sansBold, fontSize: 32, letterSpacing: 14, textAlign: 'center', color: c.ink,
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
