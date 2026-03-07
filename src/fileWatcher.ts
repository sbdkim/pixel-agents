import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { AgentState } from './types.js';
import { cancelWaitingTimer, cancelPermissionTimer, clearAgentActivity } from './timerManager.js';
import { processTranscriptLine } from './transcriptParser.js';
import {
	FILE_WATCHER_POLL_INTERVAL_MS,
	PROJECT_SCAN_INTERVAL_MS,
	SESSION_BIND_TIMEOUT_MS,
	SESSION_MATCH_WINDOW_MS,
	SESSION_REBIND_WINDOW_MS,
	ADOPT_RECENT_SESSION_MS,
} from './constants.js';

interface SessionMetaCacheEntry {
	mtimeMs: number;
	cwd: string | null;
	timestampMs: number | null;
}

const sessionMetaCache = new Map<string, SessionMetaCacheEntry>();

function normalizePath(input: string): string {
	return path.normalize(input).replace(/\\/g, '/').toLowerCase();
}

function listSessionFiles(sessionsRoot: string): string[] {
	const files: string[] = [];
	const stack: string[] = [sessionsRoot];
	while (stack.length > 0) {
		const current = stack.pop();
		if (!current) {
			continue;
		}
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(current, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			const fullPath = path.join(current, entry.name);
			if (entry.isDirectory()) {
				stack.push(fullPath);
			} else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
				files.push(fullPath);
			}
		}
	}
	return files;
}

function readSessionMeta(filePath: string, stat: fs.Stats): SessionMetaCacheEntry {
	const cached = sessionMetaCache.get(filePath);
	if (cached && cached.mtimeMs === stat.mtimeMs) {
		return cached;
	}

	let entry: SessionMetaCacheEntry = {
		mtimeMs: stat.mtimeMs,
		cwd: null,
		timestampMs: null,
	};

	try {
		const text = fs.readFileSync(filePath, 'utf-8');
		const firstLine = text.split('\n', 1)[0]?.trim();
		if (firstLine) {
			const firstRecord = JSON.parse(firstLine) as Record<string, unknown>;
			if (firstRecord.type === 'session_meta') {
				const payload = firstRecord.payload as Record<string, unknown> | undefined;
				const cwd = payload?.cwd;
				const ts = payload?.timestamp;
				entry.cwd = typeof cwd === 'string' ? cwd : null;
				if (typeof ts === 'string') {
					const parsed = Date.parse(ts);
					entry.timestampMs = Number.isNaN(parsed) ? null : parsed;
				}
			}
		}
	} catch {
		// leave as nulls
	}

	sessionMetaCache.set(filePath, entry);
	return entry;
}

function setAgentBindState(
	agentId: number,
	agent: AgentState,
	webview: vscode.Webview | undefined,
	reason: string | null,
): void {
	webview?.postMessage({
		type: 'agentBindState',
		id: agentId,
		bound: agent.sessionBound,
		sessionFile: agent.sessionBound ? agent.jsonlFile : null,
		reason,
	});
}

function bindAgentToFile(
	agentId: number,
	filePath: string,
	agents: Map<number, AgentState>,
	fileWatchers: Map<number, fs.FSWatcher>,
	pollingTimers: Map<number, ReturnType<typeof setInterval>>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	webview: vscode.Webview | undefined,
	persistAgents: () => void,
): void {
	const agent = agents.get(agentId);
	if (!agent) {
		return;
	}

	agent.jsonlFile = filePath;
	agent.sessionBound = true;
	agent.bindWarningSent = false;
	agent.rebindRequestedAtMs = null;
	agent.lineBuffer = '';
	for (const timer of agent.subagentTimers.values()) {
		clearTimeout(timer);
	}
	agent.subagentTimers.clear();
	for (const callId of agent.subagentStates.keys()) {
		webview?.postMessage({ type: 'subagentClear', id: agentId, parentToolId: callId });
	}
	agent.subagentStates.clear();
	try {
		const stat = fs.statSync(filePath);
		agent.fileOffset = stat.size;
	} catch {
		agent.fileOffset = 0;
	}

	persistAgents();
	console.log(`[Pixel Agents] bind_success agent=${agentId} file=${path.basename(filePath)}`);
	setAgentBindState(agentId, agent, webview, null);
	startFileWatching(agentId, filePath, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, webview, persistAgents);
}

