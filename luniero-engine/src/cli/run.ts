#!/usr/bin/env node
/**
 * Simplified one-shot CLI for common operations.
 * Usage:
 *   npx tsx src/cli/run.ts write <clientId> <topic> [--platform=linkedin] [--type=social_post]
 *   npx tsx src/cli/run.ts status <jobId>
 *   npx tsx src/cli/run.ts client new <id> <name> [industry]
 *   npx tsx src/cli/run.ts client list
 *   npx tsx src/cli/run.ts health
 */

import { v4 as uuidv4 } from 'uuid';
import { stateStore } from '../core/state-store';
import { clientStore } from '../memory/client-store';
import { runPipeline } from './pipeline';
import { logger } from '../utils/logger';
import { config } from '../config';

// Suppress verbose logging for CLI mode
logger.setLevel('error');

interface CLIArgs {
  command: string;
  args: string[];
  flags: Record<string, string>;
}

function parseArgs(argv: string[]): CLIArgs {
  const args: string[] = [];
  const flags: Record<string, string> = {};
  
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const [key, value] = arg.slice(2).split('=');
      flags[key] = value || 'true';
    } else if (arg.startsWith('-') && arg.length === 2) {
      flags[arg[1]] = argv[++i] || 'true';
    } else {
      args.push(arg);
    }
  }
  
  return {
    command: args[0] || 'help',
    args: args.slice(1),
    flags,
  };
}

function printHelp() {
  console.log(`
Luniero Marketing Agent CLI

USAGE:
  npx tsx src/cli/run.ts <command> [args] [flags]

COMMANDS:
  write <clientId> <topic>    Create content for a client
    --platform=<platform>     Target platform (linkedin, twitter, instagram, etc.)
    --type=<type>             Content type (social_post, blog_post, report, campaign)
    --tone=<tone>             Desired tone
    --instructions=<text>     Additional instructions

  status <jobId>              Check job status and output
  
  client new <id> <name>      Create a new client
    [industry]                Optional industry

  client list                 List all clients
  
  client info <id>            Show client details
  
  health                      Check system health (Redis, config)

  repl                        Start interactive mode

EXAMPLES:
  # Create a LinkedIn post
  npx tsx src/cli/run.ts write acme "AI trends in 2026" --platform=linkedin

  # Check job status
  npx tsx src/cli/run.ts status abc123

  # Create a new client
  npx tsx src/cli/run.ts client new acme "Acme Corp" "B2B SaaS"

  # Health check
  npx tsx src/cli/run.ts health
`);
}

async function checkHealth(): Promise<void> {
  console.log('🔍 Health Check\n');
  
  // Check config
  console.log('Configuration:');
  console.log(`  ✓ Anthropic API Key: ${config.anthropicApiKey ? '***configured***' : '❌ MISSING'}`);
  console.log(`  ✓ Redis URL: ${config.redisUrl}`);
  console.log(`  ✓ Mode: ${config.localMode ? 'Local (file-based)' : 'Supabase'}`);
  
  // Check Redis connection
  console.log('\nRedis:');
  try {
    const { createClient } = await import('redis');
    const client = createClient({ url: config.redisUrl });
    await client.connect();
    await client.ping();
    await client.quit();
    console.log('  ✓ Connection OK');
  } catch (err) {
    console.log(`  ❌ Connection failed: ${(err as Error).message}`);
    console.log('  💡 Start Redis: docker run -d --name luniero-redis -p 6379:6379 redis:alpine');
  }
  
  // Check data directories
  console.log('\nData directories:');
  const fs = await import('fs');
  const path = await import('path');
  
  const dataDir = path.join(__dirname, '../../data/jobs');
  const memoryDir = path.join(__dirname, '../../memory/clients');
  
  console.log(`  Jobs: ${fs.existsSync(dataDir) ? '✓ exists' : '○ will be created'}`);
  console.log(`  Clients: ${fs.existsSync(memoryDir) ? '✓ exists' : '○ will be created'}`);
  
  console.log('\n✅ Health check complete');
}

