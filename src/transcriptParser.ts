import * as path from 'path';
import type * as vscode from 'vscode';
import type { AgentState } from './types.js';
import {
	cancelWaitingTimer,
	clearAgentActivity,
	cancelPermissionTimer,
} from './timerManager.js';
import {
	TOOL_DONE_DELAY_MS,
	BASH_COMMAND_DISPLAY_MAX_LENGTH,
	TASK_DESCRIPTION_DISPLAY_MAX_LENGTH,
} from './constants.js';

export const PERMISSION_EXEMPT_TOOLS = new Set<string>();

function parseArguments(raw: unknown): Record<string, unknown> {
	if (typeof raw !== 'string') return {};
	try {
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed === 'object') {
			return parsed as Record<string, unknown>;
		}
	} catch {
		// ignore parse failures
	}
	return {};
}

export function formatToolStatus(toolName: string, input: Record<string, unknown>): string {
	const base = (p: unknown) => typeof p === 'string' ? path.basename(p) : '';
	switch (toolName) {
		case 'shell_command': {
			const cmd = (input.command as string) || '';
			return `Running: ${cmd.length > BASH_COMMAND_DISPLAY_MAX_LENGTH ? cmd.slice(0, BASH_COMMAND_DISPLAY_MAX_LENGTH) + '\u2026' : cmd}`;
		}
		case 'multi_tool_use.parallel':
			return 'Running parallel tools';
		case 'web.search_query':
		case 'web.open':
		case 'web.click':
		case 'web.find':
			return 'Browsing the web';
		case 'functions.request_user_input':
			return 'Waiting for your input';
		case 'functions.apply_patch':
			return 'Applying patch';
		case 'Read': return `Reading ${base(input.file_path)}`;
		case 'Edit': return `Editing ${base(input.file_path)}`;
		case 'Write': return `Writing ${base(input.file_path)}`;
		case 'Task': {
			const desc = typeof input.description === 'string' ? input.description : '';
			return desc ? `Task: ${desc.length > TASK_DESCRIPTION_DISPLAY_MAX_LENGTH ? desc.slice(0, TASK_DESCRIPTION_DISPLAY_MAX_LENGTH) + '\u2026' : desc}` : 'Running task';
		}
		default:
			return `Using ${toolName}`;
	}
}

export function processTranscriptLine(
	agentId: number,
	line: string,
	agents: Map<number, AgentState>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	webview: vscode.Webview | undefined,
): void {
	const agent = agents.get(agentId);
	if (!agent) return;

	try {
		const record = JSON.parse(line) as Record<string, unknown>;

		if (record.type === 'response_item') {
			const payload = record.payload as Record<string, unknown> | undefined;
			if (!payload || typeof payload.type !== 'string') return;

			if (payload.type === 'function_call' && typeof payload.call_id === 'string') {
				const toolName = typeof payload.name === 'string' ? payload.name : 'tool';
				const args = parseArguments(payload.arguments);
				const status = formatToolStatus(toolName, args);
				const toolId = payload.call_id;

				cancelWaitingTimer(agentId, waitingTimers);
				agent.isWaiting = false;
				agent.activeToolIds.add(toolId);
				agent.activeToolStatuses.set(toolId, status);
				agent.activeToolNames.set(toolId, toolName);

				webview?.postMessage({ type: 'agentStatus', id: agentId, status: 'active' });
				webview?.postMessage({ type: 'agentToolStart', id: agentId, toolId, status });
				return;
			}

			if (payload.type === 'function_call_output' && typeof payload.call_id === 'string') {
				const toolId = payload.call_id;
				agent.activeToolIds.delete(toolId);
				agent.activeToolStatuses.delete(toolId);
				agent.activeToolNames.delete(toolId);
				setTimeout(() => {
					webview?.postMessage({ type: 'agentToolDone', id: agentId, toolId });
				}, TOOL_DONE_DELAY_MS);
				return;
			}
		}

		if (record.type === 'event_msg') {
			const payload = record.payload as Record<string, unknown> | undefined;
			const eventType = payload?.type;
			if (eventType === 'task_started' || eventType === 'user_message') {
				cancelWaitingTimer(agentId, waitingTimers);
				cancelPermissionTimer(agentId, permissionTimers);
				agent.isWaiting = false;
				webview?.postMessage({ type: 'agentStatus', id: agentId, status: 'active' });
				return;
			}
			if (eventType === 'task_complete') {
				cancelWaitingTimer(agentId, waitingTimers);
				cancelPermissionTimer(agentId, permissionTimers);
				clearAgentActivity(agent, agentId, permissionTimers, webview);
				agent.isWaiting = true;
				webview?.postMessage({ type: 'agentStatus', id: agentId, status: 'waiting' });
				return;
			}
		}
	} catch {
		// Ignore malformed lines
	}
}
