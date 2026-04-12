import { SlackAPIClient } from 'slack-cloudflare-workers';

/** Bot トークンから Slack API クライアントを生成する */
export function createSlackClient(token: string): SlackAPIClient {
	return new SlackAPIClient(token);
}
