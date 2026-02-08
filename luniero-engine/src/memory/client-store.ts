import { createClient } from '@supabase/supabase-js';
import { config } from '../config';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
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
}

export const clientStore = new ClientStore();
