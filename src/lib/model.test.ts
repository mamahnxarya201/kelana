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
import { titleFromMarkdown } from './markdown';
import {
  connectionPath,
  connectionPoint,
  nearestConnectionSide,
  defaultBezierConfig,
} from './connections';
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
test('Markdown titles preserve the existing card naming contract', () => {
  assert.equal(titleFromMarkdown(''), 'Untitled');
  assert.equal(titleFromMarkdown('\n\n## Heading\nBody'), 'Heading');
  assert.equal(titleFromMarkdown('Plain paragraph\nBody'), 'Plain paragraph');
  assert.equal(titleFromMarkdown('a'.repeat(100)), 'a'.repeat(90));
});
test('connections use fixed card-side anchors and settled curve values', () => {
  assert.deepEqual(defaultBezierConfig, {
    curvature: 0.35,
    minControlDistance: 40,
    maxControlDistance: 150,
    sourcePull: 1.35,
    targetPull: 1.65,
  });
  const a = { x: 10, y: 20, width: 200, height: 100 };
  assert.deepEqual(connectionPoint(a, 'top'), { x: 110, y: 20 });
  assert.deepEqual(connectionPoint(a, 'right'), { x: 210, y: 70 });
  assert.deepEqual(connectionPoint(a, 'bottom'), { x: 110, y: 120 });
  assert.deepEqual(connectionPoint(a, 'left'), { x: 10, y: 70 });
  assert.equal(nearestConnectionSide(a, { x: 108, y: 24 }), 'top');
  assert.equal(nearestConnectionSide(a, { x: 205, y: 80 }), 'right');
  const target = { x: 400, y: 200, width: 100, height: 100 };
  assert.match(connectionPath(a, target, 'right', 'left'), /^M210 70 C/);
});
