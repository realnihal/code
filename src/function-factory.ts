import process_playstore_reviews from './functions/process_playstore_reviews';
import process_twitter_tweets from './functions/process_twitter_tweets';

export const functionFactory = {
  process_playstore_reviews,
  process_twitter_tweets,
} as const;

export type FunctionFactoryType = keyof typeof functionFactory;
