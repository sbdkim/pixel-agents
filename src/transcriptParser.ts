import * as path from 'path';
import type * as vscode from 'vscode';
import type { AgentState, SubagentRuntimeState } from './types.js';
import {
	cancelWaitingTimer,
	clearAgentActivity,
	cancelPermissionTimer,
} from './timerManager.js';
import {
	TOOL_DONE_DELAY_MS,
	BASH_COMMAND_DISPLAY_MAX_LENGTH,
	TASK_DESCRIPTION_DISPLAY_MAX_LENGTH,
	SUBAGENT_DONE_CLEAR_DELAY_MS,
	SUBAGENT_HISTORY_MAX,
	SUBAGENT_ORPHAN_CLEAR_DELAY_MS,
	SUBAGENT_TIMEOUT_MS,
} from './constants.js';

export const PERMISSION_EXEMPT_TOOLS = new Set<string>();

function emitDebugEvent(agentId: number, agent: AgentState, event: string, webview: vscode.Webview | undefined): void {
	agent.lastEvent = event;
	agent.lastEventAtMs = Date.now();
	webview?.postMessage({ type: 'agentDebugEvent', id: agentId, event, atMs: agent.lastEventAtMs });
}

function parseArguments(raw: unknown): Record<string, unknown> {
	if (typeof raw !== 'string') {
		return {};
	}
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

function rememberSubagent(agent: AgentState, state: SubagentRuntimeState): void {
	agent.subagentHistory.push({ ...state });
	if (agent.subagentHistory.length > SUBAGENT_HISTORY_MAX) {
		agent.subagentHistory.splice(0, agent.subagentHistory.length - SUBAGENT_HISTORY_MAX);
	}
}

function sendSubagentStart(agentId: number, state: SubagentRuntimeState, webview: vscode.Webview | undefined): void {
	webview?.postMessage({
		type: 'subagentToolStart',
		id: agentId,
		parentToolId: state.callId,
		toolId: state.callId,
		status: state.status,
		label: state.label,
		lifecycle: state.state,
	});
}

function sendSubagentDone(agentId: number, state: SubagentRuntimeState, webview: vscode.Webview | undefined): void {
	webview?.postMessage({
		type: 'subagentToolDone',
		id: agentId,
		parentToolId: state.callId,
		toolId: state.callId,
		lifecycle: state.state,
	});
}

function sendSubagentClear(agentId: number, callId: string, webview: vscode.Webview | undefined): void {
	webview?.postMessage({ type: 'subagentClear', id: agentId, parentToolId: callId });
}

function clearSubagentTimer(agent: AgentState, callId: string): void {
	const timer = agent.subagentTimers.get(callId);
	if (timer) {
		clearTimeout(timer);
		agent.subagentTimers.delete(callId);
	}
}

function scheduleSubagentClear(agentId: number, callId: string, delayMs: number, agents: Map<number, AgentState>, webview: vscode.Webview | undefined): void {
	setTimeout(() => {
		const agent = agents.get(agentId);
		if (!agent) {
			return;
		}
		agent.subagentStates.delete(callId);
		clearSubagentTimer(agent, callId);
		sendSubagentClear(agentId, callId, webview);
	}, delayMs);
}

export function scheduleSubagentTimeout(
	agentId: number,
	callId: string,
	delayMs: number,
	agents: Map<number, AgentState>,
	webview: vscode.Webview | undefined,
	persistAgents?: () => void,
): void {
	const agent = agents.get(agentId);
	if (!agent) {
		return;
	}
	clearSubagentTimer(agent, callId);
	const timer = setTimeout(() => {
		agent.subagentTimers.delete(callId);
		const current = agent.subagentStates.get(callId);
		if (!current) {
			return;
		}
		if (current.state === 'done' || current.state === 'expired' || current.state === 'orphaned') {
			return;
		}
		current.state = 'expired';
		current.updatedAtMs = Date.now();
		rememberSubagent(agent, current);
		persistAgents?.();
		sendSubagentDone(agentId, current, webview);
		emitDebugEvent(agentId, agent, `subagent_expired:${callId}`, webview);
		scheduleSubagentClear(agentId, callId, SUBAGENT_ORPHAN_CLEAR_DELAY_MS, agents, webview);
	}, delayMs);
	agent.subagentTimers.set(callId, timer);
}

function finalizeSubagent(
	agentId: number,
	callId: string,
	state: 'done' | 'orphaned' | 'expired',
	agents: Map<number, AgentState>,
	webview: vscode.Webview | undefined,
): void {
	const agent = agents.get(agentId);
	if (!agent) {
		return;
	}
	const current = agent.subagentStates.get(callId);
	if (!current) {
		return;
	}
	clearSubagentTimer(agent, callId);
	current.state = state;
	current.updatedAtMs = Date.now();
	rememberSubagent(agent, current);
	sendSubagentDone(agentId, current, webview);
	const clearDelay = state === 'done' ? SUBAGENT_DONE_CLEAR_DELAY_MS : SUBAGENT_ORPHAN_CLEAR_DELAY_MS;
	scheduleSubagentClear(agentId, callId, clearDelay, agents, webview);
}

function clearAllSubagents(
	agentId: number,
	agent: AgentState,
	state: 'expired' | 'orphaned',
	agents: Map<number, AgentState>,
	webview: vscode.Webview | undefined,
): void {
	for (const [callId, sub] of agent.subagentStates) {
		if (sub.state === 'done' || sub.state === 'expired' || sub.state === 'orphaned') {
			continue;
		}
		finalizeSubagent(agentId, callId, state, agents, webview);
	}
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
		case 'Read':
			return `Reading ${base(input.file_path)}`;
		case 'Edit':
			return `Editing ${base(input.file_path)}`;
		case 'Write':
			return `Writing ${base(input.file_path)}`;
		case 'Task': {
			const desc = typeof input.description === 'string' ? input.description : '';
			return desc
				? `Task: ${desc.length > TASK_DESCRIPTION_DISPLAY_MAX_LENGTH ? desc.slice(0, TASK_DESCRIPTION_DISPLAY_MAX_LENGTH) + '\u2026' : desc}`
				: 'Task';
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
	persistAgents?: () => void,
): void {
	const agent = agents.get(agentId);
	if (!agent) {
		return;
	}

	try {
		const record = JSON.parse(line) as Record<string, unknown>;

		if (record.type === 'response_item') {
			const payload = record.payload as Record<string, unknown> | undefined;
			if (!payload || typeof payload.type !== 'string') {
				emitDebugEvent(agentId, agent, 'drop:response_item_invalid_payload', webview);
				return;
			}

			if (payload.type === 'function_call' && typeof payload.call_id === 'string') {
				const toolName = typeof payload.name === 'string' ? payload.name : 'tool';
				const args = parseArguments(payload.arguments);
				const status = formatToolStatus(toolName, args);
				const toolId = payload.call_id;

				if (agent.activeToolIds.has(toolId)) {
					emitDebugEvent(agentId, agent, `drop:duplicate_tool_start:${toolName}`, webview);
					if (toolName === 'Task') {
						finalizeSubagent(agentId, toolId, 'orphaned', agents, webview);
						persistAgents?.();
					}
					return;
				}

				cancelWaitingTimer(agentId, waitingTimers);
				agent.isWaiting = false;
				agent.activeToolIds.add(toolId);
				agent.activeToolStatuses.set(toolId, status);
				agent.activeToolNames.set(toolId, toolName);

				webview?.postMessage({ type: 'agentStatus', id: agentId, status: 'active' });
				webview?.postMessage({ type: 'agentToolStart', id: agentId, toolId, status });

				if (toolName === 'Task') {
					const now = Date.now();
					const description = typeof args.description === 'string' && args.description.trim().length > 0
						? args.description.trim()
						: 'Task';
					const sub: SubagentRuntimeState = {
						callId: toolId,
						label: description,
						status,
						state: 'started',
						startedAtMs: now,
						updatedAtMs: now,
					};
					agent.subagentStates.set(toolId, sub);
					sendSubagentStart(agentId, sub, webview);
					sub.state = 'active';
					sub.updatedAtMs = Date.now();
					scheduleSubagentTimeout(agentId, toolId, SUBAGENT_TIMEOUT_MS, agents, webview, persistAgents);
					persistAgents?.();
					emitDebugEvent(agentId, agent, `subagent_started:${toolId}`, webview);
				}

				emitDebugEvent(agentId, agent, `tool_start:${toolName}`, webview);
				return;
			}

			if (payload.type === 'function_call_output' && typeof payload.call_id === 'string') {
				const toolId = payload.call_id;
				const toolName = agent.activeToolNames.get(toolId) || 'unknown';
				const isKnownTool = agent.activeToolIds.has(toolId);

				if (!isKnownTool) {
					if (agent.subagentStates.has(toolId)) {
						finalizeSubagent(agentId, toolId, 'orphaned', agents, webview);
						persistAgents?.();
						emitDebugEvent(agentId, agent, `subagent_orphan_output:${toolId}`, webview);
						return;
					}
					emitDebugEvent(agentId, agent, `drop:orphan_tool_output:${toolId}`, webview);
					return;
				}

				agent.activeToolIds.delete(toolId);
				agent.activeToolStatuses.delete(toolId);
				agent.activeToolNames.delete(toolId);
				setTimeout(() => {
					webview?.postMessage({ type: 'agentToolDone', id: agentId, toolId });
				}, TOOL_DONE_DELAY_MS);

				if (toolName === 'Task' && agent.subagentStates.has(toolId)) {
					finalizeSubagent(agentId, toolId, 'done', agents, webview);
					persistAgents?.();
					emitDebugEvent(agentId, agent, `subagent_done:${toolId}`, webview);
				}

				emitDebugEvent(agentId, agent, `tool_done:${toolName}`, webview);
				return;
			}
		}

		if (record.type === 'event_msg') {
			const payload = record.payload as Record<string, unknown> | undefined;
			const eventType = typeof payload?.type === 'string' ? payload.type : null;
			if (!eventType) {
				emitDebugEvent(agentId, agent, 'drop:event_msg_invalid_payload', webview);
				return;
			}
			if (eventType === 'task_started' || eventType === 'user_message') {
				cancelWaitingTimer(agentId, waitingTimers);
				cancelPermissionTimer(agentId, permissionTimers);
				agent.isWaiting = false;
				webview?.postMessage({ type: 'agentStatus', id: agentId, status: 'active' });
				emitDebugEvent(agentId, agent, `event:${eventType}`, webview);
				return;
			}
			if (eventType === 'task_complete') {
				cancelWaitingTimer(agentId, waitingTimers);
				cancelPermissionTimer(agentId, permissionTimers);
				clearAllSubagents(agentId, agent, 'expired', agents, webview);
				persistAgents?.();
				clearAgentActivity(agent, agentId, permissionTimers, webview);
				agent.isWaiting = true;
				webview?.postMessage({ type: 'agentStatus', id: agentId, status: 'waiting' });
				emitDebugEvent(agentId, agent, 'event:task_complete', webview);
				return;
			}

			emitDebugEvent(agentId, agent, `drop:unknown_event:${eventType}`, webview);
			return;
		}

		emitDebugEvent(agentId, agent, `drop:unknown_record:${String(record.type)}`, webview);
	} catch {
		emitDebugEvent(agentId, agent, 'drop:malformed_json', webview);
	}
}
