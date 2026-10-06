import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, ScrollView, Pressable, StyleSheet, type TextInputProps } from 'react-native';
import { theme, MEMBER_COLORS } from '../theme';
import { useHousehold } from '../state/HouseholdContext';
import { useProfile } from '../state/ProfileContext';
import { DIET_FLAGS, DIET_TYPES, memberActivity } from '../state/profile';
import { formatPhone, localDigits, splitE164, toE164 } from '../state/phone';
import { useAuth } from '../state/AuthContext';
import { useUI } from '../components/UIProvider';
import { SubScreen } from '../components/SubScreen';
import { Avatar, Button, Chip, SectionHeading } from '../components/hearth';

const c = theme.colors;
const f = theme.font;

/**
 * One person's details, edited in place — opens on "me" (Home avatar, More)
 * or on whoever was tapped in the family list. Diet notes are stored and
 * shown only; the real assistant reads them in Phase 2.
 */
export function ProfileScreen({ route, navigation }: { route: any; navigation: any }) {
  const { state } = useHousehold();
  const { profile, me, ownerId, activeMembers, updateMember, setMe, makeOwner } = useProfile();
  const { flash, ask } = useUI();
  const { account, signOut } = useAuth();

  const member = profile.members.find((m) => m.id === route.params?.memberId) ?? me;
  const isMe = member.id === me.id;
  const isOwner = member.id === ownerId;
  const edit = (e: Parameters<typeof updateMember>[1]) => updateMember(member.id, e);
  const activity = memberActivity(state, member.id);
  const others = activeMembers.filter((m) => m.id !== member.id);

  // Edited in the number's own country; a blank number reads as India.
  const { country } = splitE164(member.phone);
  const [phoneError, setPhoneError] = useState(false);
  const [allergy, setAllergy] = useState('');
  useEffect(() => { setPhoneError(false); setAllergy(''); }, [member.id]);

  const toggleFlag = (flag: string) => edit({
    dietFlags: member.dietFlags.includes(flag) ? member.dietFlags.filter((x) => x !== flag) : [...member.dietFlags, flag],
  });
  const addAllergy = () => {
    const a = allergy.trim();
    setAllergy('');
    if (a && !member.allergies.some((x) => x.toLowerCase() === a.toLowerCase())) edit({ allergies: [...member.allergies, a] });
  };

  const handOver = () => ask({
    title: `Make ${member.name} the owner?`,
    body: 'The owner looks after the home’s setup. You stay in the family as a member.',
    options: [{ label: `Yes, ${member.name} is the owner`, kind: 'accent', onPress: () => { makeOwner(member.id); flash(`${member.name} is the owner now`, c.accent); } }],
  });

  const kicker = [isMe ? 'You' : 'Family', isOwner ? 'Owner' : null].filter(Boolean).join(' · ');

  return (
    <SubScreen
      kicker={kicker}
      title={member.name}
      sub={member.relation}
      right={<View style={{ marginTop: 6 }}><Avatar initial={member.name[0] ?? '?'} color={member.color} size={58} /></View>}
    >
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <SectionHeading title="Details" style={{ marginTop: 18 }} />
        <Field label="Name">
          <DraftInput
            key={`name_${member.id}`}
            value={member.name}
            onCommit={(v) => (v ? edit({ name: v }) : undefined)}
            autoCapitalize="words"
          />
        </Field>
        <Field label="Relation">
          <DraftInput
            key={`rel_${member.id}`}
            value={member.relation}
            placeholder="Mom, Son, Grandma…"
            onCommit={(v) => (v ? edit({ relation: v }) : undefined)}
            autoCapitalize="words"
          />
        </Field>
        <Field label="Phone">
          <View style={styles.phoneWrap}>
            <Text style={styles.prefix}>{country.dial}</Text>
            <DraftInput
              key={`phone_${member.id}`}
              value={splitE164(member.phone).local}
              placeholder={`${country.digits}-digit mobile`}
              keyboardType="number-pad"
              inputMode="numeric"
              maxLength={country.digits}
              sanitize={(v) => localDigits(country, v)}
              onCommit={(v) => {
                const n = toE164(country, v);
                setPhoneError(n === 'invalid');
                if (n !== 'invalid') edit({ phone: n });
                return n === 'invalid' ? v : splitE164(n).local;
              }}
            />
          </View>
        </Field>
        {phoneError ? <Text style={styles.error}>That doesn’t look like a {country.digits}-digit mobile number — not saved yet.</Text> : null}
        {isMe && account && member.phone !== account.phone ? (
          <Text style={styles.hint2}>You sign in with {formatPhone(account.phone)}; this number is just for the family.</Text>
        ) : null}
        <Field label="Colour">
          <View style={styles.swatches}>
            {MEMBER_COLORS.map((col) => (
              <Pressable
                key={col}
                onPress={() => edit({ color: col })}
                hitSlop={4}
                accessibilityLabel={`Colour ${col}`}
                accessibilityState={{ selected: member.color === col }}
                style={[styles.swatch, { backgroundColor: col }, member.color === col && styles.swatchOn]}
              />
            ))}
          </View>
        </Field>

        <SectionHeading title="Food & diet" />
        <Text style={styles.hint}>Saved for now — Hearth will use this when suggesting groceries later.</Text>
        <Text style={styles.label}>EATS</Text>
        <View style={styles.chips}>
          {DIET_TYPES.map((d) => (
            <Chip key={d} label={d} suggested={member.diet === d} onPress={() => edit({ diet: member.diet === d ? null : d })} />
          ))}
        </View>
        <Text style={styles.label}>ALSO</Text>
        <View style={styles.chips}>
          {DIET_FLAGS.map((flag) => (
            <Chip key={flag} label={flag} suggested={member.dietFlags.includes(flag)} onPress={() => toggleFlag(flag)} />
          ))}
        </View>
        <Text style={styles.label}>ALLERGIES</Text>
        <View style={styles.chips}>
          {member.allergies.map((a) => (
            <Chip key={a} label={`${a}  ✕`} onPress={() => edit({ allergies: member.allergies.filter((x) => x !== a) })} />
          ))}
        </View>
        <TextInput
          value={allergy}
          onChangeText={setAllergy}
          onSubmitEditing={addAllergy}
          onBlur={addAllergy}
          placeholder="Add an allergy, e.g. peanuts"
          placeholderTextColor={c.textFaint}
          returnKeyType="done"
          style={styles.lineInput}
        />
        <Text style={styles.label}>NOTE</Text>
        <DraftInput
          key={`note_${member.id}`}
          value={member.dietNote}
          placeholder="e.g. no onion on Tuesdays"
          onCommit={(v) => edit({ dietNote: v })}
          multiline
          style={styles.note}
        />

        <SectionHeading title="Activity" />
        <Text style={styles.activity}>
          {activity.itemsAdded || activity.purchases
            ? `${count(activity.itemsAdded, 'item')} added · ${count(activity.purchases, 'purchase')}`
            : isMe ? 'Nothing yet — what you add or buy shows up here.' : `Nothing from ${member.name} on this phone yet.`}
        </Text>

        {!isMe || (ownerId === me.id && !isOwner) ? (
          <View style={styles.actions}>
            {!isMe ? (
              <Button
                label={`This is me — I’m ${member.name}`}
                kind="outline"
                onPress={() => { setMe(member.id); flash(`Hello, ${member.name}`, c.accent); }}
              />
            ) : null}
            {ownerId === me.id && !isOwner ? (
              <Button label={`Make ${member.name} the owner`} kind="quiet" onPress={handOver} />
            ) : null}
          </View>
        ) : null}

        {isMe ? (
          <View style={styles.actions}>
            <Button
              label="Sign out"
              kind="accentOutline"
              onPress={() => ask({
                title: 'Sign out?',
                body: 'Your home’s lists and memory stay on this phone.',
                options: [{ label: 'Sign out', kind: 'danger', onPress: signOut }],
              })}
            />
          </View>
        ) : null}

        {others.length ? (
          <>
            <SectionHeading title="Family" />
            {others.map((m) => (
              <Pressable key={m.id} onPress={() => navigation.push('Profile', { memberId: m.id })} style={styles.famRow}>
                <Avatar initial={m.name[0] ?? '?'} color={m.color} size={38} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.famName}>{m.name}</Text>
                  <Text style={styles.famMeta}>
                    {[m.relation, m.id === me.id ? 'This phone' : null, m.id === ownerId ? 'Owner' : null].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <Text style={styles.chev}>›</Text>
              </Pressable>
            ))}
          </>
        ) : null}
      </ScrollView>
    </SubScreen>
  );
}

