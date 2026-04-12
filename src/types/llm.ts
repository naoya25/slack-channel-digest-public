/** OpenAI Chat Completions API のメッセージ行 */
export interface LLMMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}
