import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  parseUIElements,
  findElements,
  generateSummary,
} from '../dist/ui-parser.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dirname, 'fixtures', 'sample-ui.xml');

async function loadFixture() {
  return readFile(fixturePath, 'utf8');
}

test('parseUIElements extracts fields and decodes entities', async () => {
  const xml = await loadFixture();
  const elements = parseUIElements(xml);
  assert.equal(elements.length, 3);

  const first = elements[0];
  assert.equal(first.text, 'Hello & World');
  assert.equal(first.resourceId, 'com.app:id/title');
  assert.equal(first.class, 'android.widget.TextView');
  assert.equal(first.contentDesc, 'Greeting');
  assert.deepEqual(first.bounds, { x1: 10, y1: 20, x2: 110, y2: 220 });
  assert.deepEqual(first.center, { x: 60, y: 120 });

  const second = elements[1];
  assert.equal(second.text, 'Line 1\nLine 2');

  const third = elements[2];
  assert.equal(third.checkable, true);
  assert.equal(third.checked, true);
  assert.equal(third.clickable, true);
  assert.equal(third.enabled, false);
  assert.equal(third.selected, true);
});

test('findElements supports exact, contains, and resourceId filters', async () => {
  const xml = await loadFixture();
  const elements = parseUIElements(xml);

  assert.equal(findElements(elements, { text: 'Hello & World' }).length, 1);
  assert.equal(findElements(elements, { textContains: 'Hello' }).length, 1);
  assert.equal(
    findElements(elements, { resourceIdContains: 'button' }).length,
    1
  );
  assert.equal(
    findElements(elements, { contentDescContains: 'OK' }).length,
    1
  );
});

test('findElements supports normalization and case-insensitive matching', async () => {
  const xml = await loadFixture();
  const elements = parseUIElements(xml);

  const normalized = findElements(elements, {
    textContains: 'line 1 line 2',
    normalizeWhitespace: true,
    caseInsensitive: true,
  });

  assert.equal(normalized.length, 1);
});

test('generateSummary reports interactive elements', async () => {
  const xml = await loadFixture();
  const elements = parseUIElements(xml);
  const summary = generateSummary(elements);

  assert.match(summary, /Found 3 elements \(2 interactive\)/);
  assert.match(summary, /Hello & World|OK/);
});

test('parseUIElements handles missing index and invalid bounds', () => {
  const xml =
    '<hierarchy>' +
    '<node text="First" bounds="[0,0][1,1]" />' +
    '<node text="Second" bounds="[x,y][z,w]" />' +
    '</hierarchy>';
  const elements = parseUIElements(xml);

  assert.equal(elements[0].index, 0);
  assert.equal(elements[1].index, 1);
  assert.deepEqual(elements[0].center, { x: 1, y: 1 });
  assert.deepEqual(elements[1].bounds, { x1: 0, y1: 0, x2: 0, y2: 0 });
});

test('parseUIElements decodes numeric entities', () => {
  const xml =
    '<hierarchy>' +
    '<node text="A&#x41;&#65;" bounds="[0,0][2,2]" />' +
    '</hierarchy>';
  const elements = parseUIElements(xml);

  assert.equal(elements[0].text, 'AAA');
});

test('findElements supports class/resourceId filters and flags', async () => {
  const xml = await loadFixture();
  const elements = parseUIElements(xml);

  assert.equal(
    findElements(elements, {
      class: 'ANDROID.WIDGET.TEXTVIEW',
      caseInsensitive: true,
    }).length,
    2
  );
  assert.equal(
    findElements(elements, {
      resourceId: 'COM.APP:ID/TITLE',
      caseInsensitive: true,
    }).length,
    1
  );
  assert.equal(findElements(elements, { checkable: true }).length, 1);
  assert.equal(findElements(elements, { clickable: true }).length, 2);
});

test('findElements supports content-desc filters', async () => {
  const xml = await loadFixture();
  const elements = parseUIElements(xml);

  assert.equal(findElements(elements, { contentDesc: 'Greeting' }).length, 1);
  assert.equal(
    findElements(elements, {
      contentDescContains: 'greet',
      caseInsensitive: true,
    }).length,
    1
  );
});

test('generateSummary handles empty list', () => {
  assert.equal(generateSummary([]), 'No UI elements found.');
});