async function handleWrite(args: string[], flags: Record<string, string>): Promise<void> {
  const [clientId, ...topicParts] = args;
  const topic = topicParts.join(' ');
  
  if (!clientId || !topic) {
    console.error('❌ Usage: write <clientId> <topic>');
    console.error('   Example: write acme "AI trends in 2026"');
    process.exit(1);
  }
  
  // Check client exists
  const client = await clientStore.getProfile(clientId);
  if (!client) {
    console.error(`❌ Client "${clientId}" not found.`);
    console.error('   Create one first: client new <id> <name>');
    process.exit(1);
  }
  
  const type = (flags.type || 'social_post') as 'social_post' | 'blog_post' | 'report' | 'campaign';
  const platform = flags.platform;
  const tone = flags.tone;
  const instructions = flags.instructions;
  
  const jobId = uuidv4();
  
  console.log(`\n📝 Creating ${type} for "${topic}"`);
  console.log(`   Client: ${clientId}`);
  if (platform) console.log(`   Platform: ${platform}`);
  console.log(`   Job ID: ${jobId}\n`);
  
  await stateStore.createJob({
    id: jobId,
    clientId,
    type,
    status: 'received',
    input: {
      clientId,
      type,
      topic,
      platform,
      instructions: [tone ? `Tone: ${tone}` : '', instructions].filter(Boolean).join('. ') || undefined,
    },
    maxIterations: 3,
  });
  
  // Run pipeline with progress
  const stages = ['context_loading', 'briefing', 'drafting', 'polishing', 'reviewing'];
  let currentStage = '';
  
  try {
    const job = await runPipeline(jobId, {
      onStage: (status, label, output) => {
        if (status !== currentStage) {
          currentStage = status;
          const icon = stages.includes(status) ? '⏳' : status === 'human_review' ? '👀' : '✓';
          process.stdout.write(`${icon} ${label}\n`);
        }
        if (output) {
          console.log(output);
        }
      },
    });
    
    console.log('\n' + '─'.repeat(60));
    
    if (job.status === 'human_review' || job.status === 'complete') {
      console.log('\n✅ Content ready!\n');
      console.log('─'.repeat(60));
      console.log(job.polishedDraft?.content || job.draft?.content || 'No content generated');
      console.log('─'.repeat(60));
      
      if (job.review?.score) {
        console.log(`\n📊 Quality Score: ${job.review.score}/100`);
      }
      
      console.log(`\n💾 Job ID: ${jobId}`);
      console.log('   View later: status ' + jobId);
    } else {
      console.log(`\n⚠️ Job ended with status: ${job.status}`);
      if (job.error) console.log(`   Error: ${job.error}`);
    }
  } catch (err) {
    console.error(`\n❌ Pipeline failed: ${(err as Error).message}`);
    process.exit(1);
  }
}

async function handleStatus(args: string[]): Promise<void> {
  const [jobId] = args;
  
  if (!jobId) {
    console.error('❌ Usage: status <jobId>');
    process.exit(1);
  }
  
  const job = await stateStore.getJob(jobId);
  
  if (!job) {
    console.error(`❌ Job not found: ${jobId}`);
    process.exit(1);
  }
  
  console.log('\n📋 Job Status\n');
  console.log(`  ID: ${job.id}`);
  console.log(`  Client: ${job.clientId}`);
  console.log(`  Type: ${job.type}`);
  console.log(`  Status: ${job.status}`);
  console.log(`  Created: ${job.createdAt}`);
  if (job.completedAt) console.log(`  Completed: ${job.completedAt}`);
  if (job.iteration > 0) console.log(`  Iterations: ${job.iteration}`);
  if (job.review?.score) console.log(`  Score: ${job.review.score}/100`);
  
  if (job.polishedDraft?.content || job.draft?.content) {
    console.log('\n' + '─'.repeat(60));
    console.log('\n📄 Content:\n');
    console.log(job.polishedDraft?.content || job.draft?.content);
    console.log('\n' + '─'.repeat(60));
  }
  
  if (job.brief) {
    console.log('\n📋 Brief:');
    console.log(`  Title: ${job.brief.title}`);
    console.log(`  Type: ${job.brief.type}`);
    if (job.brief.keyMessages) {
      console.log('  Key Messages:');
      job.brief.keyMessages.forEach((m: string) => console.log(`    - ${m}`));
    }
  }
}

