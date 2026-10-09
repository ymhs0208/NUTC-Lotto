import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalPageUrl, getViewFromLocation, viewPath } from '../src/lib/routes';

const location = (url: string) => new URL(url, 'https://example.test');

test('home remains at root and staff routes have clean canonical URLs', () => {
  for (const [url, view, canonical] of [
    ['/', 'student', '/'], ['/student', 'student', '/'], ['/admin', 'admin', '/admin'], ['/stage', 'stage', '/stage'], ['/results', 'results', '/results'], ['/accounts', 'accounts', '/accounts'], ['/ACCOUNTS/', 'accounts', '/accounts'],
    ['/ADMIN/', 'admin', '/admin'], ['/manage', 'admin', '/admin'], ['/lottery', 'stage', '/stage'], ['/inquiry', 'student', '/'],
  ]) {
    assert.equal(getViewFromLocation(location(url)), view);
    assert.equal(canonicalPageUrl(location(url)), canonical);
  }
  assert.equal(viewPath('student'), '/');
});

test('legacy route selectors normalize without overriding explicit paths or removing unrelated anchors', () => {
  for (const [url, view, canonical] of [
    ['/?view=admin&lang=zh', 'admin', '/admin?lang=zh'], ['/#/stage', 'stage', '/stage'], ['/student#/student', 'student', '/'],
    ['/admin#/admin', 'admin', '/admin'], ['/admin?view=stage#/student', 'admin', '/admin'],
    ['/#main-content', 'student', '/#main-content'], ['/stage#main-content', 'stage', '/stage#main-content'],
    ['/stage?lang=zh', 'stage', '/stage?lang=zh'],
  ]) {
    assert.equal(getViewFromLocation(location(url)), view);
    assert.equal(canonicalPageUrl(location(url)), canonical);
  }
});

test('route detection uses exact names rather than arbitrary substrings or inherited keys', () => {
  for (const url of ['/administrator', '/archive/admin', '/admin-settings', '/constructor', '/?view=toString', '/#admin-help']) {
    assert.equal(getViewFromLocation(location(url)), 'student');
  }
});
