import { hashPassword } from '../server/credentials';
async function readPassword(): Promise<string> {
  if (!process.stdin.isTTY) {
    let input = ''; for await (const chunk of process.stdin) input += chunk;
    return input.replace(/\r?\n$/, '');
  }
  process.stderr.write('管理員密碼（至少 12 字元，輸入不顯示）：');
  process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    let password = '';
    const finish = () => { process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.off('data', receive); process.stderr.write('\n'); };
    const receive = (chunk: string) => {
      for (const character of chunk) {
        if (character === '\u0003') { finish(); reject(new Error('已取消')); return; }
        if (character === '\r' || character === '\n') { finish(); resolve(password); return; }
        if (character === '\u007f' || character === '\b') password = password.slice(0, -1);
        else if (character >= ' ') password += character;
      }
    };
    process.stdin.on('data', receive);
  });
}
const password = await readPassword();
if (password.trim().length < 12 || password.length > 128) throw new Error('密碼須為 12 至 128 字元。');
console.log(await hashPassword(password));
