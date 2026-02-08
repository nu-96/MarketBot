export const mockClients = {
  'acme-corp': {
    id: 'acme-corp',
    name: 'Acme Corporation',
    industry: 'Technology',
    description: 'B2B SaaS company providing project management solutions',
    goals: [
      'Increase brand awareness',
      'Generate qualified leads',
      'Establish thought leadership',
    ],
    platforms: [
      { platform: 'linkedin', handle: '@acmecorp', frequency: '3x/week' },
      { platform: 'twitter', handle: '@acme_corp', frequency: 'daily' },
      { platform: 'blog', handle: 'blog.acme.com', frequency: '2x/month' },
    ],
    contacts: [
      { name: 'Sarah Chen', role: 'Marketing Director', email: 'sarah@acme.com' },
      { name: 'Mike Ross', role: 'Content Manager', email: 'mike@acme.com' },
    ],
    preferences: {
      contentPillars: ['Productivity', 'Remote Work', 'Team Collaboration', 'AI in Business'],
      approvalRequired: true,
      autoSchedule: false,
    },
  },
  'bloom-beauty': {
    id: 'bloom-beauty',
    name: 'Bloom Beauty Co',
    industry: 'Cosmetics & Skincare',
    description: 'Clean beauty brand focused on sustainable, cruelty-free products',
    goals: [
      'Build community engagement',
      'Drive e-commerce sales',
      'Educate on clean beauty',
    ],
    platforms: [
      { platform: 'instagram', handle: '@bloombeautyco', frequency: 'daily' },
      { platform: 'tiktok', handle: '@bloombeauty', frequency: '5x/week' },
      { platform: 'youtube', handle: 'Bloom Beauty', frequency: '1x/week' },
    ],
    contacts: [
      { name: 'Emma Torres', role: 'Founder & CEO', email: 'emma@bloombeauty.co' },
    ],
    preferences: {
      contentPillars: ['Sustainability', 'Self-Care', 'Ingredient Education', 'Behind the Scenes'],
      preferredTone: 'warm and friendly',
      emojiUsage: 'frequent',
    },
  },
  'ironforge-fitness': {
    id: 'ironforge-fitness',
    name: 'IronForge Fitness',
    industry: 'Health & Fitness',
    description: 'Premium gym chain with personal training and nutrition coaching',
    goals: [
      'Increase membership sign-ups',
      'Promote personal training packages',
      'Build fitness community',
    ],
    platforms: [
      { platform: 'instagram', handle: '@ironforgefitness', frequency: 'daily' },
      { platform: 'youtube', handle: 'IronForge Fitness', frequency: '2x/week' },
      { platform: 'email', handle: 'newsletter', frequency: 'weekly' },
    ],
    contacts: [
      { name: 'Jake Morrison', role: 'Marketing Lead', email: 'jake@ironforge.fit' },
    ],
    preferences: {
      contentPillars: ['Workout Tips', 'Nutrition', 'Member Transformations', 'Trainer Spotlights'],
      preferredTone: 'motivational and energetic',
    },
  },
};

export const mockBrandVoices = {
  'acme-corp': {
    tone: 'professional yet approachable',
    avoid: ['jargon overload', 'overly casual language', 'making promises about features'],
    examples: [
      'Teams that collaborate better, ship faster.',
      'Your project timeline just got a lot clearer.',
    ],
    vocabulary: ['streamline', 'empower', 'efficiency', 'seamless', 'insights'],
  },
  'bloom-beauty': {
    tone: 'warm, friendly, and educational',
    avoid: ['harsh beauty standards', 'fear-based marketing', 'complicated ingredient lists'],
    examples: [
      'Glow from within—naturally.',
      'Clean ingredients, clear conscience.',
    ],
    vocabulary: ['nourish', 'glow', 'radiant', 'gentle', 'conscious'],
  },
  'ironforge-fitness': {
    tone: 'motivational, energetic, and supportive',
    avoid: ['body shaming', 'extreme diet talk', 'unachievable promises'],
    examples: [
      'Every rep counts. Every day matters.',
      'Your transformation starts with one decision.',
    ],
    vocabulary: ['crush', 'gains', 'grind', 'transform', 'commit'],
  },
};
