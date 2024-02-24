import { publicSDK } from '@devrev/typescript-sdk';
import * as gplay from 'google-play-scraper';
import { LLMUtils } from './llm_utils';
import { ApiUtils, HTTPResponse } from './utils';

export const run = async (events: any[]) => {
  for (const event of events) {
    const endpoint: string = event.execution_metadata.devrev_endpoint;
    const token: string = event.context.secrets.service_account_token;
    const fireWorksApiKey: string = event.input_data.keyrings.fireworks_api_key;
    const apiUtil: ApiUtils = new ApiUtils(endpoint, token);
    // Get the number of reviews to fetch from command args.
    const snapInId = event.context.snap_in_id;
    const devrevPAT = event.context.secrets.service_account_token;
    const baseURL = event.execution_metadata.devrev_endpoint;
    const inputs = event.input_data.global_values;
    let parameters: string = event.payload.parameters.trim();
    const tags = event.input_data.resources.tags;
    const llmUtil: LLMUtils = new LLMUtils(
      fireWorksApiKey,
      `accounts/fireworks/models/${inputs['llm_model_to_use']}`,
      200
    );
    let numReviews = 10;
    let commentID: string | undefined;
    if (parameters === 'help') {
      // Send a help message in CLI help format.
      const helpMessage = `playstore_reviews_process - Fetch reviews from Google Play Store and create tickets in DevRev.\n\nUsage: /playstore_reviews_process <number_of_reviews_to_fetch>\n\n\`number_of_reviews_to_fetch\`: Number of reviews to fetch from Google Playstore. Should be a number between 1 and 100. If not specified, it defaults to 10.`;
      let postResp = await apiUtil.postTextMessageWithVisibilityTimeout(snapInId, helpMessage, 1);
      if (!postResp.success) {
        console.error(`Error while creating timeline entry: ${postResp.message}`);
        continue;
      }
      continue;
    }
    let postResp: HTTPResponse = await apiUtil.postTextMessageWithVisibilityTimeout(
      snapInId,
      'Fetching reviews from Playstore',
      1
    );
    if (!postResp.success) {
      console.error(`Error while creating timeline entry: ${postResp.message}`);
      continue;
    }
    if (!parameters) {
      // Default to 10 reviews.
      parameters = '10';
    }
    postResp = await apiUtil.postTextMessageWithVisibilityTimeout(snapInId, `Helloooweoiwoeiwoie`, 1);
    try {
      numReviews = parseInt(parameters);

      if (!Number.isInteger(numReviews)) {
        throw new Error('Not a valid number');
      }
    } catch (err) {
      postResp = await apiUtil.postTextMessage(snapInId, 'Please enter a valid number', commentID);
      if (!postResp.success) {
        console.error(`Error while creating timeline entry: ${postResp.message}`);
        continue;
      }
      commentID = postResp.data.timeline_entry.id;
    }
    // Make sure number of reviews is <= 100.
    if (numReviews > 100) {
      postResp = await apiUtil.postTextMessage(snapInId, 'Please enter a number less than 100', commentID);
      if (!postResp.success) {
        console.error(`Error while creating timeline entry: ${postResp.message}`);
        continue;
      }
      commentID = postResp.data.timeline_entry.id;
    }
    // Call google playstore scraper to fetch those number of reviews.
    let getReviewsResponse: any = await gplay.reviews({
      appId: inputs['app_id'],
      sort: gplay.sort.RATING,
      num: numReviews,
      throttle: 10,
    });
    // Post an update about the number of reviews fetched.
    postResp = await apiUtil.postTextMessageWithVisibilityTimeout(
      snapInId,
      `Fetched ${numReviews} reviews, creating tickets now.`,
      1
    );

    if (!postResp.success) {
      console.error(`Error while creating timeline entry: ${postResp.message}`);
      continue;
    }
    commentID = postResp.data.timeline_entry.id;
    let reviews: gplay.IReviewsItem[] = getReviewsResponse.data;
    console.log(reviews[0]);

    //TODO: Counters
    let spamCounter = 0;
    let nsfwCounter = 0;
    let feedbackCounter = 0;
    let bugCounter = 0;
    let questionCounter = 0;

    // For each review, create a ticket in DevRev.
    for (const review of reviews) {
      // Post a progress message saying creating ticket for review with review URL posted.
      postResp = await apiUtil.postTextMessageWithVisibilityTimeout(
        snapInId,
        `Creating ticket for review: ${review.url}`,
        1
      );
      if (!postResp.success) {
        console.error(`Error while creating timeline entry: ${postResp.message}`);
        continue;
      }

      // TODO: SPAM FILTERING
      let llmSpamResponse = {};
      const reviewSpamText = `Ticket created from Playstore review ${review.url}\n\n${review.text}`;
      const reviewSpamTitle = review.title || `Ticket created from Playstore review ${review.url}`;
      const systemSpamPrompt = `You are an expert at Identifying Spam in Playstore Reviews. You are given a review provided by a user for the app ${inputs['app_id']}. You have to label the review as spam, nsfw or notspam. The output should be a JSON with fields "category" and "reason". The "category" field should be one of 'spam', 'nsfw' or 'notspam'. The 'reason' field should be a string explaining the reason for the category. \n\nReview: {review}\n\nOutput:`;
      const humanSpamPrompt = '';
      try {
        llmSpamResponse = await llmUtil.chatCompletion(systemSpamPrompt, humanSpamPrompt, {
          review: reviewSpamTitle ? reviewSpamTitle + '\n' + reviewSpamText : reviewSpamText,
        });
        console.log(`LLM Response: ${JSON.stringify(llmSpamResponse)}`);
      } catch (err) {
        console.error(`Error while calling LLM: ${err}`);
      }
      let inferredspam = 'notspam';
      if ('category' in llmSpamResponse) {
        inferredspam = llmSpamResponse['category'] as string;
      }
      if (inferredspam === 'spam') {
        spamCounter++;
        postResp = await apiUtil.postTextMessageWithVisibilityTimeout(
          snapInId,
          `Review is spam. Skipping ticket creation.`,
          1
        );
        if (!postResp.success) {
          console.error(`Error while creating timeline entry: ${postResp.message}`);
          continue;
        }
        continue;
      } else if (inferredspam === 'nsfw') {
        nsfwCounter++;
        postResp = await apiUtil.postTextMessageWithVisibilityTimeout(
          snapInId,
          `Review is nsfw. Skipping ticket creation.`,
          1
        );
        if (!postResp.success) {
          console.error(`Error while creating timeline entry: ${postResp.message}`);
          continue;
        }
        continue;
      }
      postResp = await apiUtil.postTextMessageWithVisibilityTimeout(snapInId, `Review is not spam.`, 1);
      if (!postResp.success) {
        console.error(`Error while creating timeline entry: ${postResp.message}`);
        continue;
      }

      // TODO: Identify computer generated reviews

      const reviewText = `Ticket created from Playstore review ${review.url}\n\n${review.text}`;
      const reviewTitle = review.title || `Ticket created from Playstore review ${review.url}`;
      const reviewID = review.id;
      const systemPrompt = `You are an expert at labelling a given Google Play Store Review as bug, feature_request, question or feedback. You are given a review provided by a user for the app ${inputs['app_id']}. You have to label the review as bug, feature_request, question or feedback. The output should be a JSON with fields "category", "summary" and "reason". The "category" field should be one of "bug", "feature_request", "question" or "feedback". The "summary" field should be a string summarizing the reviewin 20 words. The "reason" field should be a string explaining the reason for the category. \n\nReview: {review}\n\nOutput:`;
      const humanPrompt = ``;

      let llmResponse = {};
      try {
        llmResponse = await llmUtil.chatCompletion(systemPrompt, humanPrompt, {
          review: reviewTitle ? reviewTitle + '\n' + reviewText : reviewText,
        });
      } catch (err) {
        console.error(`Error while calling LLM: ${err}`);
      }
      let tagsToApply = [];
      let inferredCategory = 'failed_to_infer_category';
      if ('category' in llmResponse) {
        inferredCategory = llmResponse['category'] as string;
        if (!(inferredCategory in tags)) {
          inferredCategory = 'failed_to_infer_category';
        }
      }

      let reviewSummary = '';
      let reviewReason = '';
      if ('summary' in llmResponse) {
        reviewSummary = llmResponse['summary'] as string;
        if (!(inferredCategory in tags)) {
          reviewSummary = '';
        }
      }
      if ('reason' in llmResponse) {
        reviewReason = llmResponse['reason'] as string;
        if (!(inferredCategory in tags)) {
          reviewReason = '';
        }
      }

      // If we failed to infer the category, skip the ticket creation.
      if (inferredCategory === 'failed_to_infer_category') {
        postResp = await apiUtil.postTextMessageWithVisibilityTimeout(
          snapInId,
          `Failed to infer category of review ${reviewID}. Skipping ticket creation.`,
          1
        );
        if (!postResp.success) {
          console.error(`Error while creating timeline entry: ${postResp.message}`);
          continue;
        }
        continue;
      }

      // TODO: Duplicates should be avoided.

      // TODO: Pipeline for ticket creation.

      // TODO: Business Impact for Bugs

      if (inferredCategory === 'bug') {
        bugCounter++;
        // Create a ticket with title as review title and description as review text.
        const createTicketResp = await apiUtil.createTicket({
          title: reviewTitle,
          tags: [{ id: tags[inferredCategory].id }],
          body: reviewText,
          type: publicSDK.WorkType.Ticket,
          owned_by: [inputs['default_owner_id']],
          applies_to_part: inputs['default_part_id'],
        });
        if (!createTicketResp.success) {
          console.error(`Error while creating ticket: ${createTicketResp.message}`);
          continue;
        }
        continue;
      }

      // TODO: Duplicates should be avoided.

      // TODO: Sentiment analysis for feedback ticket.

      // TODO: Business impact for features

      // TODO: Best in each category

      // TODO: Severity for bugs, potential resolutions.

      // TODO: Identifying customer knowledge gaps.

      // TODO: Sentiment trend analysis for all feedback

      // Create a ticket with title as review title and description as review text.
      const createTicketResp = await apiUtil.createTicket({
        title: reviewTitle,
        tags: [{ id: tags[inferredCategory].id }],
        body: reviewText,
        type: publicSDK.WorkType.Ticket,
        owned_by: [inputs['default_owner_id']],
        applies_to_part: inputs['default_part_id'],
      });
      if (!createTicketResp.success) {
        console.error(`Error while creating ticket: ${createTicketResp.message}`);
        continue;
      }
      // Post a message with ticket ID.
      const ticketID = createTicketResp.data.work.id;
      const ticketCreatedMessage =
        inferredCategory != 'failed_to_infer_category'
          ? `Created ticket: <${ticketID}> and it is categorized as ${inferredCategory}`
          : `Created ticket: <${ticketID}> and it failed to be categorized`;
      const postTicketResp: HTTPResponse = await apiUtil.postTextMessageWithVisibilityTimeout(
        snapInId,
        ticketCreatedMessage,
        1
      );
      if (!postTicketResp.success) {
        console.error(`Error while creating timeline entry: ${postTicketResp.message}`);
        continue;
      }
    }
    // postResp the counters
    postResp = await apiUtil.postTextMessageWithVisibilityTimeout(
      snapInId,
      `Spam reviews: ${spamCounter}\nNSFW reviews: ${nsfwCounter}`,
      1
    );
  }
};

export default run;
