import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { AgentState } from './types.js';
import {
	launchNewTerminal,
	removeAgent,
	restoreAgents,
	persistAgents,
	sendExistingAgents,
	sendLayout,
	getProjectDirPath,
} from './agentManager.js';
import { ensureProjectScan, triggerProjectScanNow } from './fileWatcher.js';
import {
	loadFurnitureAssets,
	sendAssetsToWebview,
	loadFloorTiles,
	sendFloorTilesToWebview,
	loadWallTiles,
	sendWallTilesToWebview,
	loadCharacterSprites,
	sendCharacterSpritesToWebview,
	loadDefaultLayout,
} from './assetLoader.js';
import { WORKSPACE_KEY_AGENT_SEATS, GLOBAL_KEY_SOUND_ENABLED } from './constants.js';
import { writeLayoutToFile, readLayoutFromFile, watchLayoutFile } from './layoutPersistence.js';
import type { LayoutWatcher } from './layoutPersistence.js';

export class PixelAgentsViewProvider implements vscode.WebviewViewProvider {
	nextAgentId = { current: 1 };
	nextTerminalIndex = { current: 1 };
	agents = new Map<number, AgentState>();
	webviewView: vscode.WebviewView | undefined;

	fileWatchers = new Map<number, fs.FSWatcher>();
	pollingTimers = new Map<number, ReturnType<typeof setInterval>>();
	waitingTimers = new Map<number, ReturnType<typeof setTimeout>>();
	jsonlPollTimers = new Map<number, ReturnType<typeof setInterval>>();
	permissionTimers = new Map<number, ReturnType<typeof setTimeout>>();

	activeAgentId = { current: null as number | null };
	knownJsonlFiles = new Set<string>();
	projectScanTimer = { current: null as ReturnType<typeof setInterval> | null };

	defaultLayout: Record<string, unknown> | null = null;
	layoutWatcher: LayoutWatcher | null = null;

	constructor(private readonly context: vscode.ExtensionContext) {}

	private get extensionUri(): vscode.Uri {
		return this.context.extensionUri;
	}

	private get webview(): vscode.Webview | undefined {
		return this.webviewView?.webview;
	}

	private persistAgents = (): void => {
		persistAgents(this.agents, this.context);
	};