function pickBestSessionForAgent(agent: AgentState, files: string[], usedFiles: Set<string>, now: number): string | null {
	const normalizedCwd = normalizePath(agent.cwd);
	let bestFile: string | null = null;
	let bestScore = Number.MAX_SAFE_INTEGER;

	const referenceMs = agent.rebindRequestedAtMs ?? agent.launchTimeMs;
	const lowerBound = agent.rebindRequestedAtMs
		? now - SESSION_REBIND_WINDOW_MS
		: agent.launchTimeMs - SESSION_MATCH_WINDOW_MS;

	for (const filePath of files) {
		if (usedFiles.has(filePath)) {
			continue;
		}

		let stat: fs.Stats;
		try {
			stat = fs.statSync(filePath);
		} catch {
			continue;
		}

		if (stat.mtimeMs < lowerBound || stat.mtimeMs > now + 1000) {
			continue;
		}

		const meta = readSessionMeta(filePath, stat);
		if (!meta.cwd || normalizePath(meta.cwd) !== normalizedCwd) {
			continue;
		}

		const ts = meta.timestampMs ?? stat.mtimeMs;
		const score = Math.abs(ts - referenceMs) + Math.abs(stat.mtimeMs - referenceMs);
		if (score < bestScore) {
			bestScore = score;
			bestFile = filePath;
		}
	}

	return bestFile;
}

function adoptActiveCodexTerminal(
	files: string[],
	now: number,
	nextAgentIdRef: { current: number },
	activeAgentIdRef: { current: number | null },
	agents: Map<number, AgentState>,
	fileWatchers: Map<number, fs.FSWatcher>,
	pollingTimers: Map<number, ReturnType<typeof setInterval>>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	webview: vscode.Webview | undefined,
	persistAgents: () => void,
): void {
	const terminal = vscode.window.activeTerminal;
	if (!terminal) {
		return;
	}

	for (const existing of agents.values()) {
		if (existing.terminalRef === terminal) {
			return;
		}
	}

	if (!terminal.name.toLowerCase().includes('codex')) {
		return;
	}

	let newestFile: string | null = null;
	let newestMtime = -1;
	for (const filePath of files) {
		let stat: fs.Stats;
		try {
			stat = fs.statSync(filePath);
		} catch {
			continue;
		}
		if (now - stat.mtimeMs > ADOPT_RECENT_SESSION_MS) {
			continue;
		}
		if (stat.mtimeMs > newestMtime) {
			newestMtime = stat.mtimeMs;
			newestFile = filePath;
		}
	}

	if (!newestFile) {
		return;
	}

	const workspaceCwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
	const id = nextAgentIdRef.current++;
	const agent: AgentState = {
		id,
		terminalRef: terminal,
		projectDir: path.dirname(path.dirname(path.dirname(path.dirname(newestFile)))),
		cwd: workspaceCwd,
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
	};
	agents.set(id, agent);
	activeAgentIdRef.current = id;
	persistAgents();
	console.log(`[Pixel Agents] adopted terminal "${terminal.name}" as agent ${id}`);
	webview?.postMessage({ type: 'agentCreated', id });

	bindAgentToFile(
		id,
		newestFile,
		agents,
		fileWatchers,
		pollingTimers,
		waitingTimers,
		permissionTimers,
		webview,
		persistAgents,
	);
}

