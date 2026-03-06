import type * as vscode from 'vscode';
import type { AgentState } from './types.js';

export function clearAgentActivity(
	agent: AgentState | undefined,
	agentId: number,
	_permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	webview: vscode.Webview | undefined,
): void {
	if (!agent) return;
	agent.activeToolIds.clear();
	agent.activeToolStatuses.clear();
	agent.activeToolNames.clear();
	agent.isWaiting = false;
	webview?.postMessage({ type: 'agentToolsClear', id: agentId });
	webview?.postMessage({ type: 'agentStatus', id: agentId, status: 'active' });
}

export function cancelWaitingTimer(
	agentId: number,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
): void {
	const timer = waitingTimers.get(agentId);
	if (timer) {
		clearTimeout(timer);
		waitingTimers.delete(agentId);
	}
}

export function startWaitingTimer(
	agentId: number,
	delayMs: number,
	agents: Map<number, AgentState>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	webview: vscode.Webview | undefined,
): void {
	cancelWaitingTimer(agentId, waitingTimers);
	const timer = setTimeout(() => {
		waitingTimers.delete(agentId);
		const agent = agents.get(agentId);
		if (agent) {
			agent.isWaiting = true;
		}
		webview?.postMessage({
			type: 'agentStatus',
			id: agentId,
			status: 'waiting',
		});
	}, delayMs);
	waitingTimers.set(agentId, timer);
}

export function cancelPermissionTimer(
	agentId: number,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
): void {
	const timer = permissionTimers.get(agentId);
	if (timer) {
		clearTimeout(timer);
		permissionTimers.delete(agentId);
	}
}

export function startPermissionTimer(
	_agentId: number,
	_agents: Map<number, AgentState>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	_permissionExemptTools: Set<string>,
	_webview: vscode.Webview | undefined,
): void {
	// Codex v1: no permission-wait signal is currently emitted in session logs.
	// Keep the function as a no-op for call-site compatibility.
	permissionTimers.clear();
}
