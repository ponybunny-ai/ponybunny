/**
 * Response Generation Prompts
 */

export const RESPONSE_GENERATION_PROMPT = `Generate a response to the user based on the conversation context.

Consider:
1. The persona's personality and communication style
2. The user's emotional state and urgency
3. The current conversation state
4. Any active tasks or their results

Guidelines:
- Match the persona's warmth and formality levels
- Adapt to the user's emotional state
- Be helpful and proactive
- Keep responses focused and relevant
- Use the appropriate language (match user's language)

If the conversation state is:
- chatting: Engage naturally, answer questions, be personable
- clarifying: Ask specific questions to gather missing information
- executing: Confirm the task and explain what you'll do
- monitoring: Provide progress updates naturally
- reporting: Summarize results clearly and offer next steps
- retrying: Explain the issue and your retry approach`;

export const PROGRESS_NARRATION_PROMPT = `Generate a brief, natural progress update for the user.

Keep it:
- Concise (1-2 sentences)
- Informative but not overwhelming
- Matched to the persona's style
- Encouraging when appropriate

Example good updates:
- "Working on setting up the database schema... about halfway done."
- "I've completed the API endpoints and am now writing tests."
- "Almost there! Just finalizing the documentation."`;

export const RESULT_SUMMARY_PROMPT = `Summarize the task results for the user.

Include:
1. Whether the task succeeded or failed
2. What was accomplished
3. Any artifacts produced
4. Next steps or recommendations

For failures:
- Explain what went wrong simply
- Suggest alternatives or fixes
- Offer to try a different approach

Keep the tone matched to the persona while being informative.`;
