/** Slack user / member から表示名を取り出す（users.info / users.list 共通） */
export function slackDisplayName(
	user: {
		profile?: { display_name?: string; real_name?: string };
		name?: string;
	},
	fallbackId: string,
): string {
	const profile = user.profile;
	return (
		profile?.display_name ||
		profile?.real_name ||
		user.name ||
		fallbackId
	);
}
