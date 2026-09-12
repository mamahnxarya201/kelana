/**
 * Board selection state: which entities/groups are selected, plus the
 * context menus anchored to the selection.
 */
export const selection = $state({
  selected: '',
  ids: [] as string[],
  group: '',
  menu: null as { x: number; y: number } | null,
  groupMenu: null as { id: string; x: number; y: number } | null,
});

export function selectOnly(id: string) {
  selection.selected = id;
  selection.ids = [id];
  selection.group = '';
  selection.menu = null;
  selection.groupMenu = null;
}

export function selectGroup(id: string) {
  selection.selected = '';
  selection.ids = [];
  selection.group = id;
  selection.menu = null;
  selection.groupMenu = null;
}

export function clearSelection() {
  selection.selected = '';
  selection.ids = [];
  selection.group = '';
  selection.menu = null;
  selection.groupMenu = null;
}
