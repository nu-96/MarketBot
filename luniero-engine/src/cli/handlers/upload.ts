import { readFileSync, existsSync } from 'fs';
import { extname, resolve, basename } from 'path';
import { HandlerContext, HandlerResult } from '../router';
import { withLastHandler } from '../session';
import { formatError, formatInfo, formatSuccess, colors } from '../formatter';
import { promptForMissing } from '../utils/prompts';
import { clientStore } from '../../memory/client-store';

const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.csv', '.json', '.html', '.xml', '.yml', '.yaml']);
const PDF_EXTENSIONS = new Set(['.pdf']);
const MAX_VECTOR_CHARS = 500;

async function extractText(filePath: string): Promise<string> {
  const ext = extname(filePath).toLowerCase();

  if (TEXT_EXTENSIONS.has(ext)) {
    return readFileSync(filePath, 'utf-8');
  }

  if (PDF_EXTENSIONS.has(ext)) {
    const { PDFParse } = await import('pdf-parse');
    const buffer = readFileSync(filePath);
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    return result.text;
  }

  throw new Error(`Unsupported file type: ${ext}. Supported: PDF, TXT, MD, CSV, JSON`);
}

export async function handleUpload(ctx: HandlerContext): Promise<HandlerResult> {
  const { session, parsed, rl, output } = ctx;

  const filePath = await promptForMissing(rl, 'File path', parsed.subcommand || parsed.args[0] || undefined);
  if (!filePath) {
    output(formatError('File path is required.'));
    output(formatInfo('Usage: /upload <file> [--type=<type>]'));
    output(formatInfo('Supported: PDF, TXT, MD, CSV, JSON'));
    return { session };
  }

  const clientId = parsed.flags.client as string || session.activeClientId;
  if (!clientId) {
    output(formatError('No active client. Use /client switch first or pass --client=<id>.'));
    return { session };
  }

  const resolvedPath = resolve(filePath);
  if (!existsSync(resolvedPath)) {
    output(formatError(`File not found: ${resolvedPath}`));
    return { session: withLastHandler(session, '/upload') };
  }

  const docType = parsed.flags.type as string || 'general';

  output(formatInfo(`Reading ${basename(resolvedPath)}...`));

  try {
    const text = await extractText(resolvedPath);
    if (!text.trim()) {
      output(formatError('File is empty or could not extract text.'));
      return { session: withLastHandler(session, '/upload') };
    }

    // Store in chunks into the client's vector space
    const chunks = chunkText(text, MAX_VECTOR_CHARS);
    for (let i = 0; i < chunks.length; i++) {
      await clientStore.storeClientContext(clientId, {
        type: 'content',
        text: chunks[i],
        metadata: {
          source: 'file_upload',
          fileName: basename(resolvedPath),
          docType,
          chunkIndex: i,
          totalChunks: chunks.length,
        },
      });
    }

    output(formatSuccess(`Uploaded and stored "${basename(resolvedPath)}" — ${chunks.length} chunk(s) added to ${clientId}'s memory.`));

    // Show vector space proof
    try {
      const stats = await clientStore.getVectorStats(clientId);
      if (stats.documents.length > 0) {
        output('');
        output(`  Vector Space for "${clientId}":`);

        // Build table
        const docColWidth = Math.max(10, ...stats.documents.map(d => d.fileName.length)) + 2;
        const header = `  ${'Document'.padEnd(docColWidth)} ${'Chunks'.padEnd(8)} Type`;
        const separator = `  ${'─'.repeat(docColWidth)} ${'─'.repeat(8)} ${'─'.repeat(10)}`;
        output(header);
        output(separator);
        for (const doc of stats.documents) {
          output(`  ${doc.fileName.padEnd(docColWidth)} ${String(doc.chunks).padEnd(8)} ${doc.docType}`);
        }
        output(separator);

        const nonDocVectors = stats.totalVectors - stats.documents.reduce((sum, d) => sum + d.chunks, 0);
        if (nonDocVectors > 0) {
          output(`  Total vectors: ${stats.totalVectors} (includes ${nonDocVectors} from profile/voice/pillars)`);
        } else {
          output(`  Total vectors: ${stats.totalVectors}`);
        }
      }
    } catch {
      // Non-critical — don't fail the upload if stats display errors
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    output(formatError(`Upload failed: ${message}`));
  }

  return { session: withLastHandler(session, '/upload') };
}

function chunkText(text: string, maxChars: number): string[] {
  const chunks: string[] = [];
  const sentences = text.replace(/\n+/g, ' ').split(/(?<=[.!?])\s+/);
  let current = '';

  for (const sentence of sentences) {
    if (current.length + sentence.length > maxChars && current.length > 0) {
      chunks.push(current.trim());
      current = '';
    }
    current += sentence + ' ';
  }
  if (current.trim()) {
    chunks.push(current.trim());
  }
  // If no sentence splitting happened (e.g. no punctuation), split by chars
  if (chunks.length === 0 && text.length > 0) {
    for (let i = 0; i < text.length; i += maxChars) {
      chunks.push(text.substring(i, i + maxChars).trim());
    }
  }
  return chunks.filter(c => c.length > 0);
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
