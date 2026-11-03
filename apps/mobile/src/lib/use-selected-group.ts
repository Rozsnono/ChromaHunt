import { useCallback, useEffect, useState } from 'react';
import { prefs } from './storage';
import type { GroupSummary } from './types';
import { useApi, type Resource } from './use-api';

const SELECTED_GROUP_PREF = 'ch_selected_group';

export interface SelectedGroup {
  groups: Resource<GroupSummary[]>;
  /** The chosen group, or the first one when nothing (valid) is stored. */
  group: GroupSummary | null;
  select: (id: string) => void;
}

/** Shared by the Today, Calendar and Ranking tabs so they all show the same group. */
export function useSelectedGroup(): SelectedGroup {
  const groups = useApi<GroupSummary[]>('/api/groups');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    prefs.get(SELECTED_GROUP_PREF).then(setSelectedId).catch(() => undefined);
  }, []);

  const select = useCallback((id: string) => {
    setSelectedId(id);
    prefs.set(SELECTED_GROUP_PREF, id).catch(() => undefined);
  }, []);

  const list = groups.data ?? [];
  return { groups, group: list.find((g) => g.id === selectedId) ?? list[0] ?? null, select };
}
