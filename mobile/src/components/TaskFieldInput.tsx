import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { theme } from '../theme';
import { Chip } from './hearth';
import { DeadlinePicker } from './DeadlinePicker';
import { timeFor, timeLabel } from '../state/tasks';
import { valueOf, type FieldSpec, type TaskDraft } from '../state/taskFields';

const c = theme.colors;

interface PersonRef { id: string; name: string }

/**
 * One task field, drawn from its FieldSpec — shared by the Add task details
 * page and Type or speak. `suggestedWhoId` (task memory) only marks a chip.
 */
export function TaskFieldInput({ field, draft, onAnswer, members, meId, suggestedWhoId }: {
  field: FieldSpec;
  draft: TaskDraft;
  onAnswer: (value: string | null | undefined) => void;
  members: PersonRef[];
  meId: string;
  suggestedWhoId?: string | null;
}) {
  const value = valueOf(draft, field);
  const memberLabel = (m: PersonRef) => (m.id === meId ? `${m.name} (me)` : m.name);

  switch (field.type) {
    case 'member': {
      const marked = field.key === 'assigned_to' ? suggestedWhoId : null;
      return (
        <View>
          <View style={styles.chips}>
            {members.map((m) => (
              <Chip
                key={m.id}
                label={value === m.id ? `✓ ${memberLabel(m)}` : memberLabel(m)}
                suggested={value ? value === m.id : marked === m.id}
                onPress={() => onAnswer(value === m.id && !field.required ? undefined : m.id)}
              />
            ))}
          </View>
          {!value && marked ? (
            <Text style={styles.hint}>Usually {members.find((m) => m.id === marked)?.name} — tap to choose.</Text>
          ) : null}
        </View>
      );
    }
    case 'members': {
      const picked = (value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      const toggle = (name: string) => {
        const next = picked.includes(name) ? picked.filter((p) => p !== name) : [...picked, name];
        onAnswer(next.length ? next.join(', ') : undefined);
      };
      return (
        <View>
          <View style={styles.chips}>
            {members.map((m) => (
              <Chip key={m.id} label={picked.includes(m.name) ? `✓ ${m.name}` : m.name} suggested={picked.includes(m.name)} onPress={() => toggle(m.name)} />
            ))}
          </View>
          <TextInput
            style={styles.input}
            value={value ?? ''}
            onChangeText={(v) => onAnswer(v || undefined)}
            placeholder="Or type names, e.g. Ravi, Ananya, Grandma"
            placeholderTextColor={c.textFaint}
          />
        </View>
      );
    }
    case 'date':
      return (
        <DeadlinePicker
          value={value}
          onChange={onAnswer}
          noRush={!!field.noRush}
          allowTime={field.key !== 'appointment_date'}
        />
      );
    case 'time':
      return <TimeField field={field} value={value ?? undefined} onAnswer={onAnswer} />;
    case 'choice':
      return (
        <View>
          <View style={styles.chips}>
            {field.chips?.map((o) => (
              <Chip key={o} label={value === o ? `✓ ${o}` : o} suggested={value === o} onPress={() => onAnswer(value === o ? undefined : o)} />
            ))}
          </View>
          <TextInput
            style={styles.input}
            value={field.chips?.includes(value ?? '') ? '' : value ?? ''}
            onChangeText={(v) => onAnswer(v || undefined)}
            placeholder="Or type it"
            placeholderTextColor={c.textFaint}
          />
        </View>
      );
    case 'money':
      return (
        <View style={styles.money}>
          <Text style={styles.rupee}>₹</Text>
          <TextInput
            style={[styles.input, { flex: 1, marginTop: 0 }]}
            value={value ?? ''}
            onChangeText={(v) => onAnswer(v.replace(/[^\d.]/g, '') || undefined)}
            keyboardType="decimal-pad"
            placeholder="Amount"
            placeholderTextColor={c.textFaint}
          />
        </View>
      );
    default:
      return (
        <TextInput
          style={styles.input}
          value={value ?? ''}
          onChangeText={(v) => onAnswer(v)}
          placeholder={field.label}
          placeholderTextColor={c.textFaint}
        />
      );
  }
}

/** Appointment time: a part of the day, or an exact time typed ("5:30 pm"). */
function TimeField({ field, value, onAnswer }: { field: FieldSpec; value?: string; onAnswer: (v: string | undefined) => void }) {
  const exact = value && /^\d{2}:\d{2}$/.test(value) ? value : null;
  const [typed, setTyped] = useState(exact ? timeLabel(exact) : '');
  return (
    <View>
      <View style={styles.chips}>
        {field.chips?.map((o) => (
          <Chip key={o} label={value === o ? `✓ ${o}` : o} suggested={value === o} onPress={() => { setTyped(''); onAnswer(value === o ? undefined : o); }} />
        ))}
      </View>
      <TextInput
        style={styles.input}
        value={typed}
        onChangeText={(v) => { setTyped(v); onAnswer(timeFor(v)); }}
        placeholder="Or an exact time, e.g. 5:30 pm"
        placeholderTextColor={c.textFaint}
      />
      {exact ? <Text style={styles.hint}>At {timeLabel(exact)}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap' },
  hint: { fontFamily: theme.font.serifItalic, fontSize: 15, color: c.textSoft, marginTop: 2, marginBottom: 4 },
  input: {
    borderWidth: 1, borderColor: c.border, borderRadius: 12, backgroundColor: c.paper, marginTop: 6,
    paddingHorizontal: 14, paddingVertical: 12, fontFamily: theme.font.serif, fontSize: 17, color: c.ink,
  },
  money: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
  rupee: { fontFamily: theme.font.serif, fontSize: 22, color: c.textSoft },
});
