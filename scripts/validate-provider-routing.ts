import { strict as assert } from 'node:assert';
import { AGENT_PROVIDERS, getProviderConfig, resolveAgentProvider } from '../src/provider.js';
import { processTranscriptLine } from '../src/transcriptParser.js';
import type { AgentState } from '../src/types.js';

function makeAgent(provider: 'claude' | 'codex'): AgentState {
	return {
		id: 1,
		terminalRef: { name: 'test-terminal' } as never,
		projectDir: '/tmp',
		jsonlFile: '/tmp/test.jsonl',
		fileOffset: 0,
		lineBuffer: '',
		activeToolIds: new Set(),
		activeToolStatuses: new Map(),
		activeToolNames: new Map(),
		activeSubagentToolIds: new Map(),
		activeSubagentToolNames: new Map(),
		isWaiting: false,
		permissionSent: false,
		hadToolsInTurn: false,
		provider,
	};
}

function run() {
	assert.equal(resolveAgentProvider('codex'), AGENT_PROVIDERS.codex);
	assert.equal(resolveAgentProvider('claude'), AGENT_PROVIDERS.claude);
	assert.equal(resolveAgentProvider('unknown'), AGENT_PROVIDERS.claude);

	const codexConfig = getProviderConfig(AGENT_PROVIDERS.codex);
	assert.equal(codexConfig.buildLaunchCommand('abc'), 'codex');
	assert.equal(codexConfig.expectedSessionFilePath('/tmp/project', 'abc'), null);

	const claudeConfig = getProviderConfig(AGENT_PROVIDERS.claude);
	assert.equal(claudeConfig.buildLaunchCommand('abc'), 'claude --session-id abc');
	assert.equal(claudeConfig.expectedSessionFilePath('/tmp/project', 'abc'), '/tmp/project/abc.jsonl');

	const waitingTimers = new Map<number, ReturnType<typeof setTimeout>>();
	const permissionTimers = new Map<number, ReturnType<typeof setTimeout>>();
	const messages: Array<Record<string, unknown>> = [];
	const webview = { postMessage: (msg: Record<string, unknown>) => messages.push(msg) } as never;

	const claudeAgent = makeAgent('claude');
	const agents = new Map<number, AgentState>([[1, claudeAgent]]);
	processTranscriptLine(
		1,
		JSON.stringify({
			type: 'assistant',
			message: { content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/repo/a.ts' } }] },
		}),
		agents,
		waitingTimers,
		permissionTimers,
		webview,
	);
	assert.equal(claudeAgent.activeToolStatuses.get('t1'), 'Reading a.ts');
	assert.ok(messages.some((m) => m.type === 'agentToolStart' && m.toolId === 't1'));

	messages.length = 0;
	const codexAgent = makeAgent('codex');
	agents.set(1, codexAgent);
	processTranscriptLine(
		1,
		JSON.stringify({
			type: 'tool_call',
			id: 'c1',
			name: 'run_command',
			arguments: { command: 'npm test' },
		}),
		agents,
		waitingTimers,
		permissionTimers,
		webview,
	);
	assert.equal(codexAgent.activeToolStatuses.get('c1'), 'Running: npm test');
	assert.ok(messages.some((m) => m.type === 'agentToolStart' && m.toolId === 'c1'));

	console.log('provider routing validation passed');
}

run();
