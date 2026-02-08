import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import Anthropic from '@anthropic-ai/sdk';
import { CommandHandler, HandlerContext, HandlerResult } from './router';
import { withLastHandler } from './session';
import { formatError, formatContent, formatTaskComplete, withSpinner } from './formatter';
import { promptForClient } from './utils/prompts';
import { clientStore } from '../memory/client-store';
import { config } from '../config';

export interface CustomCommand {
  name: string;
  promptTemplate: string;
  filePath: string;
}

export function getCommandsDir(): string {
  return path.join(os.homedir(), '.luniero', 'commands');
}

export function ensureCommandsDir(): void {
  const dir = getCommandsDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function loadCustomCommands(): Map<string, CustomCommand> {
  const dir = getCommandsDir();
  const commands = new Map<string, CustomCommand>();

  if (!fs.existsSync(dir)) {
    return commands;
  }

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
  for (const file of files) {
    const name = `/${file.replace(/\.md$/, '')}`;
    const filePath = path.join(dir, file);
    const promptTemplate = fs.readFileSync(filePath, 'utf-8').trim();
    commands.set(name, { name, promptTemplate, filePath });
  }

  return commands;
}

export function saveCustomCommand(name: string, template: string): string {
  ensureCommandsDir();
  const cleanName = name.startsWith('/') ? name.slice(1) : name;
  const filePath = path.join(getCommandsDir(), `${cleanName}.md`);
  fs.writeFileSync(filePath, template, 'utf-8');
  return filePath;
}

export function deleteCustomCommand(name: string): boolean {
  const cleanName = name.startsWith('/') ? name.slice(1) : name;
  const filePath = path.join(getCommandsDir(), `${cleanName}.md`);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return true;
  }
  return false;
}

export function createCustomHandler(promptTemplate: string): CommandHandler {
  return async (ctx: HandlerContext): Promise<HandlerResult> => {
    const { session, parsed, rl, output } = ctx;

    const clientId = await promptForClient(rl, session.activeClientId);
    if (!clientId) {
      output(formatError('A client is required.'));
      return { session };
    }

    const args = parsed.rawInput.replace(/^\/\S+\s*/, '').trim() || 'general';
    const expandedPrompt = promptTemplate.replace(/\$ARGUMENTS/g, args);

    const text = await withSpinner('Running custom command...', async () => {
      const [profile, brandVoice] = await Promise.all([
        clientStore.getProfile(clientId),
        clientStore.getBrandVoice(clientId),
      ]);

      const systemPrompt = [
        'You are a marketing content assistant.',
        profile ? `Client: ${profile.name} (${profile.industry})` : '',
        brandVoice ? `Tone: ${brandVoice.tone}. Avoid: ${brandVoice.avoid.join(', ')}` : '',
      ].filter(Boolean).join('\n');

      const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 120_000);
      let response;
      try {
        response = await anthropic.messages.create(
          {
            model: 'claude-sonnet-4-20250514',
            max_tokens: 2048,
            system: systemPrompt,
            messages: [{ role: 'user', content: expandedPrompt }],
          },
          { signal: controller.signal },
        );
      } finally {
        clearTimeout(timer);
      }

      return response.content.find(b => b.type === 'text')?.text || '';
    });

    output(formatContent(text, 'Custom Command'));
    output(formatTaskComplete());

    return { session: withLastHandler(session, parsed.command) };
  };
}
