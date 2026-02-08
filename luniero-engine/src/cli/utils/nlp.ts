const PLATFORM_KEYWORDS: Record<string, string[]> = {
  linkedin: ['linkedin', 'li'],
  twitter: ['twitter', 'tweet', 'x.com', 'x post'],
  instagram: ['instagram', 'ig', 'insta', 'reel'],
  facebook: ['facebook', 'fb'],
  tiktok: ['tiktok', 'tik tok', 'tt'],
};

const CONTENT_TYPE_KEYWORDS: Record<string, string[]> = {
  social_post: ['post', 'social', 'tweet', 'reel', 'story', 'update'],
  blog_post: ['blog', 'article', 'piece', 'write-up', 'writeup', 'long-form', 'longform'],
  report: ['report', 'analysis', 'whitepaper', 'white paper', 'case study'],
  campaign: ['campaign', 'series', 'multi-post', 'launch'],
};

export function extractPlatform(input: string): string | undefined {
  const lower = input.toLowerCase();
  for (const [platform, keywords] of Object.entries(PLATFORM_KEYWORDS)) {
    for (const kw of keywords) {
      // Match as whole word (or preceded/followed by non-alpha)
      const regex = new RegExp(`(?:^|\\W)${escapeRegex(kw)}(?:$|\\W)`, 'i');
      if (regex.test(lower)) {
        return platform;
      }
    }
  }
  return undefined;
}

export function extractContentType(input: string): string | undefined {
  const lower = input.toLowerCase();
  for (const [type, keywords] of Object.entries(CONTENT_TYPE_KEYWORDS)) {
    for (const kw of keywords) {
      const regex = new RegExp(`(?:^|\\W)${escapeRegex(kw)}(?:$|\\W)`, 'i');
      if (regex.test(lower)) {
        return type;
      }
    }
  }
  return undefined;
}

export function extractTopic(input: string): string {
  // Remove platform/type keywords and common filler words to get the topic
  let topic = input;

  // Remove leading slash command if present
  topic = topic.replace(/^\/\w+\s*/, '');

  // Remove known platform keywords
  for (const keywords of Object.values(PLATFORM_KEYWORDS)) {
    for (const kw of keywords) {
      const regex = new RegExp(`(?:^|\\s)${escapeRegex(kw)}(?:$|\\s)`, 'gi');
      topic = topic.replace(regex, ' ');
    }
  }

  // Iteratively strip leading filler words and content-type keywords
  let prev = '';
  while (prev !== topic) {
    prev = topic;
    topic = topic.replace(/^\s*(write|create|make|draft|generate|compose)\s+/gi, '');
    topic = topic.replace(/^\s*(a|an|the|about|on|for)\s+/gi, '');
    topic = topic.replace(/^\s*(post|article|blog|tweet|report|reel|story|campaign)\s+/gi, '');
    topic = topic.replace(/^\s*(about|on|for|regarding)\s+/gi, '');
  }

  return topic.trim() || input.trim();
}

export function looksLikeWriteRequest(input: string): boolean {
  const lower = input.toLowerCase().trim();
  const writePatterns = [
    /^(write|create|make|draft|generate|compose)\b/,
    /\b(post|article|blog|tweet|campaign|report)\b.*\b(about|on|for|regarding)\b/,
    /\b(linkedin|twitter|instagram|facebook|tiktok)\b.*\b(post|content)\b/,
  ];
  return writePatterns.some(p => p.test(lower));
}

export function looksLikeQuickRequest(input: string): boolean {
  const lower = input.toLowerCase().trim();
  const quickPatterns = [
    /^(suggest|give me|brainstorm|list|ideas?|headline|caption|tagline|slogan|hook)\b/,
    /\b(ideas?|suggestions?|headlines?|captions?|taglines?|slogans?|hooks?)\s*(for|about|on)\b/,
  ];
  return quickPatterns.some(p => p.test(lower));
}

export function looksLikeResearchRequest(input: string): boolean {
  const lower = input.toLowerCase().trim();
  const researchPatterns = [
    /^(research|analyze|look into|investigate|find out|explore)\b/,
    /\b(trends?|market|competitor|audience|insights?)\b.*\b(for|about|on|in)\b/,
  ];
  return researchPatterns.some(p => p.test(lower));
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
