import test from 'node:test';
import assert from 'node:assert/strict';
import { auditQuery } from '../server/audit';
import { hasPermissionForView } from '../src/lib/auth';
import { getViewFromLocation } from '../src/lib/routes';
import { sessionScopeForPath } from '../server/sessionSecurity';
test('audit filters are bounded, wildcard search is literal and cursors cannot inject query syntax', () => {
  const now = Date.parse('2026-10-04T00:00:00Z');
  const filter = auditQuery({ q:'a_%\\', action:'draw', role:'stage', before:'12' }, now);
  assert.equal(filter.q,'a\\_\\%\\\\');
  assert.equal(filter.to,new Date(now).toISOString());
  for (const query of [{q:'x'.repeat(129)},{q:'\0'},{q:['a','b']},{action:'constructor'},{role:'student'},{before:'1,or(id.gt.0)'},{before:'0'}, {from:'invalid'}, {from:'2027-01-01',to:'2026-01-01'}, {from:'2020-01-01',to:'2026-01-01'}]) {
    assert.throws(()=>auditQuery(query,now),(e:any)=>e.status===400);
  }
});
test('audit route is admin-only and shares authenticated session request limits', () => {
  assert.equal(hasPermissionForView('admin','audit'),true);
  assert.equal(hasPermissionForView('stage','audit'),false);
  assert.equal(hasPermissionForView(null,'audit'),false);
  assert.equal(getViewFromLocation({pathname:'/audit',search:'',hash:''}),'audit');
  assert.equal(sessionScopeForPath('/STAFF-AUDIT/'),'staff');
});
