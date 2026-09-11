import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogMatch, searchText } from '../web/custom-sector-tracker-model.js';

test('picker matching ignores stockdb display whitespace in names', () => {
  const item = { code: '000061', name: '农 产 品' };
  assert.equal(searchText(item.name), searchText('农产品'));
  assert.equal(catalogMatch([item], '农产品'), item);
  assert.equal(catalogMatch([item], '000061'), item);
});
