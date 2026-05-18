import OpenAI from 'openai';

const getOpenAIClient = () => {
  const apiKey = process.env.OPENAI_API_KEY;
  
  // Defensive build-time fallback key to prevent Next.js compilation failure
  if (!apiKey && process.env.NODE_ENV === 'production') {
    return new OpenAI({
      apiKey: 'dummy_key_for_build_time',
    });
  }

  return new OpenAI({
    apiKey: apiKey || 'missing_api_key',
  });
};

export const openai = getOpenAIClient();
