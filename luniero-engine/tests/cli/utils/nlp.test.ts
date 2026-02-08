import { describe, it, expect } from 'vitest';
import {
  extractPlatform,
  extractContentType,
  extractTopic,
  looksLikeWriteRequest,
  looksLikeQuickRequest,
  looksLikeResearchRequest,
  looksLikeStatusRequest,
  looksLikeHelpRequest,
  looksLikeCalendarRequest,
  looksLikeScheduleRequest,
  looksLikeClientRequest,
  looksLikeUploadRequest,
  looksLikeReportRequest,
  looksLikeExportRequest,
  looksLikeRepurposeRequest,
  looksLikeTrendingRequest,
} from '../../../src/cli/utils/nlp';

describe('nlp', () => {
  describe('extractPlatform', () => {
    it('should extract linkedin', () => {
      expect(extractPlatform('write a LinkedIn post')).toBe('linkedin');
    });

    it('should extract twitter', () => {
      expect(extractPlatform('tweet about AI')).toBe('twitter');
    });

    it('should extract instagram', () => {
      expect(extractPlatform('create an Instagram reel')).toBe('instagram');
    });

    it('should extract facebook', () => {
      expect(extractPlatform('post on Facebook')).toBe('facebook');
    });

    it('should extract tiktok', () => {
      expect(extractPlatform('make a TikTok video')).toBe('tiktok');
    });

    it('should handle case insensitivity', () => {
      expect(extractPlatform('LINKEDIN post')).toBe('linkedin');
    });

    it('should return undefined for no platform', () => {
      expect(extractPlatform('write something about AI')).toBeUndefined();
    });

    it('should match li abbreviation', () => {
      expect(extractPlatform('post on LI about AI')).toBe('linkedin');
    });

    it('should match ig abbreviation', () => {
      expect(extractPlatform('make an IG post')).toBe('instagram');
    });

    it('should match fb abbreviation', () => {
      expect(extractPlatform('share on fb')).toBe('facebook');
    });

    it('should not match partial words', () => {
      // "fbi" should not match "fb"
      expect(extractPlatform('write about fbi investigation')).toBeUndefined();
    });
  });

  describe('extractContentType', () => {
    it('should extract social_post from "post"', () => {
      expect(extractContentType('write a post about AI')).toBe('social_post');
    });

    it('should extract blog_post from "blog"', () => {
      expect(extractContentType('create a blog about trends')).toBe('blog_post');
    });

    it('should extract blog_post from "article"', () => {
      expect(extractContentType('write an article')).toBe('blog_post');
    });

    it('should extract report', () => {
      expect(extractContentType('generate a report on competitors')).toBe('report');
    });

    it('should extract campaign', () => {
      expect(extractContentType('launch a campaign')).toBe('campaign');
    });

    it('should return undefined for ambiguous input', () => {
      expect(extractContentType('something about AI')).toBeUndefined();
    });

    it('should detect tweet as social_post', () => {
      expect(extractContentType('tweet about our launch')).toBe('social_post');
    });

    it('should detect whitepaper as report', () => {
      expect(extractContentType('draft a whitepaper on cloud')).toBe('report');
    });

    it('should detect case study as report', () => {
      expect(extractContentType('write a case study')).toBe('report');
    });
  });

  describe('extractTopic', () => {
    it('should extract topic from natural language', () => {
      expect(extractTopic('write a LinkedIn post about AI trends')).toBe('AI trends');
    });

    it('should handle slash command prefix', () => {
      expect(extractTopic('/write a post about cloud computing')).toContain('cloud computing');
    });

    it('should return original input when nothing to strip', () => {
      expect(extractTopic('quantum computing')).toBe('quantum computing');
    });

    it('should handle empty-ish input', () => {
      expect(extractTopic('')).toBe('');
    });

    it('should strip common filler words', () => {
      const result = extractTopic('create a post about machine learning');
      expect(result).toContain('machine learning');
    });
  });

  describe('looksLikeWriteRequest', () => {
    it('should detect "write a post about..."', () => {
      expect(looksLikeWriteRequest('write a post about AI')).toBe(true);
    });

    it('should detect "create a LinkedIn post..."', () => {
      expect(looksLikeWriteRequest('create a LinkedIn post about trends')).toBe(true);
    });

    it('should detect "draft an article..."', () => {
      expect(looksLikeWriteRequest('draft an article about cloud')).toBe(true);
    });

    it('should detect "LinkedIn post about AI"', () => {
      expect(looksLikeWriteRequest('LinkedIn post about AI trends')).toBe(true);
    });

    it('should not match random text', () => {
      expect(looksLikeWriteRequest('hello world')).toBe(false);
    });

    it('should not match questions', () => {
      expect(looksLikeWriteRequest('what is AI?')).toBe(false);
    });
  });

  describe('looksLikeQuickRequest', () => {
    it('should detect "give me ideas for..."', () => {
      expect(looksLikeQuickRequest('give me ideas for LinkedIn posts')).toBe(true);
    });

    it('should detect "suggest headlines..."', () => {
      expect(looksLikeQuickRequest('suggest headlines for our launch')).toBe(true);
    });

    it('should detect "brainstorm..."', () => {
      expect(looksLikeQuickRequest('brainstorm topics for next week')).toBe(true);
    });

    it('should detect "caption for..."', () => {
      expect(looksLikeQuickRequest('captions for Instagram post')).toBe(true);
    });

    it('should not match write requests', () => {
      expect(looksLikeQuickRequest('write a blog post')).toBe(false);
    });
  });

  describe('looksLikeResearchRequest', () => {
    it('should detect "research..."', () => {
      expect(looksLikeResearchRequest('research AI trends')).toBe(true);
    });

    it('should detect "analyze competitors"', () => {
      expect(looksLikeResearchRequest('analyze competitor trends for SaaS')).toBe(true);
    });

    it('should detect "market trends for..."', () => {
      expect(looksLikeResearchRequest('market trends for cloud computing')).toBe(true);
    });

    it('should not match write requests', () => {
      expect(looksLikeResearchRequest('write about AI')).toBe(false);
    });
  });

  describe('looksLikeStatusRequest', () => {
    it('should detect "status"', () => {
      expect(looksLikeStatusRequest('status')).toBe(true);
    });

    it('should detect "check status"', () => {
      expect(looksLikeStatusRequest('check status')).toBe(true);
    });

    it('should detect "show jobs"', () => {
      expect(looksLikeStatusRequest('show jobs')).toBe(true);
    });

    it('should detect "any updates"', () => {
      expect(looksLikeStatusRequest('any updates')).toBe(true);
    });

    it('should not match unrelated input', () => {
      expect(looksLikeStatusRequest('write a post')).toBe(false);
    });
  });

  describe('looksLikeHelpRequest', () => {
    it('should detect "help"', () => {
      expect(looksLikeHelpRequest('help')).toBe(true);
    });

    it('should detect "what can you do"', () => {
      expect(looksLikeHelpRequest('what can you do')).toBe(true);
    });

    it('should detect "commands"', () => {
      expect(looksLikeHelpRequest('commands')).toBe(true);
    });

    it('should not match unrelated input', () => {
      expect(looksLikeHelpRequest('write a blog')).toBe(false);
    });
  });

  describe('looksLikeCalendarRequest', () => {
    it('should detect "calendar"', () => {
      expect(looksLikeCalendarRequest('calendar')).toBe(true);
    });

    it('should detect "show calendar"', () => {
      expect(looksLikeCalendarRequest('show calendar')).toBe(true);
    });

    it('should detect "whats scheduled"', () => {
      expect(looksLikeCalendarRequest('whats scheduled')).toBe(true);
    });

    it('should not match unrelated input', () => {
      expect(looksLikeCalendarRequest('write a post')).toBe(false);
    });
  });

  describe('looksLikeScheduleRequest', () => {
    it('should detect "schedule a post"', () => {
      expect(looksLikeScheduleRequest('schedule a post')).toBe(true);
    });

    it('should detect "publish at 3pm"', () => {
      expect(looksLikeScheduleRequest('publish at 3pm')).toBe(true);
    });

    it('should not match unrelated input', () => {
      expect(looksLikeScheduleRequest('write a blog')).toBe(false);
    });
  });

  describe('looksLikeClientRequest', () => {
    it('should detect "switch client"', () => {
      expect(looksLikeClientRequest('switch client')).toBe(true);
    });

    it('should detect "new client"', () => {
      expect(looksLikeClientRequest('new client')).toBe(true);
    });

    it('should detect "clients"', () => {
      expect(looksLikeClientRequest('clients')).toBe(true);
    });

    it('should not match unrelated input', () => {
      expect(looksLikeClientRequest('write a blog')).toBe(false);
    });
  });

  describe('looksLikeUploadRequest', () => {
    it('should detect "upload a file"', () => {
      expect(looksLikeUploadRequest('upload a file')).toBe(true);
    });

    it('should detect "import pdf"', () => {
      expect(looksLikeUploadRequest('import a pdf')).toBe(true);
    });

    it('should not match unrelated input', () => {
      expect(looksLikeUploadRequest('write a post')).toBe(false);
    });
  });

  describe('looksLikeReportRequest', () => {
    it('should detect "report"', () => {
      expect(looksLikeReportRequest('report')).toBe(true);
    });

    it('should detect "show analytics"', () => {
      expect(looksLikeReportRequest('show analytics')).toBe(true);
    });

    it('should not match unrelated input', () => {
      expect(looksLikeReportRequest('write a blog')).toBe(false);
    });
  });

  describe('looksLikeExportRequest', () => {
    it('should detect "export"', () => {
      expect(looksLikeExportRequest('export')).toBe(true);
    });

    it('should detect "save as markdown"', () => {
      expect(looksLikeExportRequest('save as markdown')).toBe(true);
    });

    it('should not match unrelated input', () => {
      expect(looksLikeExportRequest('write a post')).toBe(false);
    });
  });

  describe('looksLikeRepurposeRequest', () => {
    it('should detect "repurpose"', () => {
      expect(looksLikeRepurposeRequest('repurpose this content')).toBe(true);
    });

    it('should detect "convert into a blog"', () => {
      expect(looksLikeRepurposeRequest('convert into a blog')).toBe(true);
    });

    it('should not match unrelated input', () => {
      expect(looksLikeRepurposeRequest('write a post')).toBe(false);
    });
  });

  describe('looksLikeTrendingRequest', () => {
    it('should detect "trending"', () => {
      expect(looksLikeTrendingRequest('trending')).toBe(true);
    });

    it('should detect "whats trending"', () => {
      expect(looksLikeTrendingRequest('whats trending')).toBe(true);
    });

    it('should detect "hot topics"', () => {
      expect(looksLikeTrendingRequest('hot topics')).toBe(true);
    });

    it('should not match unrelated input', () => {
      expect(looksLikeTrendingRequest('write a post')).toBe(false);
    });
  });
});
