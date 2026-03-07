import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync } from 'child_process';
import * as vscode from 'vscode';
import type { AgentState, PersistedAgent, PersistedSubagentState, SubagentRuntimeState } from './types.js';
import { cancelWaitingTimer, cancelPermissionTimer } from './timerManager.js';
import { startFileWatching, ensureProjectScan } from './fileWatcher.js';
import { SUBAGENT_HISTORY_MAX, SUBAGENT_TIMEOUT_MS, TERMINAL_NAME_PREFIX, WORKSPACE_KEY_AGENTS, WORKSPACE_KEY_AGENT_SEATS } from './constants.js';
import { migrateAndLoadLayout } from './layoutPersistence.js';
import { scheduleSubagentTimeout } from './transcriptParser.js';

function isTerminalSubagentState(state: string): boolean {
	return state === 'done' || state === 'orphaned' || state === 'expired';
}

export function getProjectDirPath(): string {
	return path.join(os.homedir(), '.codex', 'sessions');
}

function commandExists(command: string): boolean {
	const probe = process.platform === 'win32'
		? spawnSync('where', [command], { encoding: 'utf8' })
		: spawnSync('which', [command], { encoding: 'utf8' });
	return probe.status === 0;
}

function resolveCodexLaunchCommand(): string {
	if (process.platform === 'win32') {
		if (commandExists('codex.cmd')) {
			return 'codex.cmd';
		}
		if (commandExists('codex')) {
			return 'codex';
		}
		return 'codex.cmd';
	}
	return 'codex';
}

export async function launchNewTerminal(
	nextAgentIdRef: { current: number },
	nextTerminalIndexRef: { current: number },
	agents: Map<number, AgentState>,
	activeAgentIdRef: { current: number | null },
	knownJsonlFiles: Set<string>,
	fileWatchers: Map<number, fs.FSWatcher>,
	pollingTimers: Map<number, ReturnType<typeof setInterval>>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	_jsonlPollTimers: Map<number, ReturnType<typeof setInterval>>,
	projectScanTimerRef: { current: ReturnType<typeof setInterval> | null },
	webview: vscode.Webview | undefined,
	persistAgents: () => void,
	folderPath?: string,
): Promise<void> {
	const folders = vscode.workspace.workspaceFolders;
	const cwd = folderPath || folders?.[0]?.uri.fsPath;
	if (!cwd) {
		vscode.window.showWarningMessage('Pixel Agents: Open a workspace folder before starting an agent.');
		return;
	}
	const isMultiRoot = !!(folders && folders.length > 1);
	const idx = nextTerminalIndexRef.current++;
	const terminal = vscode.window.createTerminal({
		name: `${TERMINAL_NAME_PREFIX} #${idx}`,
		cwd,
	});
	terminal.show();
	const launchCommand = resolveCodexLaunchCommand();
	console.log(`[Pixel Agents] Launch command: ${launchCommand}`);
	terminal.sendText(launchCommand);

	const id = nextAgentIdRef.current++;
	const folderName = isMultiRoot ? path.basename(cwd) : undefined;
	const projectDir = getProjectDirPath();
	const now = Date.now();
	const agent: AgentState = {
		id,
		terminalRef: terminal,
		projectDir,
		cwd,
		jsonlFile: '',
		sessionBound: false,
		launchTimeMs: now,
		bindWarningSent: false,
		rebindRequestedAtMs: null,
		lastEvent: null,
		lastEventAtMs: null,
		fileOffset: 0,
		lineBuffer: '',
		activeToolIds: new Set(),
		activeToolStatuses: new Map(),
		activeToolNames: new Map(),
		subagentStates: new Map(),
		subagentTimers: new Map(),
		subagentHistory: [],
		isWaiting: false,
		folderName,
	};

	agents.set(id, agent);
	activeAgentIdRef.current = id;
	persistAgents();
	console.log(`[Pixel Agents] Agent ${id}: created for terminal ${terminal.name}`);
	webview?.postMessage({ type: 'agentCreated', id, folderName });
	webview?.postMessage({ type: 'agentBindState', id, bound: false, sessionFile: null, reason: 'pending' });

	ensureProjectScan(
		projectDir,
		knownJsonlFiles,
		projectScanTimerRef,
		activeAgentIdRef,
		nextAgentIdRef,
		agents,
		fileWatchers,
		pollingTimers,
		waitingTimers,
		permissionTimers,
		webview,
		persistAgents,
	);
}

