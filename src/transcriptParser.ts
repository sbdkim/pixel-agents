import type * as vscode from 'vscode';
import type { AgentState } from './types.js';
import { AGENT_PROVIDERS } from './provider.js';
import { processClaudeTranscriptLine } from './transcriptParserClaude.js';
import { processCodexTranscriptLine } from './transcriptParserCodex.js';

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

	if (agent.provider === AGENT_PROVIDERS.codex) {
		processCodexTranscriptLine(agentId, line, agents, waitingTimers, permissionTimers, webview);
		return;
	}

	processClaudeTranscriptLine(agentId, line, agents, waitingTimers, permissionTimers, webview);
}
