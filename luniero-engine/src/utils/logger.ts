type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  agent?: string;
  jobId?: string;
  message: string;
  data?: any;
}

class Logger {
  private formatEntry(entry: LogEntry): string {
    const prefix = entry.agent ? `[${entry.agent}]` : '';
    const jobPrefix = entry.jobId ? `[${entry.jobId}]` : '';
    return `${entry.timestamp} ${entry.level.toUpperCase()} ${prefix}${jobPrefix} ${entry.message}`;
  }

  private log(level: LogLevel, message: string, data?: any, context?: { agent?: string; jobId?: string }) {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      data,
      ...context,
    };

    console.log(this.formatEntry(entry));
    if (data) console.log(JSON.stringify(data, null, 2));
  }

  debug(message: string, data?: any, context?: { agent?: string; jobId?: string }) {
    this.log('debug', message, data, context);
  }

  info(message: string, data?: any, context?: { agent?: string; jobId?: string }) {
    this.log('info', message, data, context);
  }

  warn(message: string, data?: any, context?: { agent?: string; jobId?: string }) {
    this.log('warn', message, data, context);
  }

  error(message: string, data?: any, context?: { agent?: string; jobId?: string }) {
    this.log('error', message, data, context);
  }
}

export const logger = new Logger();