export function removeAgent(
	agentId: number,
	agents: Map<number, AgentState>,
	fileWatchers: Map<number, fs.FSWatcher>,
	pollingTimers: Map<number, ReturnType<typeof setInterval>>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	jsonlPollTimers: Map<number, ReturnType<typeof setInterval>>,
	persistAgents: () => void,
): void {
	const agent = agents.get(agentId);
	if (!agent) {
		return;
	}

	const jpTimer = jsonlPollTimers.get(agentId);
	if (jpTimer) {
		clearInterval(jpTimer);
	}
	jsonlPollTimers.delete(agentId);

	fileWatchers.get(agentId)?.close();
	fileWatchers.delete(agentId);
	const pt = pollingTimers.get(agentId);
	if (pt) {
		clearInterval(pt);
	}
	pollingTimers.delete(agentId);
	if (agent.jsonlFile) {
		try {
			fs.unwatchFile(agent.jsonlFile);
		} catch {
			// ignore
		}
	}

	cancelWaitingTimer(agentId, waitingTimers);
	cancelPermissionTimer(agentId, permissionTimers);
	for (const timer of agent.subagentTimers.values()) {
		clearTimeout(timer);
	}
	agent.subagentTimers.clear();

	agents.delete(agentId);
	persistAgents();
}

export function persistAgents(
	agents: Map<number, AgentState>,
	context: vscode.ExtensionContext,
): void {
	const persisted: PersistedAgent[] = [];
	for (const agent of agents.values()) {
		const subagents: PersistedSubagentState[] = [];
		for (const state of agent.subagentStates.values()) {
			if (isTerminalSubagentState(state.state)) {
				continue;
			}
			subagents.push({
				callId: state.callId,
				label: state.label,
				status: state.status,
				state: state.state,
				startedAtMs: state.startedAtMs,
				updatedAtMs: state.updatedAtMs,
			});
		}
		persisted.push({
			id: agent.id,
			terminalName: agent.terminalRef.name,
			cwd: agent.cwd,
			jsonlFile: agent.jsonlFile,
			sessionBound: agent.sessionBound,
			launchTimeMs: agent.launchTimeMs,
			projectDir: agent.projectDir,
			subagents,
			folderName: agent.folderName,
		});
	}
	context.workspaceState.update(WORKSPACE_KEY_AGENTS, persisted);
}

