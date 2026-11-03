import { Tabs } from 'expo-router';
import { CalendarDays, Palette, Trophy, UsersRound } from 'lucide-react-native';
import { useI18n } from '@/i18n';
import { useThemeColors } from '@/lib/theme';

export default function TabsLayout() {
  const { t } = useI18n();
  const colors = useThemeColors();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brandSoft,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarLabelStyle: { fontSize: 12, fontWeight: '500' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t('tabs.today'), tabBarIcon: ({ color, size }) => <Palette color={color} size={size} /> }} />
      <Tabs.Screen name="calendar" options={{ title: t('tabs.calendar'), tabBarIcon: ({ color, size }) => <CalendarDays color={color} size={size} /> }} />
      <Tabs.Screen name="ranking" options={{ title: t('tabs.ranking'), tabBarIcon: ({ color, size }) => <Trophy color={color} size={size} /> }} />
      <Tabs.Screen name="groups" options={{ title: t('tabs.groups'), tabBarIcon: ({ color, size }) => <UsersRound color={color} size={size} /> }} />
    </Tabs>
  );
}
