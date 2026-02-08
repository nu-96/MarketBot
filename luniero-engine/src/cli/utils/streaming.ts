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
        const detail = stage.detail ? ` — ${stage.detail}` : '...';
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

// Rotating stage messages per spec
export const STAGE_MESSAGES: Record<string, string[]> = {
  context: [
    'Loading your brand profile — so the content sounds like you',
    'Fetching brand voice — checking your tone preferences',
    'Pulling content pillars — these guide what topics to focus on',
    'Reviewing recent feedback — learning from past content',
  ],
  brief: [
    'Analyzing your request — understanding what you need',
    'Researching angles — finding the best way to approach this',
    'Structuring the brief — mapping out the content flow',
    'Finalizing key messages — picking the most impactful points',
  ],
  draft: [
    'Writing the first draft — this takes a few seconds',
    'Crafting your hook — the first line matters most',
    'Building the story — connecting your key points',
    'Adding details — making it specific and credible',
    'Wrapping up — ending with a clear call to action',
  ],
  polish: [
    'Matching your voice — making sure it sounds like your brand',
    'Smoothing transitions — improving the flow',
    'Strengthening the hook — grabbing attention faster',
    'Final polish — small tweaks that make a big difference',
  ],
  review: [
    'Checking brand fit — does this sound like you?',
    'Validating structure — is the flow logical?',
    'Scoring engagement — will people want to read this?',
    'Final check — making sure it\'s ready to publish',
  ],
};

export function getRotatingMessage(stage: string, index: number): string {
  const messages = STAGE_MESSAGES[stage];
  if (!messages || messages.length === 0) return `${stage}...`;
  return messages[index % messages.length];
}

export { PULSE_FRAMES, PULSE_INTERVAL_MS };
