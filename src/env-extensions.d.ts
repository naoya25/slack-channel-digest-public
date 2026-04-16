/**
 * wrangler.jsonc の kv_namespaces バインディングを Env に追加する。
 * `wrangler types` 実行後は worker-configuration.d.ts に自動追記されるため、このファイルは不要になる。
 */
interface Env {
	THREAD_STORE: KVNamespace;
	SLACK_SIGNING_SECRET: string;
}