	resolveWebviewView(webviewView: vscode.WebviewView) {
		this.webviewView = webviewView;
		webviewView.webview.options = { enableScripts: true };
		webviewView.webview.html = getWebviewContent(webviewView.webview, this.extensionUri);

		webviewView.webview.onDidReceiveMessage(async (message) => {
			if (message.type === 'openCodex') {
				await launchNewTerminal(
					this.nextAgentId,
					this.nextTerminalIndex,
					this.agents,
					this.activeAgentId,
					this.knownJsonlFiles,
					this.fileWatchers,
					this.pollingTimers,
					this.waitingTimers,
					this.permissionTimers,
					this.jsonlPollTimers,
					this.projectScanTimer,
					this.webview,
					this.persistAgents,
					message.folderPath as string | undefined,
				);
			} else if (message.type === 'focusAgent') {
				const agent = this.agents.get(message.id);
				if (agent) {
					agent.terminalRef.show();
				}
			} else if (message.type === 'closeAgent') {
				const agent = this.agents.get(message.id);
				if (agent) {
					agent.terminalRef.dispose();
				}
			} else if (message.type === 'saveAgentSeats') {
				this.context.workspaceState.update(WORKSPACE_KEY_AGENT_SEATS, message.seats);
			} else if (message.type === 'saveLayout') {
				this.layoutWatcher?.markOwnWrite();
				writeLayoutToFile(message.layout as Record<string, unknown>);
			} else if (message.type === 'setSoundEnabled') {
				this.context.globalState.update(GLOBAL_KEY_SOUND_ENABLED, message.enabled);
			} else if (message.type === 'webviewReady') {
				restoreAgents(
					this.context,
					this.nextAgentId,
					this.nextTerminalIndex,
					this.agents,
					this.knownJsonlFiles,
					this.fileWatchers,
					this.pollingTimers,
					this.waitingTimers,
					this.permissionTimers,
					this.jsonlPollTimers,
					this.projectScanTimer,
					this.activeAgentId,
					this.webview,
					this.persistAgents,
				);

				const soundEnabled = this.context.globalState.get<boolean>(GLOBAL_KEY_SOUND_ENABLED, true);
				this.webview?.postMessage({ type: 'settingsLoaded', soundEnabled });

				const wsFolders = vscode.workspace.workspaceFolders;
				if (wsFolders && wsFolders.length > 1) {
					this.webview?.postMessage({
						type: 'workspaceFolders',
						folders: wsFolders.map(f => ({ name: f.name, path: f.uri.fsPath })),
					});
				}

				const projectDir = getProjectDirPath();
				const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
				if (fs.existsSync(projectDir)) {
					ensureProjectScan(
						projectDir,
						this.knownJsonlFiles,
						this.projectScanTimer,
						this.activeAgentId,
						this.nextAgentId,
						this.agents,
						this.fileWatchers,
						this.pollingTimers,
						this.waitingTimers,
						this.permissionTimers,
						this.webview,
						this.persistAgents,
					);
				}

				(async () => {
					try {
						const extensionPath = this.extensionUri.fsPath;
						const bundledAssetsDir = path.join(extensionPath, 'dist', 'assets');
						let assetsRoot: string | null = null;
						if (fs.existsSync(bundledAssetsDir)) {
							assetsRoot = path.join(extensionPath, 'dist');
						} else if (workspaceRoot) {
							assetsRoot = workspaceRoot;
						}

						if (assetsRoot) {
							this.defaultLayout = loadDefaultLayout(assetsRoot);

							const charSprites = await loadCharacterSprites(assetsRoot);
							if (charSprites && this.webview) {
								sendCharacterSpritesToWebview(this.webview, charSprites);
							}

							const floorTiles = await loadFloorTiles(assetsRoot);
							if (floorTiles && this.webview) {
								sendFloorTilesToWebview(this.webview, floorTiles);
							}

							const wallTiles = await loadWallTiles(assetsRoot);
							if (wallTiles && this.webview) {
								sendWallTilesToWebview(this.webview, wallTiles);
							}

							const assets = await loadFurnitureAssets(assetsRoot);
							if (assets && this.webview) {
								sendAssetsToWebview(this.webview, assets);
							}
						}
					} catch (err) {
						console.error('[Extension] Error loading assets:', err);
					}

					if (this.webview) {
						sendLayout(this.context, this.webview, this.defaultLayout);
						this.startLayoutWatcher();
					}
				})();

				sendExistingAgents(this.agents, this.context, this.webview);
			} else if (message.type === 'openCodexSessionsFolder') {
				const sessionsDir = getProjectDirPath();
				if (fs.existsSync(sessionsDir)) {
					vscode.env.openExternal(vscode.Uri.file(sessionsDir));
				}
			} else if (message.type === 'retryAgentBinding') {
				const id = message.id as number;
				const agent = this.agents.get(id);
				if (!agent) {
					return;
				}
				for (const timer of agent.subagentTimers.values()) {
					clearTimeout(timer);
				}
				agent.subagentTimers.clear();
				for (const callId of agent.subagentStates.keys()) {
					this.webview?.postMessage({ type: 'subagentClear', id, parentToolId: callId });
				}
				agent.subagentStates.clear();
				agent.sessionBound = false;
				agent.jsonlFile = '';
				agent.fileOffset = 0;
				agent.lineBuffer = '';
				agent.bindWarningSent = false;
				agent.rebindRequestedAtMs = Date.now();
				this.persistAgents();
				this.webview?.postMessage({ type: 'agentBindState', id, bound: false, sessionFile: null, reason: 'retrying' });
				triggerProjectScanNow(
					getProjectDirPath(),
					this.knownJsonlFiles,
					this.activeAgentId,
					this.nextAgentId,
					this.agents,
					this.fileWatchers,
					this.pollingTimers,
					this.waitingTimers,
					this.permissionTimers,
					this.webview,
					this.persistAgents,
				);
			} else if (message.type === 'exportLayout') {
				const layout = readLayoutFromFile();
				if (!layout) {
					vscode.window.showWarningMessage('Pixel Agents: No saved layout to export.');
					return;
				}
				const uri = await vscode.window.showSaveDialog({
					filters: { 'JSON Files': ['json'] },
					defaultUri: vscode.Uri.file(path.join(os.homedir(), 'pixel-agents-layout.json')),
				});
				if (uri) {
					fs.writeFileSync(uri.fsPath, JSON.stringify(layout, null, 2), 'utf-8');
					vscode.window.showInformationMessage('Pixel Agents: Layout exported successfully.');
				}
			} else if (message.type === 'importLayout') {
				const uris = await vscode.window.showOpenDialog({
					filters: { 'JSON Files': ['json'] },
					canSelectMany: false,
				});
				if (!uris || uris.length === 0) return;
				try {
					const raw = fs.readFileSync(uris[0].fsPath, 'utf-8');
					const imported = JSON.parse(raw) as Record<string, unknown>;
					if (imported.version !== 1 || !Array.isArray(imported.tiles)) {
						vscode.window.showErrorMessage('Pixel Agents: Invalid layout file.');
						return;
					}
					this.layoutWatcher?.markOwnWrite();
					writeLayoutToFile(imported);
					this.webview?.postMessage({ type: 'layoutLoaded', layout: imported });
					vscode.window.showInformationMessage('Pixel Agents: Layout imported successfully.');
				} catch {
					vscode.window.showErrorMessage('Pixel Agents: Failed to read or parse layout file.');
				}
			}
		});

		vscode.window.onDidChangeActiveTerminal((terminal) => {
			this.activeAgentId.current = null;
			if (!terminal) return;
			for (const [id, agent] of this.agents) {
				if (agent.terminalRef === terminal) {
					this.activeAgentId.current = id;
					webviewView.webview.postMessage({ type: 'agentSelected', id });
					break;
				}
			}
		});

		vscode.window.onDidCloseTerminal((closed) => {
			for (const [id, agent] of this.agents) {
				if (agent.terminalRef === closed) {
					if (this.activeAgentId.current === id) {
						this.activeAgentId.current = null;
					}
					removeAgent(
						id,
						this.agents,
						this.fileWatchers,
						this.pollingTimers,
						this.waitingTimers,
						this.permissionTimers,
						this.jsonlPollTimers,
						this.persistAgents,
					);
					webviewView.webview.postMessage({ type: 'agentClosed', id });
				}
			}
		});
	}

