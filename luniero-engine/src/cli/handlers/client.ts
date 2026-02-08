import { HandlerContext, HandlerResult } from '../router';
import { withClient, withLastHandler } from '../session';
import { formatError, formatSuccess, formatInfo, formatClientInfo, colors } from '../formatter';
import { promptForMissing } from '../utils/prompts';
import { clientStore } from '../../memory/client-store';

export async function handleClient(ctx: HandlerContext): Promise<HandlerResult> {
  const { session, parsed, rl, output } = ctx;
  const sub = parsed.subcommand.toLowerCase();

  switch (sub) {
    case 'list':
      return await listClients(ctx);
    case 'switch':
      return await switchClient(ctx);
    case 'new':
    case 'create':
      return await createClient(ctx);
    case 'voice':
      return await showBrandVoice(ctx);
    case 'pillars':
      return await showContentPillars(ctx);
    case 'info':
    case '':
      return await showClientInfo(ctx);
    default:
      output(formatError(`Unknown subcommand: ${sub}. Use: list, switch, new, voice, pillars, info`));
      return { session: withLastHandler(session, '/client') };
  }
}

async function listClients(ctx: HandlerContext): Promise<HandlerResult> {
  const { session, output } = ctx;
  // List directories in memory/clients
  try {
    const fs = await import('fs');
    const path = await import('path');
    const clientsDir = path.join(__dirname, '../../../memory/clients');
    if (!fs.existsSync(clientsDir)) {
      output(formatInfo('No clients found.'));
      return { session: withLastHandler(session, '/client') };
    }
    const dirs = fs.readdirSync(clientsDir).filter(d => {
      return fs.existsSync(path.join(clientsDir, d, 'profile.json'));
    });
    if (dirs.length === 0) {
      output(formatInfo('No clients found.'));
    } else {
      output(colors.bold('\n  Clients:'));
      for (const dir of dirs) {
        const profile = await clientStore.getProfile(dir);
        const active = session.activeClientId === dir ? colors.green(' (active)') : '';
        output(`  ${colors.cyan(dir)} - ${profile?.name || 'Unknown'}${active}`);
      }
      output('');
    }
  } catch {
    output(formatInfo('No clients found.'));
  }
  return { session: withLastHandler(session, '/client') };
}

async function switchClient(ctx: HandlerContext): Promise<HandlerResult> {
  const { session, parsed, rl, output } = ctx;
  const clientId = await promptForMissing(rl, 'Client ID', parsed.args[0]);
  if (!clientId) {
    output(formatError('Client ID is required.'));
    return { session };
  }

  const profile = await clientStore.getProfile(clientId);
  if (!profile) {
    output(formatError(`Client "${clientId}" not found. Use /client new to create.`));
    return { session: withLastHandler(session, '/client') };
  }

  output(formatSuccess(`Switched to client: ${profile.name} (${clientId})`));
  let newSession = withClient(session, clientId);
  newSession = withLastHandler(newSession, '/client');
  return { session: newSession };
}

async function createClient(ctx: HandlerContext): Promise<HandlerResult> {
  const { session, parsed, rl, output } = ctx;
  const [clientId, name, industry] = parsed.args;

  const resolvedId = await promptForMissing(rl, 'Client ID', clientId);
  const resolvedName = await promptForMissing(rl, 'Client name', name);
  const resolvedIndustry = await promptForMissing(rl, 'Industry', industry || undefined);

  if (!resolvedId || !resolvedName) {
    output(formatError('Client ID and name are required.'));
    return { session };
  }

  await clientStore.saveProfile(resolvedId, {
    id: resolvedId,
    name: resolvedName,
    industry: resolvedIndustry || 'general',
    description: '',
    goals: [],
    platforms: [],
    contacts: [],
    preferences: { contentPillars: [] },
  });

  output(formatSuccess(`Client "${resolvedName}" (${resolvedId}) created.`));
  let newSession = withClient(session, resolvedId);
  newSession = withLastHandler(newSession, '/client');
  return { session: newSession };
}

async function showBrandVoice(ctx: HandlerContext): Promise<HandlerResult> {
  const { session, output } = ctx;
  if (!session.activeClientId) {
    output(formatError('No active client. Use /client switch first.'));
    return { session };
  }

  const voice = await clientStore.getBrandVoice(session.activeClientId);
  if (!voice) {
    output(formatInfo('No brand voice defined for this client.'));
  } else {
    output([
      '',
      colors.bold(colors.cyan('  Brand Voice')),
      `  ${colors.bold('Tone:')}    ${voice.tone}`,
      `  ${colors.bold('Avoid:')}   ${voice.avoid.join(', ')}`,
      `  ${colors.bold('Vocab:')}   ${voice.vocabulary?.join(', ') || 'N/A'}`,
      '',
    ].join('\n'));
  }
  return { session: withLastHandler(session, '/client') };
}

async function showContentPillars(ctx: HandlerContext): Promise<HandlerResult> {
  const { session, output } = ctx;
  if (!session.activeClientId) {
    output(formatError('No active client. Use /client switch first.'));
    return { session };
  }

  const pillars = await clientStore.getContentPillars(session.activeClientId);
  if (pillars.length === 0) {
    output(formatInfo('No content pillars defined.'));
  } else {
    output(colors.bold('\n  Content Pillars:'));
    pillars.forEach((p, i) => output(`  ${i + 1}. ${p}`));
    output('');
  }
  return { session: withLastHandler(session, '/client') };
}

async function showClientInfo(ctx: HandlerContext): Promise<HandlerResult> {
  const { session, parsed, rl, output } = ctx;
  const clientId = parsed.args[0] || session.activeClientId;
  if (!clientId) {
    output(formatError('No active client. Use /client switch or specify a client ID.'));
    return { session };
  }

  const profile = await clientStore.getProfile(clientId);
  if (!profile) {
    output(formatError(`Client "${clientId}" not found.`));
    return { session: withLastHandler(session, '/client') };
  }

  output(formatClientInfo(profile));
  return { session: withLastHandler(session, '/client') };
}
