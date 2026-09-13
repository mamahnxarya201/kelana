/**
 * Board selection state: which entities/groups are selected, plus the
 * context menus anchored to the selection.
 */
export const selection = $state({
  selected: '',
  ids: [] as string[],
  group: '',
  edge: '',
  menu: null as { x: number; y: number } | null,
  groupMenu: null as { id: string; x: number; y: number } | null,
  edgeMenu: null as { id: string; x: number; y: number } | null,
});

export function selectOnly(id: string) {
  selection.selected = id;
  selection.ids = [id];
  selection.group = '';
  selection.edge = '';
  selection.menu = null;
  selection.groupMenu = null;
  selection.edgeMenu = null;
}

export function selectGroup(id: string) {
  selection.selected = '';
  selection.ids = [];
  selection.group = id;
  selection.edge = '';
  selection.menu = null;
  selection.groupMenu = null;
  selection.edgeMenu = null;
}

export function selectEdge(id: string) {
  selection.selected = '';
  selection.ids = [];
  selection.group = '';
  selection.edge = id;
  selection.menu = null;
  selection.groupMenu = null;
}

export function clearSelection() {
  selection.selected = '';
  selection.ids = [];
  selection.group = '';
  selection.edge = '';
  selection.menu = null;
  selection.groupMenu = null;
  selection.edgeMenu = null;
}