	exportDefaultLayout(): void {
		const layout = readLayoutFromFile();
		if (!layout) {
			vscode.window.showWarningMessage('Pixel Agents: No saved layout found.');
			return;
		}
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		if (!workspaceRoot) {
			vscode.window.showErrorMessage('Pixel Agents: No workspace folder found.');
			return;
		}
		const targetPath = path.join(workspaceRoot, 'webview-ui', 'public', 'assets', 'default-layout.json');
		const json = JSON.stringify(layout, null, 2);
		fs.writeFileSync(targetPath, json, 'utf-8');
		vscode.window.showInformationMessage(`Pixel Agents: Default layout exported to ${targetPath}`);
	}

	private startLayoutWatcher(): void {
		if (this.layoutWatcher) return;
		this.layoutWatcher = watchLayoutFile((layout) => {
			this.webview?.postMessage({ type: 'layoutLoaded', layout });
		});
	}

	dispose() {
		this.layoutWatcher?.dispose();
		this.layoutWatcher = null;
		for (const id of [...this.agents.keys()]) {
			removeAgent(
				id,
				this.agents,
				this.fileWatchers,
				this.pollingTimers,
				this.waitingTimers,
				this.permissionTimers,
				this.jsonlPollTimers,
				this.persistAgents,
			);
		}
		if (this.projectScanTimer.current) {
			clearInterval(this.projectScanTimer.current);
			this.projectScanTimer.current = null;
		}
	}
}

export function getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
	const distPath = vscode.Uri.joinPath(extensionUri, 'dist', 'webview');
	const indexPath = vscode.Uri.joinPath(distPath, 'index.html').fsPath;

	let html = fs.readFileSync(indexPath, 'utf-8');

	html = html.replace(/(href|src)="\.\/([^"]+)"/g, (_match, attr, filePath) => {
		const fileUri = vscode.Uri.joinPath(distPath, filePath);
		const webviewUri = webview.asWebviewUri(fileUri);
		return `${attr}="${webviewUri}"`;
	});

	return html;
}
