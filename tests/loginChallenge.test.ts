import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { issueLoginChallenge, verifyLoginProof } from '../server/loginChallenge';
import { withRuntime } from '../server/runtime';
import { decideLoginBudgets, type LoginBucket } from '../server/loginBudgets';

export function proofFor(token: string) {
  for (let nonce = 0; ; nonce++) {
    const hash = createHash('sha256').update(`${token}:${nonce}`).digest();
    if (hash[0] === 0 && hash[1] === 0) return { token, nonce: String(nonce) };
  }
}
test('proof binds scope, account, IP and exact password; expired, forged and rotated-key proofs fail', () => {
  const env = { SESSION_SECRET: 'test-proof-secret' };
  const context = { scope: 'student', account: 'victim', ip: '203.0.113.1', password: 'correct-password' };
  withRuntime(env, () => {
    const challenge = issueLoginChallenge(context, 1000000);
    const proof = proofFor(challenge.token);
    assert.equal(verifyLoginProof(proof, context, 1000001), true);
    for (const field of ['scope','account','ip','password']) assert.equal(verifyLoginProof(proof, { ...context, [field]: 'different' }, 1000001), false);
    assert.equal(verifyLoginProof(proof, context, 1120000), false);
    assert.equal(verifyLoginProof({ ...proof, token: proof.token + '0' }, context, 1000001), false);
    assert.equal(verifyLoginProof({ ...proof, nonce: '-1' }, context, 1000001), false);
    withRuntime({ SESSION_SECRET: 'rotated-secret' }, () => assert.equal(verifyLoginProof(proof, context, 1000001), false));
  });
});
test('atomic budgets leave every counter unchanged when either budget rejects', () => {
  const budgets = [{ key: 'ip', limit: 2 }, { key: 'account', limit: 1 }];
  const stored = new Map<string, LoginBucket>([['ip',{count:1,resetAt:100}],['account',{count:1,resetAt:100}]]);
  const before = structuredClone(stored);
  assert.equal(decideLoginBudgets(budgets, stored, 1, 100, false).decision.challenge, true);
  assert.deepEqual(stored, before);
  const allowed = decideLoginBudgets(budgets, stored, 1, 100, true);
  assert.equal(allowed.decision.success, true);
  for (const [key, value] of allowed.updates!) stored.set(key,value);
  assert.equal(stored.get('account')!.count, 1);
  assert.equal(stored.get('ip')!.count, 2);
  assert.equal(decideLoginBudgets(budgets, stored, 1, 100, true).updates, undefined);
  assert.equal(decideLoginBudgets(budgets, stored, 101, 100, false).decision.success, true);
});
