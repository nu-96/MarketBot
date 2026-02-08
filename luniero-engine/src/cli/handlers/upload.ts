import { HandlerContext, HandlerResult } from '../router';
import { withLastHandler } from '../session';
import { formatError, formatInfo, formatSuccess, colors } from '../formatter';
import { promptForMissing } from '../utils/prompts';

export async function handleUpload(ctx: HandlerContext): Promise<HandlerResult> {
  const { session, parsed, rl, output } = ctx;

  const filePath = await promptForMissing(rl, 'File path', parsed.subcommand || parsed.args[0] || undefined);
  if (!filePath) {
    output(formatError('File path is required.'));
    output(formatInfo('Usage: /upload <file> [context]'));
    output(formatInfo('Supported: PDF, DOCX, TXT, MD, CSV, XLSX, JSON, PNG, JPG, GIF, MP3, WAV'));
    return { session };
  }

  const clientId = parsed.flags.client as string || session.activeClientId;
  const docType = parsed.flags.type as string || 'general';

  output(formatInfo(`Uploading ${filePath}...`));
  output(formatInfo('File upload and processing is not yet implemented.'));
  output(formatInfo('This will support: PDF/DOCX text extraction, CSV parsing, image analysis, and audio transcription.'));

  return { session: withLastHandler(session, '/upload') };
}

export async function handleUploads(ctx: HandlerContext): Promise<HandlerResult> {
  const { session, parsed, output } = ctx;
  const sub = parsed.subcommand?.toLowerCase() || '';

  if (sub === 'show') {
    const fileId = parsed.args[0];
    if (!fileId) {
      output(formatError('File ID is required. Usage: /uploads show <file_id>'));
      return { session };
    }
    output(formatInfo(`File preview for "${fileId}" is not yet implemented.`));
    return { session: withLastHandler(session, '/uploads') };
  }

  if (sub === 'delete') {
    const fileId = parsed.args[0];
    if (!fileId) {
      output(formatError('File ID is required. Usage: /uploads delete <file_id>'));
      return { session };
    }
    output(formatInfo(`File deletion for "${fileId}" is not yet implemented.`));
    return { session: withLastHandler(session, '/uploads') };
  }

  if (sub === 'search') {
    const query = parsed.args.join(' ');
    if (!query) {
      output(formatError('Search query is required. Usage: /uploads search <query>'));
      return { session };
    }
    output(formatInfo(`Search for "${query}" is not yet implemented.`));
    return { session: withLastHandler(session, '/uploads') };
  }

  // Default: list uploads
  const clientId = parsed.flags.client as string || session.activeClientId;
  if (!clientId) {
    output(formatInfo('No active client. Use --client flag or /client switch first.'));
    return { session: withLastHandler(session, '/uploads') };
  }

  output(formatInfo(`No uploads found for client "${clientId}".`));
  output(formatInfo('Upload files with: /upload <file> --client <id> --type <voice|guidelines|research|assets|data|brief>'));

  return { session: withLastHandler(session, '/uploads') };
}
