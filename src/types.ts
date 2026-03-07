import type * as vscode from 'vscode';

export type SubagentLifecycleState = 'started' | 'active' | 'done' | 'orphaned' | 'expired';

export interface SubagentRuntimeState {
	callId: string;
	label: string;
	status: string;
	state: SubagentLifecycleState;
	startedAtMs: number;
	updatedAtMs: number;
}

export interface PersistedSubagentState {
	callId: string;
	label: string;
	status: string;
	state: SubagentLifecycleState;
	startedAtMs: number;
	updatedAtMs: number;
}

export interface AgentState {
	id: number;
	terminalRef: vscode.Terminal;
	projectDir: string;
	cwd: string;
	jsonlFile: string;
	sessionBound: boolean;
	launchTimeMs: number;
	bindWarningSent: boolean;
	rebindRequestedAtMs: number | null;
	lastEvent: string | null;
	lastEventAtMs: number | null;
	fileOffset: number;
	lineBuffer: string;
	activeToolIds: Set<string>;
	activeToolStatuses: Map<string, string>;
	activeToolNames: Map<string, string>;
	subagentStates: Map<string, SubagentRuntimeState>;
	subagentTimers: Map<string, ReturnType<typeof setTimeout>>;
	subagentHistory: SubagentRuntimeState[];
	isWaiting: boolean;
	/** Workspace folder name (only set for multi-root workspaces) */
	folderName?: string;
}

export interface PersistedAgent {
	id: number;
	terminalName: string;
	cwd: string;
	jsonlFile: string;
	sessionBound: boolean;
	launchTimeMs: number;
	projectDir: string;
	subagents?: PersistedSubagentState[];
	/** Workspace folder name (only set for multi-root workspaces) */
	folderName?: string;
}
