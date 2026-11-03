import { Pressable, ScrollView, Text } from 'react-native';
import type { GroupSummary } from '@/lib/types';

/** Horizontal group switcher; renders nothing when there is only one group. */
export function GroupChips({ groups, selectedId, onSelect }: { groups: GroupSummary[]; selectedId?: string; onSelect: (id: string) => void }) {
  if (groups.length < 2) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} style={{ flexGrow: 0 }}>
      {groups.map((g) => (
        <Pressable key={g.id} accessibilityRole="button" accessibilityState={{ selected: g.id === selectedId }} onPress={() => onSelect(g.id)} className={`min-h-11 justify-center rounded-full px-4 ${g.id === selectedId ? 'bg-brand-600' : 'bg-white dark:bg-[#141a2e]'}`}>
          <Text className={`text-base font-medium ${g.id === selectedId ? 'text-white' : 'text-slate-700 dark:text-slate-200'}`}>{g.name}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}
