export interface ConversationMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

export interface Session {
  readonly activeClientId: string | null;
  readonly lastCommand: string | null;
  readonly lastJobId: string | null;
  readonly lastHandler: string | null;
  readonly pendingApproval: string | null;
  readonly conversationMessages: ReadonlyArray<ConversationMessage>;
  readonly history: ReadonlyArray<string>;
  readonly startedAt: string;
}

export function createSession(overrides?: Partial<Session>): Session {
  return {
    activeClientId: null,
    lastCommand: null,
    lastJobId: null,
    lastHandler: null,
    pendingApproval: null,
    conversationMessages: [],
    history: [],
    startedAt: new Date().toISOString(),
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
  const updates: Partial<Session> = { lastHandler: handler };
  // Clear conversation when switching to a different handler
  if (handler !== session.lastHandler) {
    updates.conversationMessages = [];
  }
  return updateSession(session, updates);
}

export function withPendingApproval(session: Session, jobId: string | null): Session {
  return updateSession(session, { pendingApproval: jobId });
}

export function withConversation(session: Session, messages: ConversationMessage[]): Session {
  return updateSession(session, { conversationMessages: messages });
}

