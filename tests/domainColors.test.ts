import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDomainColor } from '../src/lib/domainColors';

test('carousel domains use distinct stable accents and neutral empty results', () => {
  const fields = ['企業智慧化', '嵌入式系統與行動計算', '智慧流通應用與研究', '智慧運算創新應用', '進修部', '網路應用與資通安全', '數位內容與多媒體應用'];
  assert.equal(new Set(fields.map(getDomainColor)).size, fields.length);
  assert.equal(getDomainColor(), '#d9e3ed');
  for (const field of [...fields, '自訂領域', 'constructor', '__proto__']) {
    assert.match(getDomainColor(field), /^#[a-f0-9]{6}$/);
    assert.equal(getDomainColor(field), getDomainColor(field));
  }
});