export function startFileWatching(
	agentId: number,
	filePath: string,
	agents: Map<number, AgentState>,
	fileWatchers: Map<number, fs.FSWatcher>,
	pollingTimers: Map<number, ReturnType<typeof setInterval>>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	webview: vscode.Webview | undefined,
	persistAgents?: () => void,
): void {
	try {
		const watcher = fs.watch(filePath, () => {
			readNewLines(agentId, agents, waitingTimers, permissionTimers, webview, persistAgents);
		});
		fileWatchers.set(agentId, watcher);
	} catch (e) {
		console.log(`[Pixel Agents] fs.watch failed for agent ${agentId}: ${e}`);
	}

	try {
		fs.watchFile(filePath, { interval: FILE_WATCHER_POLL_INTERVAL_MS }, () => {
			readNewLines(agentId, agents, waitingTimers, permissionTimers, webview, persistAgents);
		});
	} catch (e) {
		console.log(`[Pixel Agents] fs.watchFile failed for agent ${agentId}: ${e}`);
	}

	const interval = setInterval(() => {
		if (!agents.has(agentId)) {
			clearInterval(interval);
			try {
				fs.unwatchFile(filePath);
			} catch {
				// ignore
			}
			return;
		}
		readNewLines(agentId, agents, waitingTimers, permissionTimers, webview, persistAgents);
	}, FILE_WATCHER_POLL_INTERVAL_MS);
	pollingTimers.set(agentId, interval);
}

export function readNewLines(
	agentId: number,
	agents: Map<number, AgentState>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	webview: vscode.Webview | undefined,
	persistAgents?: () => void,
): void {
	const agent = agents.get(agentId);
	if (!agent || !agent.sessionBound) {
		return;
	}
	try {
		const stat = fs.statSync(agent.jsonlFile);
		if (stat.size <= agent.fileOffset) {
			return;
		}

		const buf = Buffer.alloc(stat.size - agent.fileOffset);
		const fd = fs.openSync(agent.jsonlFile, 'r');
		fs.readSync(fd, buf, 0, buf.length, agent.fileOffset);
		fs.closeSync(fd);
		agent.fileOffset = stat.size;

		const text = agent.lineBuffer + buf.toString('utf-8');
		const lines = text.split('\n');
		agent.lineBuffer = lines.pop() || '';

		for (const line of lines) {
			if (!line.trim()) {
				continue;
			}
			processTranscriptLine(agentId, line, agents, waitingTimers, permissionTimers, webview, persistAgents);
		}
	} catch (e) {
		console.log(`[Pixel Agents] read_error agent=${agentId} file=${path.basename(agent.jsonlFile)} err=${String(e)}`);
	}
}

