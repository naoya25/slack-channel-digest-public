import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
	eslint.configs.recommended,
	...tseslint.configs.recommended,
	{
		ignores: ['**/node_modules/**', 'worker-configuration.d.ts', '.wrangler/**'],
	},
	{
		files: ['src/**/*.ts'],
	},
);
