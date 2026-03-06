import type * as vscode from 'vscode';

export interface AgentState {
	id: number;
	terminalRef: vscode.Terminal;
	projectDir: string;
	cwd: string;
	jsonlFile: string;
	sessionBound: boolean;
	launchTimeMs: number;
	bindWarningSent: boolean;
	fileOffset: number;
	lineBuffer: string;
	activeToolIds: Set<string>;
	activeToolStatuses: Map<string, string>;
	activeToolNames: Map<string, string>;
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
	/** Workspace folder name (only set for multi-root workspaces) */
	folderName?: string;
}