export function ensureProjectScan(
	projectDir: string,
	knownJsonlFiles: Set<string>,
	projectScanTimerRef: { current: ReturnType<typeof setInterval> | null },
	activeAgentIdRef: { current: number | null },
	nextAgentIdRef: { current: number },
	agents: Map<number, AgentState>,
	fileWatchers: Map<number, fs.FSWatcher>,
	pollingTimers: Map<number, ReturnType<typeof setInterval>>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	webview: vscode.Webview | undefined,
	persistAgents: () => void,
): void {
	if (projectScanTimerRef.current) {
		return;
	}

	projectScanTimerRef.current = setInterval(() => {
		scanForNewJsonlFiles(
			projectDir,
			knownJsonlFiles,
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
	}, PROJECT_SCAN_INTERVAL_MS);
}

export function triggerProjectScanNow(
	projectDir: string,
	knownJsonlFiles: Set<string>,
	activeAgentIdRef: { current: number | null },
	nextAgentIdRef: { current: number },
	agents: Map<number, AgentState>,
	fileWatchers: Map<number, fs.FSWatcher>,
	pollingTimers: Map<number, ReturnType<typeof setInterval>>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	webview: vscode.Webview | undefined,
	persistAgents: () => void,
): void {
	scanForNewJsonlFiles(
		projectDir,
		knownJsonlFiles,
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

function scanForNewJsonlFiles(
	projectDir: string,
	knownJsonlFiles: Set<string>,
	activeAgentIdRef: { current: number | null },
	nextAgentIdRef: { current: number },
	agents: Map<number, AgentState>,
	fileWatchers: Map<number, fs.FSWatcher>,
	pollingTimers: Map<number, ReturnType<typeof setInterval>>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	webview: vscode.Webview | undefined,
	persistAgents: () => void,
): void {
	if (!fs.existsSync(projectDir)) {
		return;
	}
	const files = listSessionFiles(projectDir);
	for (const file of files) {
		knownJsonlFiles.add(file);
	}

	const now = Date.now();
	const boundFiles = new Set<string>();
	for (const agent of agents.values()) {
		if (agent.sessionBound) {
			boundFiles.add(agent.jsonlFile);
		}
	}

	let unboundCount = 0;
	for (const [agentId, agent] of agents) {
		if (agent.sessionBound) {
			continue;
		}
		unboundCount += 1;

		console.log(`[Pixel Agents] bind_attempt agent=${agentId} cwd=${agent.cwd}`);
		const bestFile = pickBestSessionForAgent(agent, files, boundFiles, now);
		if (bestFile) {
			bindAgentToFile(
				agentId,
				bestFile,
				agents,
				fileWatchers,
				pollingTimers,
				waitingTimers,
				permissionTimers,
				webview,
				persistAgents,
			);
			boundFiles.add(bestFile);
			continue;
		}

		if (!agent.bindWarningSent && now - agent.launchTimeMs > SESSION_BIND_TIMEOUT_MS) {
			agent.bindWarningSent = true;
			console.log(`[Pixel Agents] bind_timeout agent=${agentId}`);
			vscode.window.showWarningMessage(
				`Pixel Agents: Timed out waiting for a Codex session for terminal "${agent.terminalRef.name}". Start Codex in that terminal and click Retry in Debug View.`,
			);
			setAgentBindState(agentId, agent, webview, 'timeout');
			persistAgents();
		}
	}

	if (unboundCount === 0) {
		adoptActiveCodexTerminal(
			files,
			now,
			nextAgentIdRef,
			activeAgentIdRef,
			agents,
			fileWatchers,
			pollingTimers,
			waitingTimers,
			permissionTimers,
			webview,
			persistAgents,
		);
	}
}

export function reassignAgentToFile(
	agentId: number,
	newFilePath: string,
	agents: Map<number, AgentState>,
	fileWatchers: Map<number, fs.FSWatcher>,
	pollingTimers: Map<number, ReturnType<typeof setInterval>>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	webview: vscode.Webview | undefined,
	persistAgents: () => void,
): void {
	const agent = agents.get(agentId);
	if (!agent) {
		return;
	}

	fileWatchers.get(agentId)?.close();
	fileWatchers.delete(agentId);
	const pt = pollingTimers.get(agentId);
	if (pt) {
		clearInterval(pt);
	}
	pollingTimers.delete(agentId);
	try {
		fs.unwatchFile(agent.jsonlFile);
	} catch {
		// ignore
	}

	cancelWaitingTimer(agentId, waitingTimers);
	cancelPermissionTimer(agentId, permissionTimers);
	for (const timer of agent.subagentTimers.values()) {
		clearTimeout(timer);
	}
	agent.subagentTimers.clear();
	for (const callId of agent.subagentStates.keys()) {
		webview?.postMessage({ type: 'subagentClear', id: agentId, parentToolId: callId });
	}
	agent.subagentStates.clear();
	clearAgentActivity(agent, agentId, permissionTimers, webview);

	agent.jsonlFile = newFilePath;
	agent.sessionBound = true;
	agent.fileOffset = 0;
	agent.lineBuffer = '';
	persistAgents();

	startFileWatching(agentId, newFilePath, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, webview, persistAgents);
	readNewLines(agentId, agents, waitingTimers, permissionTimers, webview, persistAgents);
}
