import { HandlerContext, HandlerResult } from '../router';
import { withLastHandler } from '../session';
import { formatError, formatInfo, formatSuccess, colors } from '../formatter';
import { promptForInput } from '../utils/prompts';
import { loadCustomCommands, saveCustomCommand, deleteCustomCommand } from '../custom-commands';

export async function handleCommand(ctx: HandlerContext): Promise<HandlerResult> {
  const { session, parsed, rl, output } = ctx;
  const sub = parsed.subcommand?.toLowerCase() || '';

  if (sub === 'new') {
    const name = parsed.args[0];
    if (!name) {
      output(formatError('Name is required. Usage: /command new <name>'));
      return { session: withLastHandler(session, '/command') };
    }

    const cleanName = name.startsWith('/') ? name.slice(1) : name;

    output(formatInfo(`Creating command /${cleanName}. Enter the prompt template (use $ARGUMENTS for user input).`));
    output(formatInfo('Type END on a new line to finish.'));

    const lines: string[] = [];
    while (true) {
      const line = await promptForInput(rl, '  > ');
      if (line === 'END') break;
      lines.push(line);
    }

    if (lines.length === 0) {
      output(formatError('No template provided. Command not created.'));
      return { session: withLastHandler(session, '/command') };
    }

    const template = lines.join('\n');
    const filePath = saveCustomCommand(cleanName, template);
    output(formatSuccess(`Command /${cleanName} created and ready to use.`));
    output(formatInfo(`Saved to: ${filePath}`));

    return { session: withLastHandler(session, '/command') };
  }

  if (sub === 'list') {
    const commands = loadCustomCommands();
    if (commands.size === 0) {
      output(formatInfo('No custom commands found.'));
      output(formatInfo('Create one with: /command new <name>'));
    } else {
      output(colors.bold(colors.cyan('\n  Custom Commands\n')));
      for (const [cmdName, cmd] of commands) {
        const preview = cmd.promptTemplate.split('\n')[0].substring(0, 60);
        output(`  ${colors.green(cmdName)}  ${colors.dim(preview)}`);
      }
      output('');
    }
    return { session: withLastHandler(session, '/command') };
  }

  if (sub === 'delete') {
    const name = parsed.args[0];
    if (!name) {
      output(formatError('Name is required. Usage: /command delete <name>'));
      return { session: withLastHandler(session, '/command') };
    }

    const deleted = deleteCustomCommand(name);
    if (deleted) {
      output(formatSuccess(`Command /${name.startsWith('/') ? name.slice(1) : name} deleted.`));
    } else {
      output(formatError(`Command "${name}" not found.`));
    }

    return { session: withLastHandler(session, '/command') };
  }

  // Default: show help
  output(formatInfo('Manage custom commands.'));
  output(formatInfo('Usage:'));
  output(formatInfo('  /command new <name>     Create a new custom command'));
  output(formatInfo('  /command list           List all custom commands'));
  output(formatInfo('  /command delete <name>  Delete a custom command'));

  return { session: withLastHandler(session, '/command') };
}