export function restoreAgents(
	context: vscode.ExtensionContext,
	nextAgentIdRef: { current: number },
	nextTerminalIndexRef: { current: number },
	agents: Map<number, AgentState>,
	knownJsonlFiles: Set<string>,
	fileWatchers: Map<number, fs.FSWatcher>,
	pollingTimers: Map<number, ReturnType<typeof setInterval>>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	_jsonlPollTimers: Map<number, ReturnType<typeof setInterval>>,
	projectScanTimerRef: { current: ReturnType<typeof setInterval> | null },
	activeAgentIdRef: { current: number | null },
	webview: vscode.Webview | undefined,
	doPersist: () => void,
): void {
	const persisted = context.workspaceState.get<PersistedAgent[]>(WORKSPACE_KEY_AGENTS, []);
	if (persisted.length === 0) {
		return;
	}

	const liveTerminals = vscode.window.terminals;
	let maxId = 0;
	let maxIdx = 0;

	for (const p of persisted) {
		const terminal = liveTerminals.find(t => t.name === p.terminalName);
		if (!terminal) {
			continue;
		}

		const restoredSubagents = new Map<string, SubagentRuntimeState>();
		for (const sub of (p.subagents || [])) {
			if (isTerminalSubagentState(sub.state)) {
				continue;
			}
			restoredSubagents.set(sub.callId, {
				callId: sub.callId,
				label: sub.label,
				status: sub.status,
				state: sub.state,
				startedAtMs: sub.startedAtMs,
				updatedAtMs: sub.updatedAtMs,
			});
		}
		const agent: AgentState = {
			id: p.id,
			terminalRef: terminal,
			projectDir: p.projectDir || getProjectDirPath(),
			cwd: p.cwd,
			jsonlFile: p.jsonlFile,
			sessionBound: p.sessionBound && !!p.jsonlFile,
			launchTimeMs: p.launchTimeMs || Date.now(),
			bindWarningSent: false,
			rebindRequestedAtMs: null,
			lastEvent: null,
			lastEventAtMs: null,
			fileOffset: 0,
			lineBuffer: '',
			activeToolIds: new Set(),
			activeToolStatuses: new Map(),
			activeToolNames: new Map(),
			subagentStates: restoredSubagents,
			subagentTimers: new Map(),
			subagentHistory: [],
			isWaiting: false,
			folderName: p.folderName,
		};
		for (const sub of restoredSubagents.values()) {
			if (sub.state === 'active' || sub.state === 'started') {
				const remaining = Math.max(1, SUBAGENT_TIMEOUT_MS - (Date.now() - sub.updatedAtMs));
				scheduleSubagentTimeout(p.id, sub.callId, remaining, agents, webview, doPersist);
			}
		}

		agents.set(p.id, agent);
		if (agent.sessionBound && agent.jsonlFile) {
			knownJsonlFiles.add(agent.jsonlFile);
		}
		console.log(`[Pixel Agents] Restored agent ${p.id} -> terminal "${p.terminalName}"`);

		if (p.id > maxId) {
			maxId = p.id;
		}
		const match = p.terminalName.match(/#(\d+)$/);
		if (match) {
			const idx = parseInt(match[1], 10);
			if (idx > maxIdx) {
				maxIdx = idx;
			}
		}

		if (agent.sessionBound && agent.jsonlFile) {
			try {
				if (fs.existsSync(agent.jsonlFile)) {
					const stat = fs.statSync(agent.jsonlFile);
					agent.fileOffset = stat.size;
					startFileWatching(p.id, agent.jsonlFile, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, webview, doPersist);
					webview?.postMessage({ type: 'agentBindState', id: p.id, bound: true, sessionFile: agent.jsonlFile, reason: null });
				} else {
					agent.sessionBound = false;
					agent.jsonlFile = '';
					agent.subagentStates.clear();
					webview?.postMessage({ type: 'agentBindState', id: p.id, bound: false, sessionFile: null, reason: 'missing' });
				}
			} catch {
				agent.sessionBound = false;
				agent.jsonlFile = '';
				agent.subagentStates.clear();
				webview?.postMessage({ type: 'agentBindState', id: p.id, bound: false, sessionFile: null, reason: 'missing' });
			}
		}
	}

	if (maxId >= nextAgentIdRef.current) {
		nextAgentIdRef.current = maxId + 1;
	}
	if (maxIdx >= nextTerminalIndexRef.current) {
		nextTerminalIndexRef.current = maxIdx + 1;
	}

	doPersist();

	ensureProjectScan(
		getProjectDirPath(),
		knownJsonlFiles,
		projectScanTimerRef,
		activeAgentIdRef,
		nextAgentIdRef,
		agents,
		fileWatchers,
		pollingTimers,
		waitingTimers,
		permissionTimers,
		webview,
		doPersist,
	);
}

export function sendExistingAgents(
	agents: Map<number, AgentState>,
	context: vscode.ExtensionContext,
	webview: vscode.Webview | undefined,
): void {
	if (!webview) {
		return;
	}
	const agentIds: number[] = [];
	for (const id of agents.keys()) {
		agentIds.push(id);
	}
	agentIds.sort((a, b) => a - b);

	const agentMeta = context.workspaceState.get<Record<string, { palette?: number; seatId?: string }>>(WORKSPACE_KEY_AGENT_SEATS, {});

	const folderNames: Record<number, string> = {};
	const bindStates: Record<number, { bound: boolean; sessionFile: string | null; reason: string | null }> = {};
	const subagentStates: Record<number, PersistedSubagentState[]> = {};
	for (const [id, agent] of agents) {
		if (agent.folderName) {
			folderNames[id] = agent.folderName;
		}
		bindStates[id] = {
			bound: agent.sessionBound,
			sessionFile: agent.sessionBound ? agent.jsonlFile : null,
			reason: agent.sessionBound ? null : (agent.bindWarningSent ? 'timeout' : 'pending'),
		};
		subagentStates[id] = Array.from(agent.subagentStates.values())
			.filter((sub) => !isTerminalSubagentState(sub.state))
			.slice(-SUBAGENT_HISTORY_MAX)
			.map((sub) => ({
				callId: sub.callId,
				label: sub.label,
				status: sub.status,
				state: sub.state,
				startedAtMs: sub.startedAtMs,
				updatedAtMs: sub.updatedAtMs,
			}));
	}

	webview.postMessage({
		type: 'existingAgents',
		agents: agentIds,
		agentMeta,
		folderNames,
		bindStates,
		subagentStates,
	});

	sendCurrentAgentStatuses(agents, webview);
}

export function sendCurrentAgentStatuses(
	agents: Map<number, AgentState>,
	webview: vscode.Webview | undefined,
): void {
	if (!webview) {
		return;
	}
	for (const [agentId, agent] of agents) {
		for (const [toolId, status] of agent.activeToolStatuses) {
			webview.postMessage({
				type: 'agentToolStart',
				id: agentId,
				toolId,
				status,
			});
		}
		if (agent.isWaiting) {
			webview.postMessage({
				type: 'agentStatus',
				id: agentId,
				status: 'waiting',
			});
		}
		for (const sub of agent.subagentStates.values()) {
			if (isTerminalSubagentState(sub.state)) {
				continue;
			}
			webview.postMessage({
				type: 'subagentToolStart',
				id: agentId,
				parentToolId: sub.callId,
				toolId: sub.callId,
				status: sub.status,
				label: sub.label,
				lifecycle: sub.state,
			});
		}
	}
}

export function sendLayout(
	context: vscode.ExtensionContext,
	webview: vscode.Webview | undefined,
	defaultLayout?: Record<string, unknown> | null,
): void {
	if (!webview) {
		return;
	}
	const layout = migrateAndLoadLayout(context, defaultLayout);
	webview.postMessage({
		type: 'layoutLoaded',
		layout,
	});
}
