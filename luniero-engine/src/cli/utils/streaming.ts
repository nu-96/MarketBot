// ANSI helpers (local to avoid circular import with formatter)
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';
const hi = (s: string) => `${BOLD}${s}${RESET}`;

// Pulsing circle animation per spec: ○ ◎ ● ◎
const PULSE_FRAMES = ['○', '◎', '●', '◎'];
const PULSE_INTERVAL_MS = 300;

export interface PulseSpinner {
  start: () => void;
  update: (message: string) => void;
  stop: (finalMessage?: string) => void;
}

export function createPulseSpinner(initialMessage: string): PulseSpinner {
  let frame = 0;
  let message = initialMessage;
  let timer: NodeJS.Timeout | null = null;

  return {
    start() {
      timer = setInterval(() => {
        process.stdout.write(`\r${PULSE_FRAMES[frame % PULSE_FRAMES.length]} ${message}  `);
        frame++;
      }, PULSE_INTERVAL_MS);
    },
    update(newMessage: string) {
      message = newMessage;
    },
    stop(finalMessage?: string) {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      const clearWidth = message.length + 4;
      process.stdout.write('\r' + ' '.repeat(clearWidth) + '\r');
      if (finalMessage) {
        process.stdout.write(finalMessage + '\n');
      }
    },
  };
}

// Pipeline progress tree display
export type StageStatus = 'pending' | 'active' | 'done' | 'failed';

export interface PipelineStage {
  name: string;
  status: StageStatus;
  duration?: number; // seconds
  detail?: string;
}

export function formatPipelineTree(stages: PipelineStage[]): string {
  const lines: string[] = [];

  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i];
    const isLast = i === stages.length - 1;
    const prefix = isLast ? '└─' : '├─';

    switch (stage.status) {
      case 'done': {
        const time = stage.duration != null ? ` (${stage.duration.toFixed(1)}s)` : '';
        lines.push(`${prefix} ✓ ${stage.name}${time}`);
        break;
      }
      case 'active': {
        const detail = stage.detail ? ` — ${stage.detail}` : '';
        lines.push(`${prefix} ● ${stage.name}${detail}`);
        break;
      }
      case 'failed': {
        const detail = stage.detail ? ` (${stage.detail})` : '';
        lines.push(`${prefix} ✗ ${stage.name}${detail}`);
        break;
      }
      case 'pending':
      default:
        lines.push(`${prefix} ○ ${stage.name}`);
        break;
    }
  }

  return lines.join('\n');
}

// Rotating stage messages per spec — key terms highlighted in bold
export const STAGE_MESSAGES: Record<string, string[]> = {
  context: [
    `Loading your ${hi('brand profile')} — so the content sounds like you`,
    `Fetching ${hi('brand voice')} — checking your tone preferences`,
    `Pulling ${hi('content pillars')} — these guide what topics to focus on`,
    `Reviewing recent ${hi('feedback')} — learning from past content`,
  ],
  brief: [
    `Analyzing your ${hi('request')} — understanding what you need`,
    `Researching ${hi('angles')} — finding the best way to approach this`,
    `Structuring the ${hi('brief')} — mapping out the content flow`,
    `Finalizing ${hi('key messages')} — picking the most impactful points`,
  ],
  draft: [
    `Writing the ${hi('first draft')} — this takes a few seconds`,
    `Crafting your ${hi('hook')} — the first line matters most`,
    `Building the ${hi('story')} — connecting your key points`,
    `Adding ${hi('details')} — making it specific and credible`,
    `Wrapping up — ending with a clear ${hi('call to action')}`,
  ],
  polish: [
    `Matching your ${hi('voice')} — making sure it sounds like your brand`,
    `Smoothing ${hi('transitions')} — improving the flow`,
    `Strengthening the ${hi('hook')} — grabbing attention faster`,
    `Final ${hi('polish')} — small tweaks that make a big difference`,
  ],
  review: [
    `Checking ${hi('brand fit')} — does this sound like you?`,
    `Validating ${hi('structure')} — is the flow logical?`,
    `Scoring ${hi('engagement')} — will people want to read this?`,
    `Final ${hi('check')} — making sure it's ready to publish`,
  ],
};

export function getRotatingMessage(stage: string, index: number): string {
  const messages = STAGE_MESSAGES[stage];
  if (!messages || messages.length === 0) return stage;
  return messages[index % messages.length];
}

export { PULSE_FRAMES, PULSE_INTERVAL_MS };
