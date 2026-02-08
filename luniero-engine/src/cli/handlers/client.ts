import crypto from 'crypto';
import { HandlerContext, HandlerResult } from '../router';
import { withClient, withLastHandler } from '../session';
import { formatError, formatSuccess, formatInfo, formatClientInfo, formatClientTable, ClientTableRow, colors } from '../formatter';
import { promptForMissing, promptForInput } from '../utils/prompts';
import { clientStore } from '../../memory/client-store';
import { stateStore } from '../../core/state-store';

function generateClientId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export async function handleClient(ctx: HandlerContext): Promise<HandlerResult> {
  const { session, parsed, rl, output } = ctx;
  const sub = parsed.subcommand.toLowerCase();

  switch (sub) {
    case 'list':
      return await listClients(ctx);
    case 'switch':
      return await switchClient(ctx);
    case 'base':
      return await switchToBase(ctx);
    case 'new':
    case 'create':
      return await createClient(ctx);
    case 'voice':
      if (parsed.args[0] === 'set') return await setBrandVoice(ctx);
      return await showBrandVoice(ctx);
    case 'pillars':
      if (parsed.args[0] === 'set') return await setContentPillars(ctx);
      if (parsed.args[0] === 'add') return await addContentPillar(ctx);
      if (parsed.args[0] === 'remove' || parsed.args[0] === 'delete') return await removeContentPillar(ctx);
      return await showContentPillars(ctx);
    case 'info':
    case '':
      return await showClientInfo(ctx);
    default:
      output(formatError(`Unknown subcommand: ${sub}. Use: list, switch, base, new, voice, pillars, info`));
      return { session: withLastHandler(session, '/client') };
  }
}

async function listClients(ctx: HandlerContext): Promise<HandlerResult> {
  const { session, parsed, output } = ctx;

  const allProfiles = await clientStore.getAllClients();
  if (allProfiles.length === 0) {
    output(formatInfo('No clients found. Use /client new to create one.'));
    return { session: withLastHandler(session, '/client') };
  }

  // Filter by --industry flag
  const industryFilter = parsed.flags.industry as string | undefined;
  // Filter by search term (first arg after "list")
  const searchTerm = parsed.args[0]?.toLowerCase();

  let filtered = allProfiles;

  if (industryFilter) {
    const lower = industryFilter.toLowerCase();
    filtered = filtered.filter(p => p.industry.toLowerCase().includes(lower));
  }

  if (searchTerm) {
    filtered = filtered.filter(p =>
      p.id.toLowerCase().includes(searchTerm) ||
      p.name.toLowerCase().includes(searchTerm) ||
      p.industry.toLowerCase().includes(searchTerm),
    );
  }

  if (filtered.length === 0) {
    const hint = industryFilter ? ` in industry "${industryFilter}"` : ` matching "${searchTerm}"`;
    output(formatInfo(`No clients found${hint}.`));
    return { session: withLastHandler(session, '/client') };
  }

  // Load job counts in parallel
  const jobResults = await Promise.all(
    filtered.map(p => stateStore.getJobsByClient(p.id, 50).catch(() => [])),
  );

  const rows: ClientTableRow[] = filtered.map((p, i) => {
    const jobs = jobResults[i];
    const lastJob = jobs[0]; // sorted by createdAt desc
    return {
      id: p.id,
      name: p.name,
      industry: p.industry,
      platforms: p.platforms?.map(pl => pl.platform || String(pl)) || [],
      jobCount: jobs.length,
      lastActivity: lastJob?.createdAt || null,
      isActive: session.activeClientId === p.id,
    };
  });

  output(formatClientTable(rows));

  if (industryFilter || searchTerm) {
    output(colors.dim(`  Showing ${filtered.length} of ${allProfiles.length} clients`));
  }
  output(colors.dim('  Use /client switch <id> to select a client'));

  return { session: withLastHandler(session, '/client') };
}

