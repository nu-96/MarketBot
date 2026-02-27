import { createClient } from '@supabase/supabase-js';
import { config } from '../config';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';

const DB_TIMEOUT_MS = 10_000;
const EMBEDDING_DIM = 384;

function withTimeout<T>(promise: PromiseLike<T>, ms = DB_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Database query timed out after ${ms}ms`)), ms);
    Promise.resolve(promise).then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

interface ClientProfile {
  id: string;
  name: string;
  industry: string;
  description: string;
  goals: string[];
  platforms: { platform: string; handle: string; frequency: string }[];
  contacts: { name: string; role: string; email: string }[];
  preferences: Record<string, any>;
}

interface BrandVoice {
  tone: string;
  avoid: string[];
  examples: string[];
  vocabulary: string[];
}

class ClientStore {
  private supabase;
  private localPath = join(__dirname, '../../memory/clients');

  constructor() {
    this.supabase = config.localMode ? null : createClient(config.supabaseUrl, config.supabaseKey);
    if (!existsSync(this.localPath)) {
      mkdirSync(this.localPath, { recursive: true });
    }
  }

  async getAllClients(): Promise<ClientProfile[]> {
    const profiles: ClientProfile[] = [];

    // Scan local directories
    if (existsSync(this.localPath)) {
      const dirs = readdirSync(this.localPath).filter(d => {
        const profilePath = join(this.localPath, d, 'profile.json');
        return existsSync(profilePath);
      });
      for (const dir of dirs) {
        try {
          const data = JSON.parse(readFileSync(join(this.localPath, dir, 'profile.json'), 'utf-8'));
          profiles.push(data);
        } catch {
          // Skip corrupt profiles
        }
      }
    }

    return profiles;
  }

  async getProfile(clientId: string): Promise<ClientProfile | null> {
    // Try local first (for development)
    const localPath = join(this.localPath, clientId, 'profile.json');
    if (existsSync(localPath)) {
      return JSON.parse(readFileSync(localPath, 'utf-8'));
    }

    if (config.localMode || !this.supabase) return null;

    // Then try Supabase
    const { data, error } = await withTimeout(
      this.supabase.from('client_profiles').select('*').eq('id', clientId).single()
    );

    if (error) return null;
    return data;
  }

  async saveProfile(clientId: string, profile: ClientProfile) {
    // Save locally
    const clientPath = join(this.localPath, clientId);
    if (!existsSync(clientPath)) {
      mkdirSync(clientPath, { recursive: true });
    }
    writeFileSync(join(clientPath, 'profile.json'), JSON.stringify(profile, null, 2));

    // Save to Supabase if available
    if (!config.localMode && this.supabase) {
      await withTimeout(this.supabase.from('client_profiles').upsert(profile));
    }

    // Auto-vectorize content pillars
    if (profile.preferences?.contentPillars?.length) {
      for (const pillar of profile.preferences.contentPillars) {
        await this.storeClientContext(clientId, {
          type: 'preference',
          text: `Content pillar: ${pillar}`,
          metadata: { source: 'content_pillar' },
        });
      }
    }
  }

  async getBrandVoice(clientId: string): Promise<BrandVoice | null> {
    const localPath = join(this.localPath, clientId, 'brand_voice.json');
    if (existsSync(localPath)) {
      return JSON.parse(readFileSync(localPath, 'utf-8'));
    }

    if (config.localMode || !this.supabase) return null;

    const { data } = await withTimeout(
      this.supabase.from('brand_voices').select('*').eq('client_id', clientId).single()
    );

    return data;
  }

  async saveBrandVoice(clientId: string, voice: BrandVoice) {
    const clientPath = join(this.localPath, clientId);
    if (!existsSync(clientPath)) mkdirSync(clientPath, { recursive: true });
    writeFileSync(join(clientPath, 'brand_voice.json'), JSON.stringify(voice, null, 2));

    if (!config.localMode && this.supabase) {
      await withTimeout(this.supabase.from('brand_voices').upsert({ client_id: clientId, ...voice }));
    }

    // Auto-vectorize tone and vocabulary
    await this.storeClientContext(clientId, {
      type: 'preference',
      text: `Brand voice tone: ${voice.tone}. Vocabulary: ${voice.vocabulary.join(', ')}. Avoid: ${voice.avoid.join(', ')}.`,
      metadata: { source: 'brand_voice' },
    });
  }

  async saveContentPillars(clientId: string, pillars: string[]) {
    const profile = await this.getProfile(clientId);
    if (profile) {
      profile.preferences = { ...profile.preferences, contentPillars: pillars };
      // Save profile without re-vectorizing (we vectorize explicitly below)
      const clientPath = join(this.localPath, clientId);
      if (!existsSync(clientPath)) mkdirSync(clientPath, { recursive: true });
      writeFileSync(join(clientPath, 'profile.json'), JSON.stringify(profile, null, 2));

      if (!config.localMode && this.supabase) {
        await withTimeout(this.supabase.from('client_profiles').upsert(profile));
      }

      // Vectorize each pillar
      for (const pillar of pillars) {
        await this.storeClientContext(clientId, {
          type: 'preference',
          text: `Content pillar: ${pillar}`,
          metadata: { source: 'content_pillar' },
        });
      }
    }
  }

  async getContentPillars(clientId: string): Promise<string[]> {
    const profile = await this.getProfile(clientId);
    return profile?.preferences?.contentPillars || [];
  }

  async getRecentFeedback(clientId: string, limit: number) {
    if (config.localMode || !this.supabase) return [];

    const { data } = await withTimeout(
      this.supabase.from('content_feedback').select('*').eq('client_id', clientId)
        .order('created_at', { ascending: false }).limit(limit)
    );

    return data || [];
  }

  async logFeedback(clientId: string, contentId: string, feedback: {
    liked: boolean;
    comments: string;
    tags: string[];
  }) {
    if (config.localMode || !this.supabase) return;

    await withTimeout(this.supabase.from('content_feedback').insert({
      client_id: clientId,
      content_id: contentId,
      ...feedback,
      created_at: new Date().toISOString(),
    }));
  }

  // --- Vector embedding methods for personalization ---

  private simpleHash(text: string): number[] {
    const hash: number[] = new Array(EMBEDDING_DIM).fill(0);
    for (let i = 0; i < text.length; i++) {
      hash[i % EMBEDDING_DIM] += text.charCodeAt(i) / 255;
    }
    return hash.map(h => h % 1);
  }

  private async getEmbedding(text: string): Promise<number[]> {
    // Local mode: deterministic pseudo-embedding
    return this.simpleHash(text);
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dotProduct / denom;
  }

  async storeClientContext(clientId: string, context: {
    type: 'feedback' | 'preference' | 'content' | 'interaction';
    text: string;
    metadata?: Record<string, any>;
  }) {
    const embedding = await this.getEmbedding(context.text);

    if (!config.localMode && this.supabase) {
      await this.supabase.from('client_context_vectors').insert({
        client_id: clientId,
        type: context.type,
        text: context.text,
        embedding,
        metadata: context.metadata,
        created_at: new Date().toISOString(),
      });
    } else {
      const clientPath = join(this.localPath, clientId);
      if (!existsSync(clientPath)) {
        mkdirSync(clientPath, { recursive: true });
      }
      const vectorPath = join(clientPath, 'vectors.json');
      const existing = existsSync(vectorPath) ? JSON.parse(readFileSync(vectorPath, 'utf-8')) : [];
      existing.push({ ...context, embedding, createdAt: new Date().toISOString() });
      writeFileSync(vectorPath, JSON.stringify(existing, null, 2));
    }
  }

  private matchesFileName(storedFileName: string, query: string): boolean {
    const normalizedStored = storedFileName.replace(/\.[^.]+$/, '').toLowerCase();
    const normalizedQuery = query.replace(/\.[^.]+$/, '').toLowerCase();

    // Exact match: query is just the filename
    if (normalizedStored === normalizedQuery) return true;

    // Contained match: the filename appears as a word boundary in the query
    // Supports both hyphens and underscores as separators (and spaces)
    const queryNormalized = normalizedQuery.replace(/[-_]/g, '[-_ ]');
    const storedPattern = normalizedStored.replace(/[-_]/g, '[-_ ]');
    const regex = new RegExp(`(?:^|\\s|\\b)${storedPattern}(?:\\s|\\b|$)`);
    return regex.test(normalizedQuery);
  }

  async searchByFileName(clientId: string, fileName: string): Promise<Array<{
    text: string; type: string; score: number; metadata?: Record<string, any>;
  }>> {
    if (!config.localMode && this.supabase) {
      const { data } = await withTimeout(
        this.supabase.from('client_context_vectors')
          .select('*')
          .eq('client_id', clientId)
          .eq('metadata->>source', 'file_upload')
      );
      return (data || [])
        .filter((v: any) => {
          const storedName = v.metadata?.fileName || '';
          return this.matchesFileName(storedName, fileName);
        })
        .sort((a: any, b: any) => (a.metadata?.chunkIndex ?? 0) - (b.metadata?.chunkIndex ?? 0))
        .map((v: any) => ({ text: v.text, type: v.type, score: 1.0, metadata: v.metadata }));
    }

    const vectorPath = join(this.localPath, clientId, 'vectors.json');
    if (!existsSync(vectorPath)) return [];
    const vectors = JSON.parse(readFileSync(vectorPath, 'utf-8'));
    return vectors
      .filter((v: any) => {
        const storedName = v.metadata?.fileName || '';
        return this.matchesFileName(storedName, fileName);
      })
      .sort((a: any, b: any) => (a.metadata?.chunkIndex ?? 0) - (b.metadata?.chunkIndex ?? 0))
      .map((v: any) => ({ text: v.text, type: v.type, score: 1.0, metadata: v.metadata }));
  }

  async getVectorStats(clientId: string): Promise<{
    totalVectors: number;
    documents: { fileName: string; chunks: number; docType: string }[];
  }> {
    let vectors: any[] = [];

    if (!config.localMode && this.supabase) {
      const { data } = await withTimeout(
        this.supabase.from('client_context_vectors')
          .select('*')
          .eq('client_id', clientId)
      );
      vectors = data || [];
    } else {
      const vectorPath = join(this.localPath, clientId, 'vectors.json');
      if (existsSync(vectorPath)) {
        vectors = JSON.parse(readFileSync(vectorPath, 'utf-8'));
      }
    }

    const totalVectors = vectors.length;
    const docMap = new Map<string, { chunks: number; docType: string }>();

    for (const v of vectors) {
      if (v.metadata?.source === 'file_upload' && v.metadata?.fileName) {
        const key = v.metadata.fileName;
        const existing = docMap.get(key);
        if (existing) {
          existing.chunks++;
        } else {
          docMap.set(key, { chunks: 1, docType: v.metadata.docType || 'general' });
        }
      }
    }

    const documents = Array.from(docMap.entries()).map(([fileName, info]) => ({
      fileName,
      chunks: info.chunks,
      docType: info.docType,
    }));

    return { totalVectors, documents };
  }

  async searchClientContext(clientId: string, query: string, limit = 5): Promise<Array<{
    text: string;
    type: string;
    score: number;
    metadata?: Record<string, any>;
  }>> {
    const queryEmbedding = await this.getEmbedding(query);

    if (!config.localMode && this.supabase) {
      const { data } = await this.supabase.rpc('match_client_context', {
        p_client_id: clientId,
        query_embedding: queryEmbedding,
        match_count: limit,
      });
      return data || [];
    } else {
      const vectorPath = join(this.localPath, clientId, 'vectors.json');
      if (!existsSync(vectorPath)) return [];
      const vectors = JSON.parse(readFileSync(vectorPath, 'utf-8'));
      return vectors
        .map((v: any) => ({
          text: v.text,
          type: v.type,
          score: this.cosineSimilarity(queryEmbedding, v.embedding),
          metadata: v.metadata,
        }))
        .sort((a: any, b: any) => b.score - a.score)
        .slice(0, limit);
    }
  }

  // Alias for convenience
  async listClients(): Promise<ClientProfile[]> {
    return this.getAllClients();
  }
}

export const clientStore = new ClientStore();
