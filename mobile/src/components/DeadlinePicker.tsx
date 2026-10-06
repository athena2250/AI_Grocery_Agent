import React, { useState } from 'react';
import { View, Text, Pressable, Switch, StyleSheet } from 'react-native';
import { theme } from '../theme';
import { Chip } from './hearth';
import { addDays, dueChoices, dueLabel, hhmm, monthGrid, splitDue, timeLabel, withTime } from '../state/tasks';

const c = theme.colors;
const f = theme.font;
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MINUTES = [0, 15, 30, 45];

/**
 * A deadline like Apple Reminders: quick chips, then a Date switch that opens an
 * inline calendar and a Time switch that opens a time picker. Pure JS, so it
 * works the same in Expo Go and on web. `value` is `YYYY-MM-DD`,
 * `YYYY-MM-DDTHH:MM`, null ("no rush") or undefined (not answered); every change
 * sends the whole value.
 */
export function DeadlinePicker({ value, onChange, noRush = false, allowTime = true }: {
  value: string | null | undefined;
  onChange: (v: string | null | undefined) => void;
  noRush?: boolean;
  allowTime?: boolean;
}) {
  const now = new Date();
  const today = addDays(now, 0);
  const parts = value ? splitDue(value) : null;
  const [open, setOpen] = useState<'date' | 'time' | null>(null);
  const shown = parts ? new Date(`${parts.date}T00:00`) : now;
  const [month, setMonth] = useState({ y: shown.getFullYear(), m: shown.getMonth() });

  const setDate = (date: string) => {
    onChange(withTime(date, parts?.time ?? null));
    const d = new Date(`${date}T00:00`);
    setMonth({ y: d.getFullYear(), m: d.getMonth() });
  };
  const setTime = (time: string | null) => onChange(withTime(parts?.date ?? today, time));

  const toggleDate = (on: boolean) => {
    if (on) { setDate(parts?.date ?? today); setOpen('date'); } else { onChange(undefined); setOpen(null); }
  };
  const toggleTime = (on: boolean) => {
    if (on) {
      // Like Reminders: the next whole hour, shown so she can change it.
      setTime(hhmm(Math.min(23, now.getHours() + 1), 0));
      setOpen('time');
    } else { setTime(null); setOpen(open === 'time' ? null : open); }
  };

  const [h, m] = parts?.time ? parts.time.split(':').map(Number) : [null, null];
  const pm = h != null && h >= 12;
  const h12 = h != null ? (h % 12 || 12) : null;
  const pickTime = (nh12: number, nm: number, npm: boolean) => setTime(hhmm((nh12 % 12) + (npm ? 12 : 0), nm));

  const monthName = new Date(month.y, month.m, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const shiftMonth = (by: number) => setMonth(({ y, m: mm }) => {
    const d = new Date(y, mm + by, 1);
    return { y: d.getFullYear(), m: d.getMonth() };
  });
  const canGoBack = month.y > now.getFullYear() || month.m > now.getMonth();

  return (
    <View>
      <View style={styles.chips}>
        {dueChoices(now, noRush).map((o) => {
          const on = o.due === null ? value === null : parts?.date === o.due;
          return (
            <Chip
              key={o.label}
              label={on ? `✓ ${o.label}` : o.label}
              suggested={on}
              quiet={o.due === null}
              onPress={() => (o.due === null ? (onChange(null), setOpen(null)) : setDate(o.due))}
            />
          );
        })}
      </View>

      <View style={styles.card}>
        <Pressable style={styles.row} onPress={() => parts && setOpen(open === 'date' ? null : 'date')}>
          <View style={[styles.icon, { backgroundColor: c.accent }]}><Text style={styles.iconText}>▦</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>Date</Text>
            {parts ? <Text style={styles.rowValue}>{dueLabel(parts.date, now)}</Text> : null}
          </View>
          <Switch value={!!parts} onValueChange={toggleDate} trackColor={{ true: c.green, false: c.border }} thumbColor={c.paper} />
        </Pressable>

        {open === 'date' && parts && (
          <View style={styles.calendar}>
            <View style={styles.monthRow}>
              <Pressable onPress={() => canGoBack && shiftMonth(-1)} hitSlop={10} disabled={!canGoBack}>
                <Text style={[styles.arrow, !canGoBack && { color: c.checkOff }]}>‹</Text>
              </Pressable>
              <Text style={styles.month}>{monthName}</Text>
              <Pressable onPress={() => shiftMonth(1)} hitSlop={10}><Text style={styles.arrow}>›</Text></Pressable>
            </View>
            <View style={styles.week}>
              {WEEKDAYS.map((d, i) => <Text key={i} style={styles.weekday}>{d}</Text>)}
            </View>
            {monthGrid(month.y, month.m).map((week, wi) => (
              <View key={wi} style={styles.week}>
                {week.map((date, di) => {
                  if (!date) return <View key={di} style={styles.cell} />;
                  const past = date < today;
                  const picked = date === parts.date;
                  return (
                    <Pressable
                      key={date}
                      disabled={past}
                      onPress={() => setDate(date)}
                      style={[styles.cell, picked && styles.cellPicked]}
                      accessibilityLabel={dueLabel(date, now)}
                    >
                      <Text style={[
                        styles.day,
                        date === today && { color: c.accent, fontFamily: f.sansBold },
                        past && { color: c.checkOff },
                        picked && { color: c.onDark },
                      ]}>
                        {Number(date.slice(8))}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>
        )}

        {allowTime && (
          <>
            <View style={styles.divider} />
            <Pressable style={styles.row} onPress={() => parts?.time && setOpen(open === 'time' ? null : 'time')}>
              <View style={[styles.icon, { backgroundColor: c.teal }]}><Text style={styles.iconText}>◷</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>Time</Text>
                {parts?.time ? <Text style={styles.rowValue}>{timeLabel(parts.time)}</Text> : null}
              </View>
              <Switch value={!!parts?.time} onValueChange={toggleTime} trackColor={{ true: c.green, false: c.border }} thumbColor={c.paper} />
            </Pressable>
            {open === 'time' && h12 != null && m != null && (
              <View style={styles.timeBox}>
                <View style={styles.chips}>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                    <Chip key={n} label={`${n}`} suggested={n === h12} quiet={n !== h12} onPress={() => pickTime(n, m, pm)} />
                  ))}
                </View>
                <View style={styles.chips}>
                  {MINUTES.map((n) => (
                    <Chip key={n} label={`:${`${n}`.padStart(2, '0')}`} suggested={n === m} quiet={n !== m} onPress={() => pickTime(h12, n, pm)} />
                  ))}
                  <Chip label="am" suggested={!pm} quiet={pm} onPress={() => pickTime(h12, m, false)} />
                  <Chip label="pm" suggested={pm} quiet={!pm} onPress={() => pickTime(h12, m, true)} />
                </View>
              </View>
            )}
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap' },
  card: { borderWidth: 1, borderColor: c.border, borderRadius: 14, backgroundColor: c.paper, marginTop: 6, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 11 },
  icon: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  iconText: { color: c.onDark, fontSize: 15 },
  rowTitle: { fontFamily: f.sansMedium, fontSize: 16, color: c.ink },
  rowValue: { fontFamily: f.sans, fontSize: 13, color: c.accent, marginTop: 1 },
  divider: { height: 1, backgroundColor: c.hairline, marginLeft: 56 },
  calendar: { paddingHorizontal: 10, paddingBottom: 10, borderTopWidth: 1, borderTopColor: c.hairline },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingVertical: 10 },
  month: { fontFamily: f.sansBold, fontSize: 15, color: c.ink },
  arrow: { fontSize: 24, color: c.accent, paddingHorizontal: 8 },
  week: { flexDirection: 'row' },
  weekday: { flex: 1, textAlign: 'center', fontFamily: f.sansBold, fontSize: 11, color: c.kicker, paddingBottom: 4 },
  cell: { flex: 1, aspectRatio: 1, maxHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 999 },
  cellPicked: { backgroundColor: c.accent },
  day: { fontFamily: f.sans, fontSize: 16, color: c.ink },
  timeBox: { paddingHorizontal: 12, paddingBottom: 10, borderTopWidth: 1, borderTopColor: c.hairline, paddingTop: 8 },
});
