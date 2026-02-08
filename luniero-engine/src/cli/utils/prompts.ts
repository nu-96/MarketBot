import * as readline from 'readline';

export async function promptForInput(
  rl: readline.Interface,
  question: string,
): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

export async function promptForChoice(
  rl: readline.Interface,
  question: string,
  choices: string[],
): Promise<string> {
  const numbered = choices.map((c, i) => `  ${i + 1}. ${c}`).join('\n');
  const prompt = `${question}\n${numbered}\n> `;

  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      const trimmed = answer.trim();
      const idx = parseInt(trimmed, 10);
      if (idx >= 1 && idx <= choices.length) {
        resolve(choices[idx - 1]);
      } else {
        // Check if they typed the choice text directly
        const match = choices.find(c => c.toLowerCase() === trimmed.toLowerCase());
        resolve(match || trimmed);
      }
    });
  });
}

export async function promptForConfirm(
  rl: readline.Interface,
  question: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    rl.question(`${question} (y/n) `, (answer) => {
      resolve(answer.trim().toLowerCase().startsWith('y'));
    });
  });
}

export async function promptForMissing(
  rl: readline.Interface,
  label: string,
  current: string | undefined,
): Promise<string> {
  if (current) return current;
  return promptForInput(rl, `${label}: `);
}

export async function promptForClient(
  rl: readline.Interface,
  currentClientId: string | null,
): Promise<string | null> {
  if (currentClientId) return currentClientId;
  const answer = await promptForInput(rl, 'No active client. Enter client ID (or press Enter to cancel): ');
  return answer || null;
}
