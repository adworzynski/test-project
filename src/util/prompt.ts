import readline from 'node:readline/promises';

export function interactive(): boolean {
  return !!process.stdin.isTTY && !!process.stdout.isTTY && !process.env.CI;
}

export async function ask(question: string, def?: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const a = (await rl.question(`${question}${def ? ` [${def}]` : ''} `)).trim();
    return a || def || '';
  } finally {
    rl.close();
  }
}

export async function confirm(question: string, def = false): Promise<boolean> {
  const a = (await ask(`${question} ${def ? '(Y/n)' : '(y/N)'}`)).toLowerCase();
  if (!a) return def;
  return a.startsWith('y');
}