async function switchToBase(ctx: HandlerContext): Promise<HandlerResult> {
  const { session, output } = ctx;
  output(formatSuccess('Switched to base (no active client).'));
  let newSession = withClient(session, null);
  newSession = withLastHandler(newSession, '/client');
  return { session: newSession };
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
  const [name, industry] = parsed.args;

  const resolvedName = await promptForMissing(rl, 'Client name', name);
  const resolvedIndustry = await promptForMissing(rl, 'Industry', industry || undefined);

  if (!resolvedName) {
    output(formatError('Client name is required.'));
    return { session };
  }

  // Auto-generate ID from name
  let clientId = generateClientId(resolvedName);
  if (await clientStore.getProfile(clientId)) {
    const suffix = crypto.randomUUID().substring(0, 4);
    clientId = `${clientId}-${suffix}`;
  }

  await clientStore.saveProfile(clientId, {
    id: clientId,
    name: resolvedName,
    industry: resolvedIndustry || 'general',
    description: '',
    goals: [],
    platforms: [],
    contacts: [],
    preferences: { contentPillars: [] },
  });

  // Seed the vector space with initial client context
  await clientStore.storeClientContext(clientId, {
    type: 'preference',
    text: `Client "${resolvedName}" operates in the ${resolvedIndustry || 'general'} industry.`,
    metadata: { source: 'profile_creation' },
  });

  output(formatSuccess(`Client "${resolvedName}" created with ID: ${clientId}`));
  let newSession = withClient(session, clientId);
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

async function setBrandVoice(ctx: HandlerContext): Promise<HandlerResult> {
  const { session, rl, output } = ctx;
  if (!session.activeClientId) {
    output(formatError('No active client. Use /client switch first.'));
    return { session };
  }

  const tone = await promptForInput(rl, 'Brand voice tone (e.g. professional, casual, witty): ');
  const avoidRaw = await promptForInput(rl, 'Words/phrases to avoid (comma-separated): ');
  const vocabRaw = await promptForInput(rl, 'Key vocabulary (comma-separated): ');

  if (!tone) {
    output(formatError('Tone is required.'));
    return { session: withLastHandler(session, '/client') };
  }

  const voice = {
    tone,
    avoid: avoidRaw ? avoidRaw.split(',').map(s => s.trim()).filter(Boolean) : [],
    examples: [],
    vocabulary: vocabRaw ? vocabRaw.split(',').map(s => s.trim()).filter(Boolean) : [],
  };

  await clientStore.saveBrandVoice(session.activeClientId, voice);
  output(formatSuccess('Brand voice saved and vectorized.'));
  return { session: withLastHandler(session, '/client') };
}

async function setContentPillars(ctx: HandlerContext): Promise<HandlerResult> {
  const { session, rl, output } = ctx;
  if (!session.activeClientId) {
    output(formatError('No active client. Use /client switch first.'));
    return { session };
  }

  const pillarsRaw = await promptForInput(rl, 'Content pillars (comma-separated): ');

  if (!pillarsRaw) {
    output(formatError('At least one content pillar is required.'));
    return { session: withLastHandler(session, '/client') };
  }

  const pillars = pillarsRaw.split(',').map(s => s.trim()).filter(Boolean);
  await clientStore.saveContentPillars(session.activeClientId, pillars);
  output(formatSuccess(`${pillars.length} content pillar(s) saved and vectorized.`));
  return { session: withLastHandler(session, '/client') };
}

async function addContentPillar(ctx: HandlerContext): Promise<HandlerResult> {
  const { session, parsed, rl, output } = ctx;
  if (!session.activeClientId) {
    output(formatError('No active client. Use /client switch first.'));
    return { session };
  }

  // Pillar text comes from args after "add"
  const pillarText = parsed.args.slice(1).join(' ').trim();
  const resolved = pillarText || await promptForInput(rl, 'Pillar to add: ');

  if (!resolved) {
    output(formatError('Pillar text is required.'));
    return { session: withLastHandler(session, '/client') };
  }

  const existing = await clientStore.getContentPillars(session.activeClientId);
  if (existing.includes(resolved)) {
    output(formatInfo(`Pillar "${resolved}" already exists.`));
    return { session: withLastHandler(session, '/client') };
  }

  const updated = [...existing, resolved];
  await clientStore.saveContentPillars(session.activeClientId, updated);
  output(formatSuccess(`Added pillar: "${resolved}" (${updated.length} total)`));
  return { session: withLastHandler(session, '/client') };
}

async function removeContentPillar(ctx: HandlerContext): Promise<HandlerResult> {
  const { session, parsed, rl, output } = ctx;
  if (!session.activeClientId) {
    output(formatError('No active client. Use /client switch first.'));
    return { session };
  }

  const pillarText = parsed.args.slice(1).join(' ').trim();
  const resolved = pillarText || await promptForInput(rl, 'Pillar to remove: ');

  if (!resolved) {
    output(formatError('Pillar text is required.'));
    return { session: withLastHandler(session, '/client') };
  }

  const existing = await clientStore.getContentPillars(session.activeClientId);
  const lower = resolved.toLowerCase();
  const updated = existing.filter(p => p.toLowerCase() !== lower);

  if (updated.length === existing.length) {
    output(formatError(`Pillar "${resolved}" not found.`));
    return { session: withLastHandler(session, '/client') };
  }

  await clientStore.saveContentPillars(session.activeClientId, updated);
  output(formatSuccess(`Removed pillar: "${resolved}" (${updated.length} remaining)`));
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
