export interface Session {
  readonly activeClientId: string | null;
  readonly lastCommand: string | null;
  readonly lastJobId: string | null;
  readonly lastHandler: string | null;
  readonly pendingApproval: string | null;
  readonly history: ReadonlyArray<string>;
  readonly startedAt: string;
  readonly debug: boolean;
}

export function createSession(overrides?: Partial<Session>): Session {
  return {
    activeClientId: null,
    lastCommand: null,
    lastJobId: null,
    lastHandler: null,
    pendingApproval: null,
    history: [],
    startedAt: new Date().toISOString(),
    debug: false,
    ...overrides,
  };
}

export function updateSession(session: Session, updates: Partial<Session>): Session {
  return { ...session, ...updates };
}

export function withClient(session: Session, clientId: string): Session {
  return updateSession(session, { activeClientId: clientId });
}

export function withLastCommand(session: Session, command: string): Session {
  const history = [...session.history, command].slice(-50);
  return updateSession(session, { lastCommand: command, history });
}

export function withLastJob(session: Session, jobId: string | null): Session {
  return updateSession(session, { lastJobId: jobId });
}

export function withLastHandler(session: Session, handler: string | null): Session {
  return updateSession(session, { lastHandler: handler });
}

export function withPendingApproval(session: Session, jobId: string | null): Session {
  return updateSession(session, { pendingApproval: jobId });
}

export function withDebug(session: Session, debug: boolean): Session {
  return updateSession(session, { debug });
}
