import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import Animated, { FadeInDown, ReduceMotion } from 'react-native-reanimated';

import { feedback, MotionPressable } from '@/lib/motion';

const enterScreen = FadeInDown.duration(240).withInitialValues({ opacity: 0, translateY: 10 }).reduceMotion(ReduceMotion.System);

export const displayFont = Platform.select({ ios: 'Georgia', android: 'serif', default: 'Georgia' });

export const colors = {
  sky: '#4099E6',
  navy: '#0064BC',
  baby: '#AED9FF',
  pale: '#E8F5FF',
  bg: '#FCFBF7',
  white: '#FFFFFF',
  text: '#112F46',
  muted: '#4F6471',
  border: '#D6E1E6',
  danger: '#C62828',
  dangerBg: '#FDECEC',
  warning: '#9A5B00',
  warningBg: '#FFF4E0',
  success: '#1E7D4F',
  successBg: '#E6F6EE',
  sim: '#6B4BB8',
  simBg: '#F1ECFB',
};

export type IconName = ComponentProps<typeof Ionicons>['name'];
export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'sim';

const toneColors: Record<Tone, { fg: string; bg: string }> = {
  neutral: { fg: colors.muted, bg: '#EEF3F7' },
  info: { fg: colors.navy, bg: colors.pale },
  success: { fg: colors.success, bg: colors.successBg },
  warning: { fg: colors.warning, bg: colors.warningBg },
  danger: { fg: colors.danger, bg: colors.dangerBg },
  sim: { fg: colors.sim, bg: colors.simBg },
};

type ScreenProps = {
  children: ReactNode;
  edges?: Edge[];
  refreshing?: boolean;
  onRefresh?: () => void | Promise<unknown>;
  scroll?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  bottomInset?: number;
};

export function Screen({ children, edges = [], refreshing, onRefresh, scroll = true, contentStyle, bottomInset = 32 }: ScreenProps) {
  const [pulling, setPulling] = useState(false);
  const refresh = onRefresh
    ? async () => {
        setPulling(true);
        try {
          await onRefresh();
        } finally {
          setPulling(false);
        }
      }
    : undefined;
  return (
    <SafeAreaView style={styles.screen} edges={edges}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={styles.scrollContainer}
          keyboardShouldPersistTaps="handled"
          refreshControl={refresh ? <RefreshControl refreshing={refreshing ?? pulling} onRefresh={refresh} /> : undefined}>
          <Animated.View entering={enterScreen} style={[styles.content, { paddingBottom: bottomInset }, contentStyle]}>{children}</Animated.View>
        </ScrollView>
      ) : (
        <Animated.View entering={enterScreen} style={[styles.flex, contentStyle]}>{children}</Animated.View>
      )}
    </SafeAreaView>
  );
}

