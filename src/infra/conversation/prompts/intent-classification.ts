/**
 * Intent Classification Prompt
 */

export const INTENT_CLASSIFICATION_PROMPT = `You are an expert at classifying user intents in conversations.

Given a user message, classify the primary intent into one of these categories:

INTENT CATEGORIES:
- greeting: Hello, hi, good morning, etc.
- farewell: Goodbye, bye, see you later, etc.
- small_talk: Casual conversation, weather, how are you, etc.
- task_request: User wants something done (create, fix, build, help me with...)
- question: User is asking for information or explanation
- status_inquiry: User wants to know progress or status of a task
- cancellation: User wants to stop or cancel something
- confirmation: User is confirming a previous suggestion (yes, ok, proceed)
- clarification: User is providing additional details in response to a question
- feedback: User is giving feedback on a result (good, bad, not what I wanted)
- unknown: Cannot determine intent

Respond with JSON:
{
  "intent": "<category>",
  "confidence": <0.0-1.0>,
  "reasoning": "<brief explanation>"
}`;

export const EMOTION_ANALYSIS_PROMPT = `Analyze the emotional state of the user based on their message.

EMOTIONAL STATES:
- neutral: No strong emotion detected
- happy: Positive, pleased, satisfied
- frustrated: Annoyed, impatient, upset
- confused: Uncertain, puzzled, unclear
- excited: Enthusiastic, eager
- anxious: Worried, concerned, stressed
- grateful: Thankful, appreciative
- disappointed: Let down, unsatisfied

URGENCY LEVELS:
- low: No time pressure, casual request
- medium: Normal priority, reasonable timeline
- high: Important, needs attention soon
- critical: Urgent, needs immediate attention

Respond with JSON:
{
  "emotion": "<state>",
  "intensity": <0.0-1.0>,
  "urgency": "<level>",
  "indicators": ["<list of words/phrases that indicate this>"]
}`;

export const PURPOSE_EXTRACTION_PROMPT = `Extract the purpose and actionable goal from the user's message.

Determine:
1. Is this actionable? (Does the user want something done?)
2. What is the goal? (What do they want to achieve?)
3. What information is missing? (What do we need to ask?)
4. What are the success criteria? (How will we know it's done?)

Respond with JSON:
{
  "isActionable": <true/false>,
  "goal": "<extracted goal or null>",
  "missingInfo": ["<list of questions to ask>"],
  "successCriteria": ["<list of criteria>"],
  "constraints": ["<any mentioned constraints>"]
}`;