const count = (n: number, word: string) => `${n} ${n === 1 ? word : `${word}s`}`;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldKey}>{label.toUpperCase()}</Text>
      <View style={styles.fieldVal}>{children}</View>
    </View>
  );
}

/**
 * Text you edit in place; saved when you leave the field. `onCommit` may
 * return the text to show afterwards (e.g. a tidied phone number); returning
 * nothing for a blank required field puts the saved value back.
 */
function DraftInput({ value, onCommit, sanitize, style, ...rest }: Omit<TextInputProps, 'value' | 'onChangeText'> & {
  value: string; onCommit: (v: string) => string | void;
  /** Applied to every keystroke and paste, e.g. digits-only for the phone. */
  sanitize?: (v: string) => string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const v = draft.trim();
    if (v === value) return;
    const shown = onCommit(v);
    setDraft(typeof shown === 'string' ? shown : v || value);
  };
  return (
    <TextInput
      value={draft}
      onChangeText={(v) => setDraft(sanitize ? sanitize(v) : v)}
      onBlur={commit}
      onSubmitEditing={rest.multiline ? undefined : commit}
      placeholderTextColor={c.textFaint}
      returnKeyType={rest.multiline ? 'default' : 'done'}
      style={[styles.input, style]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: theme.gutter, paddingBottom: 60 },
  field: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 54,
    paddingVertical: 6, borderTopWidth: 1, borderTopColor: c.hairline,
  },
  fieldKey: { fontFamily: f.sansBold, fontSize: 13, letterSpacing: 1, color: c.kicker },
  fieldVal: { flex: 1, alignItems: 'flex-end', marginLeft: 16 },
  input: { fontFamily: f.serif, fontSize: 18, color: c.ink, textAlign: 'right', paddingVertical: 8, minWidth: 140 },
  phoneWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  prefix: { fontFamily: f.serif, fontSize: 18, color: c.textFaint },
  error: { fontFamily: f.sans, fontSize: 13, color: c.red, textAlign: 'right', marginTop: -2, marginBottom: 8 },
  hint2: { fontFamily: f.sans, fontSize: 13, color: c.textFaint, textAlign: 'right', marginTop: -2, marginBottom: 8 },
  swatches: { flexDirection: 'row', gap: 10, paddingVertical: 8 },
  swatch: { width: 24, height: 24, borderRadius: 12 },
  swatchOn: { borderWidth: 2.5, borderColor: c.ink },
  hint: { fontFamily: f.serifItalic, fontSize: 15, lineHeight: 21, color: c.textSoft, paddingTop: 12, borderTopWidth: 1, borderTopColor: c.hairline },
  label: { fontFamily: f.sansBold, fontSize: 12, letterSpacing: 1.5, color: c.kicker, marginTop: 18 },
  chips: { flexDirection: 'row', flexWrap: 'wrap' },
  lineInput: {
    fontFamily: f.sans, fontSize: 15, color: c.ink, paddingVertical: 10, marginTop: 6,
    borderBottomWidth: 1, borderBottomColor: c.hairline,
  },
  note: {
    textAlign: 'left', minHeight: 64, textAlignVertical: 'top', marginTop: 6, paddingHorizontal: 12, paddingTop: 10,
    borderWidth: 1, borderColor: c.border, borderRadius: theme.radius.md, backgroundColor: c.paper, fontSize: 17,
  },
  activity: { fontFamily: f.serif, fontSize: 19, color: c.ink, paddingTop: 12, borderTopWidth: 1, borderTopColor: c.hairline },
  actions: { marginTop: 30, gap: 8 },
  famRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12, borderTopWidth: 1, borderTopColor: c.hairline },
  famName: { fontFamily: f.serif, fontSize: 19, color: c.ink },
  famMeta: { fontFamily: f.sans, fontSize: 13, color: c.textFaint, marginTop: 1 },
  chev: { fontSize: 22, color: c.checkOff },
});
