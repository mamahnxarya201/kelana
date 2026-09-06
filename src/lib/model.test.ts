import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  seed,
  openPane,
  closePane,
  applyChanges,
  SpatialGrid,
  movePane,
  benchSize,
  type Change,
} from './model';
import { EditorState, EditorSelection } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { activeLines, previewDecorations } from './live-markdown';
import { connectionPath } from './connections';
test('opening a secondary item always returns it to primary, without duplicating the entity or losing reading state', () => {
  const d = seed();
  const id = 'card:start';
  d.panes = [{ entityId: id, column: 'secondary', scroll: 812, zoom: 1.25, caret: 15 }];
  const before = structuredClone(d.entities);
  d.panes = openPane(d, id);
  assert.equal(d.panes.length, 1);
  assert.deepEqual(d.panes[0], {
    entityId: id,
    column: 'primary',
    scroll: 812,
    zoom: 1.25,
    caret: 15,
  });
  assert.deepEqual(d.entities, before);
  assert.equal(d.placements.length, 5);
});
test('closing workbench never removes a source entity or board placement', () => {
  const d = seed();
  d.panes = openPane(d, 'card:start');
  d.panes = closePane(d, 'card:start');
  assert.equal(d.panes.length, 0);
  assert.ok(d.entities['card:start']);
  assert.ok(d.placements.some((p) => p.entityId === 'card:start'));
});
test('compound delete can be reversed with source relationships intact', () => {
  const d = seed();
  const entity = d.entities['card:question'];
  const p = d.placements.find((p) => p.entityId === entity.id)!;
  const edge = d.edges[0];
  const changes: Change[] = [
    { collection: 'entities', id: entity.id, before: entity, after: undefined },
    { collection: 'placements', id: p.id, before: p, after: undefined },
    { collection: 'edges', id: edge.id, before: edge, after: undefined },
  ];
  const deleted = applyChanges(d, changes);
  assert.equal(deleted.entities[entity.id], undefined);
  const restored = applyChanges(deleted, changes, true);
  assert.deepEqual(restored.entities, d.entities);
  assert.deepEqual(
    restored.placements.find((v) => v.id === p.id),
    p,
  );
  assert.deepEqual(restored.edges, d.edges);
});
test('spatial buckets handle negative positions and cards straddling cells without duplicates', () => {
  const p = { id: 'p', entityId: 'e', x: -100, y: -100, width: 900, height: 900, z: 1 };
  const grid = new SpatialGrid([p]);
  assert.equal(grid.query(-20, -20, 1000, 1000).length, 1);
  assert.equal(grid.query(-2000, -2000, 50, 50).length, 0);
});
test('any two notes can work beside each other, retaining independent view state', () => {
  const d = seed();
  d.panes = openPane(d, 'card:start');
  assert.deepEqual(movePane(d, 'card:start'), d.panes);
  d.panes = openPane(d, 'card:notes');
  d.panes[1].caret = 38;
  d.panes[1].folded = true;
  d.panes = movePane(d, 'card:notes');
  assert.equal(d.panes[1].column, 'secondary');
  assert.equal(d.panes[1].caret, 38);
  assert.equal(d.panes[1].folded, true);
  d.panes = openPane(d, 'card:notes');
  assert.equal(d.panes[1].column, 'primary');
  assert.equal(d.panes[1].folded, false);
});
test('closing last primary promotes surviving stack without deleting its entity or view state', () => {
  const d = seed();
  d.panes = [
    { entityId: 'card:start', column: 'primary', scroll: 0, zoom: 1 },
    { entityId: 'card:notes', column: 'secondary', scroll: 600, zoom: 1.25, readPage: 3 },
  ];
  d.panes = closePane(d, 'card:start');
  assert.equal(d.panes.length, 1);
  assert.equal(d.panes[0].column, 'primary');
  assert.equal(d.panes[0].readPage, 3);
  assert.equal(d.panes[0].scroll, 600);
  assert.ok(d.entities['card:start']);
});
test('single and double widths are remembered independently', () => {
  const d = seed();
  d.benchSingleWidth = 500;
  d.benchDoubleWidth = 960;
  d.panes = openPane(d, 'card:start');
  assert.equal(benchSize(d), 500);
  d.panes = openPane(d, 'card:notes');
  d.panes = movePane(d, 'card:notes');
  assert.equal(benchSize(d), 960);
  d.panes = closePane(d, 'card:notes');
  assert.equal(benchSize(d), 500);
});
test('live preview hides inactive syntax without changing source and reveals selected lines', () => {
  const text = '## Heading\n\nA **bold** thought\n\n- Parent\n  - Child';
  let state = EditorState.create({
    doc: text,
    selection: { anchor: 12 },
    extensions: [markdown()],
  });
  function hidden(s: EditorState) {
    const ranges: { from: number; to: number }[] = [];
    previewDecorations(s).between(0, s.doc.length, (from, to, value) => {
      if (from < to && !value.spec.class) ranges.push({ from, to });
    });
    return ranges;
  }
  assert.ok(hidden(state).some((r) => r.from === 0 && r.to === 3));
  assert.ok(!hidden(state).some((r) => r.from === 14));
  state = state.update({ selection: EditorSelection.single(0, 27) }).state;
  assert.deepEqual([...activeLines(state)], [1, 2, 3]);
  assert.ok(!hidden(state).some((r) => r.from < 27));
  assert.equal(state.doc.toString(), text);
});
test('bezier anchors stay finite and move continuously across a corner', () => {
  const a = { x: 0, y: 0, width: 200, height: 200 };
  const parse = (d: string) => d.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/g)!.map(Number);
  const before = parse(connectionPath(a, { x: 400, y: 399.99, width: 200, height: 200 }));
  const after = parse(connectionPath(a, { x: 400, y: 400.01, width: 200, height: 200 }));
  assert.ok(before.every(Number.isFinite));
  assert.ok(after.every((n, i) => Math.abs(n - before[i]) < 1));
});
