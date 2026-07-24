/* 
=== AI FEATURES DEPRECATED ===
The following imports and variables have been commented out as per deprecation request.

import { GoogleGenAI } from '@google/genai';

export const MAGIC_REFINE_PROMPT = \`...\`;
export const CUSTOM_REFINE_SYSTEM_PROMPT = \`...\`;
export const BREAK_MATH_PROMPT = \`...\`;
export const CLIPBOARD_FIXER_PROMPT = \`...\`;

export const processAiRequest = async ({ provider, apiKey, model, systemInstruction, prompt, temperature = 0 }) => {
    // ...
};
*/

export const MAGIC_REFINE_PROMPT = "";
export const CUSTOM_REFINE_SYSTEM_PROMPT = "";
export const BREAK_MATH_PROMPT = "";
export const CLIPBOARD_FIXER_PROMPT = "";

export const processAiRequest = async () => {
    throw new Error('AI Features are currently deprecated.');
};
