import { SlackApp } from 'slack-cloudflare-workers';
import { handleMorningCron } from './handlers/morning-cron';
import { handleEveningCron } from './handlers/evening-cron';
import { digestCommandAck, digestCommandLazy } from './slack/commands/digest';

/** 朝会 — wrangler.jsonc `triggers.crons` と文字列を一致させる（Cron は UTC） */
const MORNING_CRON = '0 21 * * *';
/** 夕会 — 同上 */
const EVENING_CRON = '0 3 * * *';

export default {
	async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(req.url);

		// 開発用: GET / でテストコマンドを表示
		if (url.pathname === '/') {
			const base = new URL(req.url);
			base.pathname = '/__scheduled';

			const morningUrl = new URL(base.href);
			morningUrl.searchParams.set('cron', MORNING_CRON);

			const eveningUrl = new URL(base.href);
			eveningUrl.searchParams.set('cron', EVENING_CRON);

			return new Response(
				[
					'Scheduled handler test commands:',
					'',
					`[Morning  / 朝会] curl "${morningUrl.href}"`,
					`[Evening  / 夕会] curl "${eveningUrl.href}"`,
				].join('\n'),
			);
		}

		// Slack イベント処理
		const app = new SlackApp({ env, signingSecret: env.SLACK_SIGNING_SECRET });
		app.command('/digest', digestCommandAck, digestCommandLazy);
		return app.run(req, ctx);
	},

	async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
		switch (controller.cron) {
			case MORNING_CRON:
				ctx.waitUntil(handleMorningCron(env));
				break;
			case EVENING_CRON:
				ctx.waitUntil(handleEveningCron(env));
				break;
			default:
				console.warn(`[index] Unknown cron expression: "${controller.cron}"`);
		}
	},
} satisfies ExportedHandler<Env>;
