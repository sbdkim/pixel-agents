import type * as vscode from 'vscode';
import type { AgentState } from './types.js';
import { cancelWaitingTimer, clearAgentActivity, startPermissionTimer, cancelPermissionTimer } from './timerManager.js';
import { TOOL_DONE_DELAY_MS } from './constants.js';
import { formatToolStatus, PERMISSION_EXEMPT_TOOLS, processClaudeTranscriptLine } from './transcriptParserClaude.js';

interface CodexToolRecord {
	type: 'tool_start' | 'tool_end' | 'tool_call' | 'tool_result';
	tool_id?: string;
	tool_name?: string;
	name?: string;
	id?: string;
	input?: Record<string, unknown>;
	arguments?: Record<string, unknown>;
}

interface CodexStatusRecord {
	type: 'status';
	status?: 'waiting' | 'active' | 'idle';
}

const CODEX_TOOL_NAME_MAP: Record<string, string> = {
	read_file: 'Read',
	read: 'Read',
	write_file: 'Write',
	write: 'Write',
	edit_file: 'Edit',
	edit: 'Edit',
	run_command: 'Bash',
	bash: 'Bash',
	shell: 'Bash',
	search_files: 'Glob',
	glob: 'Glob',
	grep: 'Grep',
	search_code: 'Grep',
	web_fetch: 'WebFetch',
	web_search: 'WebSearch',
	ask_user: 'AskUserQuestion',
	ask_user_question: 'AskUserQuestion',
	plan: 'EnterPlanMode',
};

function normalizeCodexToolName(name: string | undefined): string {
	if (!name) {
		return 'Tool';
	}
	const mapped = CODEX_TOOL_NAME_MAP[name.toLowerCase()];
	return mapped ?? name;
}

function isCodexToolRecord(record: unknown): record is CodexToolRecord {
	if (!record || typeof record !== 'object') {
		return false;
	}
	const v = record as { type?: unknown };
	return v.type === 'tool_start' || v.type === 'tool_end' || v.type === 'tool_call' || v.type === 'tool_result';
}

function isCodexStatusRecord(record: unknown): record is CodexStatusRecord {
	if (!record || typeof record !== 'object') {
		return false;
	}
	return (record as { type?: unknown }).type === 'status';
}

function extractToolId(record: CodexToolRecord): string | null {
	return record.tool_id ?? record.id ?? null;
}

function extractToolName(record: CodexToolRecord): string {
	return normalizeCodexToolName(record.tool_name ?? record.name);
}

function extractToolInput(record: CodexToolRecord): Record<string, unknown> {
	if (record.input && typeof record.input === 'object') {
		return record.input;
	}
	if (record.arguments && typeof record.arguments === 'object') {
		return record.arguments;
	}
	return {};
}

function handleToolStart(
	agentId: number,
	agent: AgentState,
	record: CodexToolRecord,
	agents: Map<number, AgentState>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	webview: vscode.Webview | undefined,
): void {
	const toolId = extractToolId(record);
	if (!toolId) {
		return;
	}
	const toolName = extractToolName(record);
	const status = formatToolStatus(toolName, extractToolInput(record));

	cancelWaitingTimer(agentId, waitingTimers);
	agent.isWaiting = false;
	agent.permissionSent = false;
	agent.activeToolIds.add(toolId);
	agent.activeToolNames.set(toolId, toolName);
	agent.activeToolStatuses.set(toolId, status);

	webview?.postMessage({ type: 'agentStatus', id: agentId, status: 'active' });
	webview?.postMessage({ type: 'agentToolStart', id: agentId, toolId, status });

	if (!PERMISSION_EXEMPT_TOOLS.has(toolName)) {
		startPermissionTimer(agentId, agents, permissionTimers, PERMISSION_EXEMPT_TOOLS, webview);
	}
}

function handleToolEnd(
	agentId: number,
	agent: AgentState,
	record: CodexToolRecord,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	webview: vscode.Webview | undefined,
): void {
	const toolId = extractToolId(record);
	if (!toolId) {
		return;
	}

	agent.activeToolIds.delete(toolId);
	agent.activeToolNames.delete(toolId);
	agent.activeToolStatuses.delete(toolId);
	setTimeout(() => {
		webview?.postMessage({ type: 'agentToolDone', id: agentId, toolId });
	}, TOOL_DONE_DELAY_MS);
	if (agent.activeToolIds.size === 0) {
		cancelPermissionTimer(agentId, permissionTimers);
		agent.isWaiting = true;
		agent.permissionSent = false;
		webview?.postMessage({ type: 'agentStatus', id: agentId, status: 'waiting' });
	}
}

export function processCodexTranscriptLine(
	agentId: number,
	line: string,
	agents: Map<number, AgentState>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	webview: vscode.Webview | undefined,
): void {
	const agent = agents.get(agentId);
	if (!agent) {
		return;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(line);
	} catch {
		return;
	}

	if (isCodexToolRecord(parsed)) {
		if (parsed.type === 'tool_start' || parsed.type === 'tool_call') {
			handleToolStart(agentId, agent, parsed, agents, waitingTimers, permissionTimers, webview);
			return;
		}
		handleToolEnd(agentId, agent, parsed, permissionTimers, webview);
		return;
	}

	if (isCodexStatusRecord(parsed)) {
		if (parsed.status === 'waiting' || parsed.status === 'idle') {
			cancelPermissionTimer(agentId, permissionTimers);
			agent.isWaiting = true;
			agent.permissionSent = false;
			webview?.postMessage({ type: 'agentStatus', id: agentId, status: 'waiting' });
			return;
		}
		if (parsed.status === 'active') {
			cancelWaitingTimer(agentId, waitingTimers);
			agent.isWaiting = false;
			webview?.postMessage({ type: 'agentStatus', id: agentId, status: 'active' });
			return;
		}
	}

	const maybeUserText = parsed as { type?: string; role?: string; text?: string };
	if ((maybeUserText.type === 'user' || maybeUserText.role === 'user') && typeof maybeUserText.text === 'string' && maybeUserText.text.trim()) {
		cancelWaitingTimer(agentId, waitingTimers);
		clearAgentActivity(agent, agentId, permissionTimers, webview);
		agent.hadToolsInTurn = false;
		return;
	}

	// Fallback: if Codex logs match Claude JSONL shapes, reuse Claude parser.
	processClaudeTranscriptLine(agentId, line, agents, waitingTimers, permissionTimers, webview);
}
