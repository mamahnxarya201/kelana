export type Point = { x: number; y: number };
export type Anchor = {
  pdfId: string;
  page: number;
  quote: string;
  start: number;
  end: number;
  rects: { x: number; y: number; width: number; height: number }[];
  createdAt: number;
};
export type Entity = {
  id: string;
  type: 'markdown' | 'pdf' | 'image' | 'annotation';
  title: string;
  body: string;
  color: string;
  assetId?: string;
  anchor?: Anchor;
};
export type Placement = Point & {
  id: string;
  entityId: string;
  width: number;
  height: number;
  z: number;
};
export type Pane = {
  entityId: string;
  column: 'primary' | 'secondary';
  scroll: number;
  zoom: number;
  caret?: number;
  page?: number;
  jump?: number;
  readPage?: number;
  readOffset?: number;
  folded?: boolean;
};
export type ConnectionSide = 'top' | 'right' | 'bottom' | 'left';
export type FontId =
  | 'inter'
  | 'source-sans'
  | 'source-serif'
  | 'lora'
  | 'stix-two'
  | 'libertinus';
export type Edge = {
  id: string;
  from: string;
  to: string;
  fromSide?: ConnectionSide;
  toSide?: ConnectionSide;
};
export type Group = {
  id: string;
  label: string;
  color: string;
  entityIds: string[];
  x?: number;
  y?: number;
  width?: number;
  height?: number;
};
export type Doc = {
  version: 1;
  title: string;
  entities: Record<string, Entity>;
  placements: Placement[];
  panes: Pane[];
  edges: Edge[];
  groups?: Group[];
  navigationMode?: 'mouse' | 'touchpad';
  whiteboardFont?: FontId;
  interfaceFont?: FontId;
  camera: Point & { zoom: number };
  benchWidth: number;
  benchSingleWidth?: number;
  benchDoubleWidth?: number;
  splitRatio?: number;
  columnScroll?: { primary: number; secondary: number };
};
export type Asset = {
  id: string;
  storageKey: string;
  mimeType: string;
  byteSize: number;
  checksum: string;
  createdAt: number;
  backend: 'opfs' | 'idb';
};
export type Change = {
  collection: 'entities' | 'placements' | 'panes' | 'edges' | 'document';
  id: string;
  before: unknown;
  after: unknown;
};
export const uid = (prefix: string) => `${prefix}:${crypto.randomUUID()}`;
export function applyChanges(doc: Doc, changes: Change[], reverse = false): Doc {
  const next = structuredClone(doc);
  for (const c of reverse ? [...changes].reverse() : changes) {
    const value = structuredClone(reverse ? c.before : c.after);
    if (c.collection === 'entities') {
      if (value === undefined) delete next.entities[c.id];
      else next.entities[c.id] = value as Entity;
    } else if (c.collection === 'document') Object.assign(next, { [c.id]: value });
    else {
      const list = next[c.collection] as unknown as Record<string, unknown>[];
      const key = c.collection === 'panes' ? 'entityId' : 'id';
      const i = list.findIndex((v) => v[key] === c.id);
      if (value === undefined) {
        if (i >= 0) list.splice(i, 1);
      } else if (i >= 0) list[i] = value as Record<string, unknown>;
      else list.push(value as Record<string, unknown>);
    }
  }
  return next;
}
export function openPane(doc: Doc, id: string): Pane[] {
  const existing = doc.panes.find((p) => p.entityId === id);
  return existing
    ? doc.panes.map((p) =>
        p.entityId === id ? { ...p, column: 'primary', ...(p.folded ? { folded: false } : {}) } : p,
      )
    : [...doc.panes, { entityId: id, column: 'primary', scroll: 0, zoom: 1 }];
}
export function closePane(doc: Doc, id: string): Pane[] {
  return normalizePanes(doc.panes.filter((p) => p.entityId !== id));
}
export function normalizePanes(panes: Pane[]): Pane[] {
  return panes.length && !panes.some((p) => p.column === 'primary')
    ? panes.map((p) => ({ ...p, column: 'primary' }))
    : panes;
}
export function movePane(doc: Doc, id: string): Pane[] {
  if (doc.panes.length < 2) return doc.panes;
  return normalizePanes(
    doc.panes.map((p) =>
      p.entityId === id ? { ...p, column: p.column === 'primary' ? 'secondary' : 'primary' } : p,
    ),
  );
}
export function benchSize(doc: Doc): number {
  return doc.panes.some((p) => p.column === 'secondary')
    ? (doc.benchDoubleWidth ?? 900)
    : (doc.benchSingleWidth ?? Math.min(doc.benchWidth, 560));
}
export class SpatialGrid {
  buckets = new Map<string, Placement[]>();
  size = 400;
  constructor(placements: Placement[]) {
    for (const p of placements)
      for (let x = Math.floor(p.x / this.size); x <= Math.floor((p.x + p.width) / this.size); x++)
        for (
          let y = Math.floor(p.y / this.size);
          y <= Math.floor((p.y + p.height) / this.size);
          y++
        ) {
          const k = `${x},${y}`;
          if (!this.buckets.has(k)) this.buckets.set(k, []);
          this.buckets.get(k)!.push(p);
        }
  }
  query(x: number, y: number, w: number, h: number) {
    const found = new Map<string, Placement>();
    for (let a = Math.floor(x / this.size); a <= Math.floor((x + w) / this.size); a++)
      for (let b = Math.floor(y / this.size); b <= Math.floor((y + h) / this.size); b++)
        for (const p of this.buckets.get(`${a},${b}`) ?? [])
          if (p.x + p.width >= x && p.x <= x + w && p.y + p.height >= y && p.y <= y + h)
            found.set(p.id, p);
    return [...found.values()].sort((a, b) => a.z - b.z);
  }
}
export function seed(): Doc {
  const entries: Entity[] = [
    {
      id: 'card:start',
      type: 'markdown',
      title: 'A place to think, not organize.',
      body: '## A place to think, not organize.\n\nKeep the source. Follow the question. Make room for the thought that doesn’t fit yet.\n\nNothing needs a folder before it deserves a place.',
      color: 'white',
    },
    {
      id: 'card:question',
      type: 'markdown',
      title: 'What makes an idea stick?',
      body: '## What makes an idea stick?\n\nIs it the idea itself — or the things we put beside it?\n\n**Proximity is a kind of meaning.**',
      color: 'yellow',
    },
    {
      id: 'card:practice',
      type: 'markdown',
      title: 'Try a small experiment',
      body: '## Try a small experiment\n\n1. Drop a PDF onto this board.\n2. Open it using the corner button.\n3. Select a passage and make a highlight.\n4. Drag that highlight back here.\n\nLet the connections come later.',
      color: 'white',
    },
    {
      id: 'card:notes',
      type: 'markdown',
      title: 'Loose threads',
      body: '## Loose threads\n\n- Spatial memory, not perfect filing\n- Reading is a conversation\n- A question can be a useful outcome\n\nWhat would I put beside this?',
      color: 'blue',
    },
    {
      id: 'card:small',
      type: 'markdown',
      title: 'Leave some room.',
      body: '### Leave some room.\n\nThe next thought hasn’t arrived yet.',
      color: 'pink',
    },
  ];
  return {
    version: 1,
    title: 'Thinking space',
    entities: Object.fromEntries(entries.map((e) => [e.id, e])),
    placements: entries.map((e, i) => ({
      id: `placement:${i}`,
      entityId: e.id,
      x: [115, 485, 135, 510, 865][i],
      y: [100, 155, 425, 465, 280][i],
      width: [295, 285, 300, 280, 240][i],
      height: [230, 215, 285, 265, 160][i],
      z: i,
    })),
    panes: [],
    edges: [
      {
        id: 'edge:seed',
        from: 'card:question',
        to: 'card:notes',
        fromSide: 'bottom',
        toSide: 'top',
      },
    ],
    camera: { x: 0, y: 0, zoom: 1 },
    benchWidth: 530,
  };
}
