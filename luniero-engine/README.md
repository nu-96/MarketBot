# Luniero Marketing Agent

A multi-agent AI system for marketing agencies that creates content across platforms, generates reports, tracks competitors, and manages client workflows using distributed architecture with parallel processing.

## Architecture

```
                    ┌──────────┐
                    │  Router  │  (creates jobs, finalizes completion)
                    └────┬─────┘
                         │ job.created
                    ┌────▼─────┐
                    │ Context  │  (loads client profile & brand voice)
                    │  Agent   │
                    └────┬─────┘
                         │ context.loaded
                    ┌────▼─────┐
                    │  Brief   │  (creates structured content brief)
                    │  Agent   │
                    └────┬─────┘
                         │ brief.ready
                    ┌────▼─────┐
                    │  Draft   │  (writes first draft from brief)
                    │  Agent   │◄──── revision.requested
                    └────┬─────┘
                         │ draft.ready
                    ┌────▼─────┐
                    │  Polish  │  (refines voice, tone, readability)
                    │  Agent   │
                    └────┬─────┘
                         │ polish.done
                    ┌────▼─────┐
                    │  Review  │  (quality check & scoring)
                    │  Agent   │
                    └────┬─────┘
                    │           │
            review.passed  revision.requested (loops back to Draft)
                    │
               ┌────▼─────┐
               │ Complete  │
               └───────────┘
```

### Tech Stack

| Component     | Technology                        |
|---------------|-----------------------------------|
| Runtime       | Node.js + TypeScript              |
| AI            | Claude API (Anthropic)            |
| Message Bus   | Redis Streams                     |
| Database      | Supabase (Postgres + pgvector)    |
| API           | Hono (future)                     |
| UI            | Next.js (future)                  |

## Prerequisites

- **Node.js** >= 18
- **Docker** (for Redis) or Redis installed locally
- **Anthropic API Key** (for AI agents)
- **Supabase Project** (optional - local file mode available for development)

## Quick Start

### 1. Install Dependencies

```bash
cd luniero-engine
npm install
```

### 2. Start Redis

**Using Docker (recommended):**
```bash
docker run -d --name luniero-redis -p 6379:6379 redis:alpine
```

**Using Homebrew (macOS):**
```bash
brew install redis
brew services start redis
```

**Verify Redis is running:**
```bash
docker exec luniero-redis redis-cli ping
# Should output: PONG
```

### 3. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```env
ANTHROPIC_API_KEY=sk-ant-your-key-here
REDIS_URL=redis://localhost:6379
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-supabase-anon-key
PORT=3000
NODE_ENV=development
```

> **Local Mode:** If `SUPABASE_URL` is empty or contains "placeholder", the system automatically uses local file-based storage instead of Supabase. This is useful for development and testing.

### 4. Set Up Database (Supabase)

If using Supabase, run the SQL migrations in the Supabase SQL editor:

```bash
# The schema is in supabase-schema.sql
# Copy and paste its contents into your Supabase SQL editor
```

This creates 4 tables:
- `jobs` - Content generation job tracking
- `client_profiles` - Client information and preferences
- `brand_voices` - Brand tone, vocabulary, and style guides
- `content_feedback` - Historical feedback for learning

### 5. Start the Agent Engine

```bash
npm run dev
```

Expected output:
```
INFO  Using local file-based state store
INFO  Starting Luniero Marketing Agent...
INFO  Message bus connected
INFO  Router agent started
INFO  context-agent started, listening for: job.created
INFO  brief-agent started, listening for: context.loaded, research.done
INFO  draft-agent started, listening for: brief.ready, brief.approved, revision.requested
INFO  polish-agent started, listening for: draft.ready
INFO  review-agent started, listening for: polish.done
INFO  Luniero Marketing Agent is running! Press Ctrl+C to stop.
INFO  Consumer consumer-XXXXX starting...
```

### 6. Use the CLI (in a separate terminal)

**Create a client:**
```bash
npm run cli -- setup-client acme "Acme Corp" "B2B SaaS"
```

**Create a content job:**
```bash
npm run cli -- create-job acme social_post "AI trends in 2026" linkedin
```

**Check job status:**
```bash
npm run cli -- get-job <job-id>
```

## Project Structure

```
luniero-engine/
├── package.json
├── tsconfig.json
├── .env.example
├── .env                          # Your local config (gitignored)
├── supabase-schema.sql           # Database migration
│
├── src/
│   ├── index.ts                  # Entry point - starts all agents
│   ├── config.ts                 # Zod-validated configuration
│   │
│   ├── core/
│   │   ├── message-bus.ts        # Redis Streams pub/sub
│   │   ├── state-store.ts        # Job state (Supabase or local file)
│   │   ├── event-types.ts        # Event schemas (12 event types)
│   │   └── agent-base.ts         # Abstract base agent class
│   │
│   ├── agents/
│   │   ├── router.ts             # Routes incoming jobs
│   │   ├── context-agent.ts      # Client context loading
│   │   ├── brief-agent.ts        # Content brief creation
│   │   ├── draft-agent.ts        # First draft writing
│   │   ├── polish-agent.ts       # Voice/tone refinement
│   │   └── review-agent.ts       # Quality checking & scoring
│   │
│   ├── memory/
│   │   └── client-store.ts       # Client profile storage
│   │
│   ├── cli/
│   │   └── index.ts              # CLI interface
│   │
│   └── utils/
│       ├── logger.ts             # Structured logging
│       ├── retry.ts              # Retry with backoff
│       └── validation.ts         # Zod input validation
│
├── prompts/
│   ├── system/                   # Agent system prompts
│   │   ├── brief-agent.md
│   │   ├── draft-agent.md
│   │   ├── polish-agent.md
│   │   └── review-agent.md
│   └── templates/                # Content templates
│       ├── linkedin-post.md
│       ├── twitter-thread.md
│       └── blog-post.md
│
├── memory/
│   └── clients/                  # Local client data (gitignored)
│
├── data/
│   └── jobs/                     # Local job data (gitignored, local mode only)
│
└── tests/
    ├── agents/
    └── tools/
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `npm run cli -- setup-client <id> <name> [industry]` | Create a client profile |
| `npm run cli -- create-job <clientId> <type> <topic> [platform]` | Create a content generation job |
| `npm run cli -- get-job <jobId>` | Get job status and output |

