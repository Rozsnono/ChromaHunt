/** Small design-system layer on NativeWind (Tailwind): screen, text, buttons, fields, cards. */
import { Eye, EyeOff, TriangleAlert, type LucideIcon } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from '@/i18n';
import { useThemeColors } from '@/lib/theme';

/** Scrollable, keyboard aware page with safe-area padding. */
export function Screen({ children, scroll = true, padded = true }: { children: ReactNode; scroll?: boolean; padded?: boolean }) {
  const insets = useSafeAreaInsets();
  const body = (
    <View className={padded ? 'flex-1 gap-4 px-5' : 'flex-1'} style={{ paddingTop: insets.top + 12, paddingBottom: insets.bottom + 16 }}>
      {children}
    </View>
  );
  return (
    <KeyboardAvoidingView className="flex-1 bg-slate-50 dark:bg-[#0b1020]" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {scroll ? (
        <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {body}
        </ScrollView>
      ) : (
        body
      )}
    </KeyboardAvoidingView>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return <Text className="text-3xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">{children}</Text>;
}

export function Body({ children, muted, className = '' }: { children: ReactNode; muted?: boolean; className?: string }) {
  return (
    <Text className={`text-base leading-6 ${muted ? 'text-slate-500 dark:text-slate-400' : 'text-slate-800 dark:text-slate-100'} ${className}`}>{children}</Text>
  );
}

type Variant = 'primary' | 'secondary' | 'ghost';
const buttonStyles: Record<Variant, { box: string; text: string }> = {
  primary: { box: 'bg-brand-600', text: 'text-white' },
  secondary: { box: 'bg-white border border-slate-300 dark:bg-[#141a2e] dark:border-[#26304d]', text: 'text-slate-900 dark:text-slate-100' },
  ghost: { box: 'bg-transparent', text: 'text-brand-600 dark:text-brand-400' },
};

/** Plain pressable button: pressed state is a small opacity change, no animation. */
export function Button({
  label,
  onPress,
  variant = 'primary',
  loading,
  disabled,
  icon: Icon,
}: {
  label: string;
  onPress: () => void;
  variant?: Variant;
  loading?: boolean;
  disabled?: boolean;
  icon?: LucideIcon;
}) {
  const style = buttonStyles[variant];
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
      className={`min-h-12 flex-row items-center justify-center gap-2 rounded-2xl px-5 py-3 ${style.box} ${inactive ? 'opacity-60' : ''}`}
    >
      {loading ? <ActivityIndicator color={variant === 'primary' ? '#fff' : '#4f46e5'} /> : Icon ? <Icon size={18} color={variant === 'primary' ? '#fff' : '#4f46e5'} /> : null}
      <Text className={`text-base font-medium ${style.text}`}>{label}</Text>
    </Pressable>
  );
}

export function TextField({
  label,
  error,
  hint,
  secure,
  ...rest
}: TextInputProps & { label: string; error?: string | null; hint?: string; secure?: boolean }) {
  const { t } = useI18n();
  const colors = useThemeColors();
  const [hidden, setHidden] = useState(true);
  const [focused, setFocused] = useState(false);
  return (
    <View className="gap-1.5">
      <Text className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</Text>
      <View
        className={`min-h-12 flex-row items-center rounded-2xl border bg-white px-4 dark:bg-[#141a2e] ${
          error ? 'border-red-500' : focused ? 'border-brand-500' : 'border-slate-300 dark:border-[#26304d]'
        }`}
      >
        <TextInput
          className="flex-1 py-3 text-base text-slate-900 dark:text-slate-50"
          placeholderTextColor={colors.muted}
          accessibilityLabel={label}
          secureTextEntry={secure ? hidden : false}
          autoCapitalize="none"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          {...rest}
        />
        {secure && (
          <Pressable accessibilityRole="button" accessibilityLabel={hidden ? t('common.show') : t('common.hide')} onPress={() => setHidden(!hidden)} hitSlop={10}>
            {hidden ? <Eye size={20} color={colors.muted} /> : <EyeOff size={20} color={colors.muted} />}
          </Pressable>
        )}
      </View>
      {error ? (
        <Text accessibilityLiveRegion="polite" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </Text>
      ) : hint ? (
        <Text className="text-sm text-slate-500 dark:text-slate-400">{hint}</Text>
      ) : null}
    </View>
  );
}

export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <View accessibilityLiveRegion="assertive" className="flex-row items-start gap-3 rounded-2xl bg-red-50 p-4 dark:bg-red-950/50">
      <TriangleAlert size={20} color="#dc2626" />
      <Text className="flex-1 text-sm leading-5 text-red-700 dark:text-red-300">{message}</Text>
    </View>
  );
}

export function Card({ children, index = 0, className = '' }: { children: ReactNode; index?: number; className?: string }) {
  return (
    <View
      className={`rounded-3xl border border-slate-200 bg-white p-5 dark:border-[#26304d] dark:bg-[#141a2e] ${className}`}
    >
      {children}
    </View>
  );
}

export function EmptyState({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  const colors = useThemeColors();
  return (
    <View className="flex-1 items-center justify-center gap-4 px-8">
      <View className="size-20 items-center justify-center rounded-full bg-brand-50 dark:bg-[#1b2140]">
        <Icon size={34} color={colors.brandSoft} />
      </View>
      <Text className="text-center text-base leading-6 text-slate-500 dark:text-slate-400">{text}</Text>
    </View>
  );
}

/** Row used in settings lists. */
export function Row({ label, children, onPress }: { label: string; children?: ReactNode; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? 'button' : undefined} className="min-h-12 flex-row items-center justify-between gap-3 py-2">
      <Text className="text-base text-slate-800 dark:text-slate-100">{label}</Text>
      {children}
    </Pressable>
  );
}

/** Round color swatch (the color of the day). */
export function Swatch({ hex, size = 40 }: { hex: string; size?: number }) {
  return <View accessibilityElementsHidden style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: hex }} className="border border-black/10 dark:border-white/20" />;
}

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'brand' | 'success' | 'warning' }) {
  const tones = {
    neutral: 'bg-slate-100 dark:bg-[#1f2744]',
    brand: 'bg-brand-100 dark:bg-[#252d5c]',
    success: 'bg-green-100 dark:bg-green-950',
    warning: 'bg-amber-100 dark:bg-amber-950',
  };
  const text = {
    neutral: 'text-slate-600 dark:text-slate-300',
    brand: 'text-brand-700 dark:text-brand-200',
    success: 'text-green-800 dark:text-green-300',
    warning: 'text-amber-800 dark:text-amber-300',
  };
  return (
    <View className={`self-start rounded-full px-2.5 py-1 ${tones[tone]}`}>
      <Text className={`text-xs font-medium ${text[tone]}`}>{label}</Text>
    </View>
  );
}

export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2 }} className="items-center justify-center bg-brand-100 dark:bg-[#252d5c]">
      <Text className="font-semibold text-brand-700 dark:text-brand-200" style={{ fontSize: size * 0.42 }}>
        {name.trim().charAt(0).toUpperCase()}
      </Text>
    </View>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <Text className="text-sm font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{children}</Text>;
}