export function Hero({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <View style={styles.hero}>
      <View style={styles.flex}>
        <Text style={styles.heroTitle}>{title}</Text>
        {subtitle ? <Text style={styles.heroSubtitle}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export function Card({ children, onPress, style, tone }: { children: ReactNode; onPress?: () => void; style?: StyleProp<ViewStyle>; tone?: Tone }) {
  const toneStyle = tone ? { backgroundColor: toneColors[tone].bg, borderColor: toneColors[tone].bg } : undefined;
  if (!onPress) return <View style={[styles.card, toneStyle, style]}>{children}</View>;
  return (
    <MotionPressable accessibilityRole="button" onPress={onPress} style={[styles.card, toneStyle, style]}>
      {children}
    </MotionPressable>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <View style={styles.sectionRow}>
      <Text style={styles.sectionTitle}>{children}</Text>
      {action}
    </View>
  );
}

export const Title = ({ children }: { children: ReactNode }) => <Text style={styles.title}>{children}</Text>;
export const Body = ({ children, style }: { children: ReactNode; style?: object }) => <Text style={[styles.body, style]}>{children}</Text>;
export const Muted = ({ children, style }: { children: ReactNode; style?: object }) => <Text style={[styles.muted, style]}>{children}</Text>;
export const Strong = ({ children }: { children: ReactNode }) => <Text style={styles.strong}>{children}</Text>;

type ButtonProps = {
  label: string;
  onPress?: () => void;
  variant?: 'primary' | 'outline' | 'danger' | 'ghost';
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function Button({ label, onPress, variant = 'primary', icon, loading, disabled, compact, style }: ButtonProps) {
  const fg = variant === 'primary' || variant === 'danger' ? colors.white : colors.navy;
  return (
    <MotionPressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      style={[
        styles.button,
        compact && styles.buttonCompact,
        variant === 'primary' && { backgroundColor: colors.navy },
        variant === 'danger' && { backgroundColor: colors.danger },
        variant === 'outline' && styles.buttonOutline,
        variant === 'ghost' && styles.buttonGhost,
        (disabled || loading) && styles.disabled,
        style,
      ]}>
      {loading ? <ActivityIndicator color={fg} /> : icon ? <Ionicons name={icon} size={18} color={fg} /> : null}
      <Text style={[styles.buttonText, { color: fg }, compact && styles.buttonTextCompact]}>{label}</Text>
    </MotionPressable>
  );
}

export function Field({ label, hint, ...props }: TextInputProps & { label: string; hint?: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor="#8CA0B0"
        {...props}
        style={[styles.input, props.multiline && styles.inputMultiline, props.style]}
      />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

export function Chips<T extends string>({ label, options, value, onChange }: { label?: string; options: { value: T; label: string }[]; value?: T; onChange: (value: T) => void }) {
  return (
    <View style={styles.field}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={styles.chips}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <MotionPressable
              key={option.value}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              feedback={selected ? 'none' : 'selection'}
              onPress={() => { if (!selected) onChange(option.value); }}
              style={[styles.chip, selected && styles.chipSelected]}>
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{option.label}</Text>
            </MotionPressable>
          );
        })}
      </View>
    </View>
  );
}

export function Toggle({ label, detail, value, onChange }: { label: string; detail?: string; value: boolean; onChange: (value: boolean) => void }) {
  return (
    <View style={styles.toggle}>
      <View style={styles.flex}>
        <Text style={styles.strong}>{label}</Text>
        {detail ? <Text style={styles.muted}>{detail}</Text> : null}
      </View>
      <Switch accessibilityLabel={label} value={value} onValueChange={(next) => { feedback('selection'); onChange(next); }} trackColor={{ true: colors.sky, false: '#CBD5DD' }} />
    </View>
  );
}

export function Badge({ label, tone = 'info' }: { label: string; tone?: Tone }) {
  return (
    <View style={[styles.badge, { backgroundColor: toneColors[tone].bg }]}>
      <Text style={[styles.badgeText, { color: toneColors[tone].fg }]}>{label}</Text>
    </View>
  );
}

const sourceTags = {
  live: { label: 'Live PawSafe data', tone: 'info' },
  external: { label: 'External source', tone: 'neutral' },
  official: { label: 'Official NWS alert', tone: 'danger' },
  curated: { label: 'Curated guidance', tone: 'success' },
  historical: { label: 'Historical · FEMA', tone: 'neutral' },
  simulation: { label: 'Simulation', tone: 'sim' },
  ai: { label: 'AI generated', tone: 'sim' },
} as const;

/** Every screen keeps live, external and simulated information visibly distinct. */
export function SourceTag({ kind }: { kind: keyof typeof sourceTags }) {
  return <Badge label={sourceTags[kind].label} tone={sourceTags[kind].tone} />;
}

export function Notice({ tone = 'info', title, children, icon }: { tone?: Tone; title?: string; children?: ReactNode; icon?: IconName }) {
  const c = toneColors[tone];
  return (
    <View style={[styles.notice, { backgroundColor: c.bg }]}>
      <Ionicons name={icon ?? (tone === 'danger' || tone === 'warning' ? 'alert-circle' : 'information-circle')} size={20} color={c.fg} />
      <View style={styles.flex}>
        {title ? <Text style={[styles.strong, { color: c.fg }]}>{title}</Text> : null}
        {typeof children === 'string' ? <Text style={[styles.body, { color: colors.text }]}>{children}</Text> : children}
      </View>
    </View>
  );
}

export function ErrorNote({ error, onRetry }: { error?: string; onRetry?: () => void }) {
  useEffect(() => { if (error) feedback('error'); }, [error]);
  if (!error) return null;
  return (
    <Animated.View entering={FadeInDown.duration(180).reduceMotion(ReduceMotion.System)}>
      <Notice tone="danger" title={onRetry ? 'Something went wrong' : undefined}>
        <Text style={styles.body}>{error}</Text>
        {onRetry ? <Button label="Try again" variant="ghost" compact onPress={onRetry} style={styles.alignStart} /> : null}
      </Notice>
    </Animated.View>
  );
}

export function Empty({ icon = 'paw-outline', title, body }: { icon?: IconName; title: string; body?: string }) {
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={28} color={colors.baby} />
      <Text style={styles.strong}>{title}</Text>
      {body ? <Text style={[styles.muted, styles.center]}>{body}</Text> : null}
    </View>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <View style={styles.empty}>
      <ActivityIndicator color={colors.sky} />
      <Text style={styles.muted}>{label}</Text>
    </View>
  );
}

export function KeyValue({ label, value }: { label: string; value?: ReactNode }) {
  return (
    <View style={styles.kv}>
      <Text style={styles.kvLabel}>{label}</Text>
      {typeof value === 'string' || typeof value === 'number' || value == null ? (
        <Text style={styles.kvValue}>{value === '' || value == null ? '—' : value}</Text>
      ) : (
        value
      )}
    </View>
  );
}

export function ListRow({ icon, title, detail, right, onPress }: { icon?: IconName; title: string; detail?: string; right?: ReactNode; onPress?: () => void }) {
  return (
    <MotionPressable accessibilityRole={onPress ? 'button' : undefined} onPress={onPress} disabled={!onPress} style={styles.listRow}>
      {icon ? (
        <View style={styles.listIcon}>
          <Ionicons name={icon} size={20} color={colors.navy} />
        </View>
      ) : null}
      <View style={styles.flex}>
        <Text style={styles.strong} numberOfLines={2}>
          {title}
        </Text>
        {detail ? <Text style={styles.muted} numberOfLines={3}>{detail}</Text> : null}
      </View>
      {right ?? (onPress ? <Ionicons name="chevron-forward" size={18} color={colors.baby} /> : null)}
    </MotionPressable>
  );
}

export function SourceLink({ url, label }: { url: string; label?: string }) {
  return (
    <MotionPressable accessibilityRole="link" onPress={() => { if (/^https?:\/\//i.test(url)) void Linking.openURL(url).catch(() => undefined); }} style={styles.linkPress}>
      <Text style={styles.link} numberOfLines={1}>{label ?? url.replace(/^https?:\/\//, '')}</Text>
    </MotionPressable>
  );
}

export function Row({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.row, style]}>{children}</View>;
}

export function Stat({ label, value, tone = 'info' }: { label: string; value: string | number; tone?: Tone }) {
  return (
    <View style={[styles.stat, { backgroundColor: toneColors[tone].bg }]}>
      <Text style={[styles.statValue, { color: toneColors[tone].fg }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { textAlign: 'center' },
  alignStart: { alignSelf: 'flex-start' },
  screen: { flex: 1, backgroundColor: colors.bg },
  scrollContainer: { flexGrow: 1 },
  content: { width: '100%', maxWidth: 880, alignSelf: 'center', padding: 20, gap: 14 },
  hero: {
    backgroundColor: '#D9EEFF',
    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: 26,
    borderRadius: 22,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 4,
  },
  heroTitle: { fontFamily: displayFont, color: colors.text, fontSize: 36, letterSpacing: -1.3, fontWeight: 'bold' },
  heroSubtitle: { color: colors.text, fontSize: 15, marginTop: 7, lineHeight: 22, maxWidth: 560 },
  card: { backgroundColor: colors.white, borderRadius: 18, padding: 16, borderWidth: 1, borderColor: colors.border, gap: 6 },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.5 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  sectionTitle: { flexShrink: 1, fontFamily: displayFont, fontSize: 24, letterSpacing: -0.7, fontWeight: 'bold', color: colors.text },
  title: { fontFamily: displayFont, fontSize: 29, letterSpacing: -0.8, fontWeight: 'bold', color: colors.text },
  body: { fontSize: 15, lineHeight: 21, color: colors.text },
  muted: { fontSize: 13, lineHeight: 18, color: colors.muted },
  strong: { fontSize: 16, fontWeight: '700', color: colors.text },
  button: {
    minHeight: 48,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  buttonCompact: { minHeight: 36, paddingVertical: 7, paddingHorizontal: 12, borderRadius: 11 },
  buttonOutline: { borderWidth: 2, borderColor: colors.sky, backgroundColor: colors.white },
  buttonGhost: { backgroundColor: colors.pale },
  buttonText: { fontSize: 16, fontWeight: '700' },
  buttonTextCompact: { fontSize: 14 },
  field: { gap: 6 },
  label: { fontSize: 14, fontWeight: '700', color: colors.text },
  hint: { fontSize: 12, color: colors.muted },
  input: {
    borderWidth: 1.5,
    borderColor: colors.baby,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    backgroundColor: colors.white,
    fontSize: 16,
    color: colors.text,
  },
  inputMultiline: { minHeight: 80, textAlignVertical: 'top' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1.5, borderColor: colors.baby, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: colors.white },
  chipSelected: { backgroundColor: colors.navy, borderColor: colors.navy },
  chipText: { color: colors.text, fontWeight: '600' },
  chipTextSelected: { color: colors.white },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, alignSelf: 'flex-start' },
  badgeText: { fontSize: 12, fontWeight: '700' },
  notice: { flexDirection: 'row', gap: 10, padding: 14, borderRadius: 14, alignItems: 'flex-start' },
  empty: { alignItems: 'center', gap: 6, paddingVertical: 22, paddingHorizontal: 12 },
  kv: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 4 },
  kvLabel: { color: colors.muted, fontSize: 14 },
  kvValue: { color: colors.text, fontSize: 14, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  listIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: colors.pale, alignItems: 'center', justifyContent: 'center' },
  link: { color: colors.navy, fontSize: 13, textDecorationLine: 'underline' },
  linkPress: { alignSelf: 'flex-start', maxWidth: '100%' },
  row: { flexDirection: 'row', gap: 10, alignItems: 'center', flexWrap: 'wrap' },
  stat: { flex: 1, minWidth: 92, borderRadius: 16, padding: 12, gap: 2 },
  statValue: { fontSize: 24, fontWeight: '800' },
  statLabel: { fontSize: 12, color: colors.muted, fontWeight: '600' },
});