### Job Types

- `social_post` - LinkedIn posts, tweets, Instagram captions
- `blog_post` - Long-form blog articles
- `report` - Marketing reports and analytics
- `campaign` - Multi-platform campaigns

### Platforms

`linkedin`, `twitter`, `instagram`, `facebook`, `tiktok`, `all`

## How It Works

### Event-Driven Pipeline

The system uses Redis Streams as a message bus. Each agent subscribes to specific events and publishes new events when its work is done:

1. **Router** receives a job request and publishes `job.created`
2. **Context Agent** loads the client's brand voice, content pillars, and preferences, then publishes `context.loaded`
3. **Brief Agent** creates a structured content brief (title, key messages, structure, word count), publishes `brief.ready`
4. **Draft Agent** writes the first draft following the brief exactly, publishes `draft.ready`
5. **Polish Agent** refines the draft for voice consistency, readability, and engagement, publishes `polish.done`
6. **Review Agent** scores the content (0-100) and either:
   - **Approves** (score >= 80) → publishes `review.passed` → job complete
   - **Requests revision** → publishes `revision.requested` → Draft Agent rewrites
   - **Escalates** to human review (after max iterations)

### Revision Loop

The system supports up to 3 revision iterations. If the Review Agent isn't satisfied, it sends specific feedback to the Draft Agent which rewrites accordingly. After max iterations, the job is escalated to human review.

### State Management

Jobs progress through these statuses:

```
received → context_loading → briefing → brief_pending_approval
→ drafting → polishing → reviewing → complete
                                    → revision (loops back to drafting)
                                    → human_review (escalated)
                                    → failed (on error)
```

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | Yes* | - | Anthropic API key for Claude |
| `REDIS_URL` | No | `redis://localhost:6379` | Redis connection URL |
| `SUPABASE_URL` | No | - | Supabase project URL |
| `SUPABASE_KEY` | No | - | Supabase anon/service key |
| `PORT` | No | `3000` | API server port |
| `NODE_ENV` | No | `development` | Environment |

*Required for AI agent functionality. The engine starts without it but LLM calls will fail.

### Local Development Mode

When Supabase credentials are not configured (or contain "placeholder"), the system automatically switches to local mode:

- **Jobs** are stored as JSON files in `data/jobs/`
- **Client profiles** are stored in `memory/clients/<clientId>/`
- No database setup required

## npm Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `npm run dev` | `npx tsx src/index.ts` | Start the agent engine |
| `npm run cli` | `npx tsx src/cli/index.ts` | Run CLI commands |
| `npm run build` | `tsc` | Compile TypeScript |
| `npm start` | `node dist/index.js` | Run compiled output |

## Extending

### Adding a New Agent

1. Create a new file in `src/agents/`
2. Extend `BaseAgent` from `src/core/agent-base.ts`
3. Implement the three abstract methods:
   - `getDefaultSystemPrompt()` - Agent's system prompt
   - `getSubscribedEvents()` - Events this agent listens to
   - `handleEvent(event, job)` - Event handler logic
4. Register the agent in `src/index.ts`

### Customizing Prompts

System prompts are loaded from `prompts/system/<agent-name>.md`. Edit these files to customize agent behavior without changing code.

### Adding Content Templates

Add new templates to `prompts/templates/` following the existing format (LinkedIn, Twitter, Blog).

## Troubleshooting

### Redis Connection Failed
```
Error: connect ECONNREFUSED 127.0.0.1:6379
```
Ensure Redis is running: `docker exec luniero-redis redis-cli ping`

### Anthropic API Error
```
Error: 401 Unauthorized
```
Check your `ANTHROPIC_API_KEY` in `.env`

### Job Stuck in "received" Status
The agent engine must be running (`npm run dev`) to process jobs. The CLI only creates jobs - the engine processes them.

## License

ISC