async function handleClient(args: string[], flags: Record<string, string>): Promise<void> {
  const [subcommand, ...rest] = args;
  
  switch (subcommand) {
    case 'new': {
      const [id, name, industry] = rest;
      if (!id || !name) {
        console.error('❌ Usage: client new <id> <name> [industry]');
        process.exit(1);
      }
      
      await clientStore.saveProfile(id, {
        id,
        name,
        industry: industry || 'General',
        createdAt: new Date().toISOString(),
      });
      
      // Initialize default brand voice
      await clientStore.saveBrandVoice(id, {
        tone: 'professional',
        personality: ['helpful', 'knowledgeable'],
        vocabulary: [],
        avoid: [],
        examples: [],
      });
      
      console.log(`✅ Client created: ${id}`);
      console.log(`   Name: ${name}`);
      console.log(`   Industry: ${industry || 'General'}`);
      break;
    }
    
    case 'list': {
      const clients = await clientStore.listClients();
      
      if (clients.length === 0) {
        console.log('No clients found. Create one: client new <id> <name>');
        return;
      }
      
      console.log('\n📋 Clients\n');
      for (const client of clients) {
        console.log(`  ${client.id} - ${client.name} (${client.industry || 'General'})`);
      }
      console.log('');
      break;
    }
    
    case 'info': {
      const [id] = rest;
      if (!id) {
        console.error('❌ Usage: client info <id>');
        process.exit(1);
      }
      
      const profile = await clientStore.getProfile(id);
      if (!profile) {
        console.error(`❌ Client not found: ${id}`);
        process.exit(1);
      }
      
      const brandVoice = await clientStore.getBrandVoice(id);
      const pillars = await clientStore.getContentPillars(id);
      
      console.log('\n📋 Client Info\n');
      console.log(`  ID: ${profile.id}`);
      console.log(`  Name: ${profile.name}`);
      console.log(`  Industry: ${profile.industry || 'General'}`);
      
      if (brandVoice) {
        console.log('\n  Brand Voice:');
        console.log(`    Tone: ${brandVoice.tone}`);
        if (brandVoice.personality?.length) console.log(`    Personality: ${brandVoice.personality.join(', ')}`);
        if (brandVoice.avoid?.length) console.log(`    Avoid: ${brandVoice.avoid.join(', ')}`);
      }
      
      if (pillars?.length) {
        console.log('\n  Content Pillars:');
        pillars.forEach((p: any) => console.log(`    - ${p.name}: ${p.description || ''}`));
      }
      break;
    }
    
    default:
      console.error('❌ Usage: client <new|list|info> [args]');
      process.exit(1);
  }
}

async function main() {
  const { command, args, flags } = parseArgs(process.argv);
  
  if (flags.help || flags.h) {
    printHelp();
    process.exit(0);
  }
  
  switch (command) {
    case 'help':
      printHelp();
      break;
      
    case 'health':
      await checkHealth();
      break;
      
    case 'write':
      await handleWrite(args, flags);
      break;
      
    case 'status':
      await handleStatus(args);
      break;
      
    case 'client':
      await handleClient(args, flags);
      break;
      
    case 'repl':
      // Import and start the full REPL
      const { startREPL } = await import('./index');
      await startREPL();
      break;
      
    default:
      console.error(`❌ Unknown command: ${command}`);
      console.error('   Run with --help for usage');
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`❌ Error: ${err.message}`);
  process.exit(1);
});
