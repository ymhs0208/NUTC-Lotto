export async function solveLoginChallenge(challenge: unknown, signal: AbortSignal) {
  const { token, bits } = (challenge || {}) as { token?: unknown; bits?: unknown };
  if (typeof token !== 'string' || token.length > 1024 || !/^[A-Za-z0-9_-]+\.[a-f0-9]{64}$/.test(token) || bits !== 16) throw new Error('Invalid login challenge');
  const encoder = new TextEncoder();
  for (let nonce = 0; nonce < 1048576; nonce++) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(`${token}:${nonce}`)));
    if (hash[0] === 0 && hash[1] === 0) return { token, nonce: String(nonce) };
  }
  throw new Error('Login challenge could not be completed');
}
