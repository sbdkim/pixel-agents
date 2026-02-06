import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

const CLAUDE_TERMINAL_PATTERN = /^Claude Code #(\d+)$/;

interface FolderInfo {
	id: string;
	name: string;
	path: string;
}

interface AgentFolderMapping {
	agentId: number;
	folderId: string;
}

class ArcadiaViewProvider implements vscode.WebviewViewProvider {
	private nextId = 1;
	private terminals = new Map<number, vscode.Terminal>();
	private webviewView: vscode.WebviewView | undefined;
	private folders: FolderInfo[] = [];
	private agentFolders = new Map<number, string>(); // agentId → folderId
	private movingAgents = new Set<number>(); // agents currently being moved (suppress close event)

	constructor(private readonly extensionUri: vscode.Uri) {}

	resolveWebviewView(webviewView: vscode.WebviewView) {
		this.webviewView = webviewView;
		webviewView.webview.options = { enableScripts: true };
		webviewView.webview.html = getWebviewContent(webviewView.webview, this.extensionUri);

		// Adopt any existing Claude Code terminals
		this.adoptExistingTerminals();

		// Ensure a default folder exists
		this.ensureDefaultFolder();

		webviewView.webview.onDidReceiveMessage((message) => {
			if (message.type === 'openClaude') {
				const folderId = message.folderId as string | undefined;
				const folderPath = message.folderPath as string | undefined;
				const id = this.nextId++;
				const terminal = this.createClaudeTerminal(id, folderPath);
				terminal.show();
				this.terminals.set(id, terminal);
				const assignedFolderId = folderId || (this.folders.length > 0 ? this.folders[0].id : '');
				this.agentFolders.set(id, assignedFolderId);
				webviewView.webview.postMessage({ type: 'agentCreated', id, folderId: assignedFolderId });
			} else if (message.type === 'focusAgent') {
				const terminal = this.terminals.get(message.id);
				if (terminal) {
					terminal.show();
				}
			} else if (message.type === 'closeAgent') {
				const terminal = this.terminals.get(message.id);
				if (terminal) {
					terminal.dispose();
				}
			} else if (message.type === 'webviewReady') {
				this.sendExistingAgents();
			} else if (message.type === 'addFolder') {
				this.handleAddFolder();
			} else if (message.type === 'moveAgent') {
				this.handleMoveAgent(
					message.agentId as number,
					message.targetFolderId as string,
					message.targetPath as string,
					message.keepAccess as boolean,
					message.sourcePath as string | undefined,
					message.continueConversation as boolean,
				);
			}
		});

		// Clean up buttons when terminals are closed (skip agents being moved)
		vscode.window.onDidCloseTerminal((closed) => {
			for (const [id, terminal] of this.terminals) {
				if (terminal === closed) {
					if (this.movingAgents.has(id)) { break; }
					this.terminals.delete(id);
					this.agentFolders.delete(id);
					webviewView.webview.postMessage({ type: 'agentClosed', id });
					break;
				}
			}
		});

		// Detect Claude Code terminals opened outside the extension
		vscode.window.onDidOpenTerminal((terminal) => {
			const match = terminal.name.match(CLAUDE_TERMINAL_PATTERN);
			if (match && !this.isTracked(terminal)) {
				const id = parseInt(match[1], 10);
				this.terminals.set(id, terminal);
				if (id >= this.nextId) {
					this.nextId = id + 1;
				}
				const folderId = this.folders.length > 0 ? this.folders[0].id : '';
				this.agentFolders.set(id, folderId);
				webviewView.webview.postMessage({ type: 'agentCreated', id, folderId });
			}
		});
	}

	private ensureDefaultFolder() {
		if (this.folders.length === 0) {
			const workspaceFolders = vscode.workspace.workspaceFolders;
			if (workspaceFolders && workspaceFolders.length > 0) {
				const wsPath = workspaceFolders[0].uri.fsPath;
				this.folders.push({
					id: 'default',
					name: path.basename(wsPath),
					path: wsPath,
				});
			}
		}
	}

	private async handleAddFolder() {
		const uris = await vscode.window.showOpenDialog({
			canSelectFolders: true,
			canSelectFiles: false,
			canSelectMany: false,
			openLabel: 'Select Folder',
		});
		if (uris && uris.length > 0) {
			const folderPath = uris[0].fsPath;
			const folder: FolderInfo = {
				id: crypto.randomUUID(),
				name: path.basename(folderPath),
				path: folderPath,
			};
			this.folders.push(folder);
			this.webviewView?.webview.postMessage({
				type: 'folderAdded',
				id: folder.id,
				name: folder.name,
				path: folder.path,
			});
		}
	}

	private handleMoveAgent(
		agentId: number,
		targetFolderId: string,
		targetPath: string,
		keepAccess: boolean,
		sourcePath: string | undefined,
		continueConversation: boolean,
	) {
		const oldTerminal = this.terminals.get(agentId);
		if (!oldTerminal) { return; }

		// Claude Code cannot change its primary cwd mid-session, and
		// terminal.sendText() cannot submit commands to Ink's raw-mode stdin.
		// Instead, dispose the terminal and restart in the new directory.
		this.movingAgents.add(agentId);
		oldTerminal.dispose();

		const addDirs = keepAccess && sourcePath ? [sourcePath] : undefined;
		const newTerminal = this.createClaudeTerminal(agentId, targetPath, addDirs, continueConversation);
		newTerminal.show();
		this.terminals.set(agentId, newTerminal);
		this.agentFolders.set(agentId, targetFolderId);
		this.movingAgents.delete(agentId);

		this.webviewView?.webview.postMessage({
			type: 'agentMoved',
			agentId,
			targetFolderId,
		});
	}

	private createClaudeTerminal(id: number, cwd?: string, addDirs?: string[], continueSession = false): vscode.Terminal {
		const terminal = vscode.window.createTerminal({
			name: `Claude Code #${id}`,
			cwd,
		});
		const parts = ['claude'];
		if (addDirs) {
			for (const dir of addDirs) {
				parts.push(`--add-dir "${dir}"`);
			}
		}
		if (continueSession) {
			parts.push('--continue');
		}
		terminal.sendText(parts.join(' '));
		return terminal;
	}

	private adoptExistingTerminals() {
		for (const terminal of vscode.window.terminals) {
			const match = terminal.name.match(CLAUDE_TERMINAL_PATTERN);
			if (match) {
				const id = parseInt(match[1], 10);
				this.terminals.set(id, terminal);
				if (id >= this.nextId) {
					this.nextId = id + 1;
				}
				// Assign to default folder
				const folderId = this.folders.length > 0 ? this.folders[0].id : 'default';
				this.agentFolders.set(id, folderId);
			}
		}
	}

	private sendExistingAgents() {
		if (!this.webviewView) { return; }
		const agents: AgentFolderMapping[] = [];
		for (const [agentId, folderId] of this.agentFolders) {
			agents.push({ agentId, folderId });
		}
		agents.sort((a, b) => a.agentId - b.agentId);
		this.webviewView.webview.postMessage({
			type: 'existingAgents',
			agents,
			folders: this.folders,
		});
	}

	private isTracked(terminal: vscode.Terminal): boolean {
		for (const t of this.terminals.values()) {
			if (t === terminal) { return true; }
		}
		return false;
	}
}

export function activate(context: vscode.ExtensionContext) {
	const provider = new ArcadiaViewProvider(context.extensionUri);

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider('arcadia.panelView', provider)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('arcadia.showPanel', () => {
			vscode.commands.executeCommand('arcadia.panelView.focus');
		})
	);
}

function getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
	const distPath = vscode.Uri.joinPath(extensionUri, 'dist', 'webview');
	const indexPath = vscode.Uri.joinPath(distPath, 'index.html').fsPath;

	let html = fs.readFileSync(indexPath, 'utf-8');

	// Rewrite asset paths to use webview URIs
	html = html.replace(/(href|src)="\.\/([^"]+)"/g, (_match, attr, filePath) => {
		const fileUri = vscode.Uri.joinPath(distPath, filePath);
		const webviewUri = webview.asWebviewUri(fileUri);
		return `${attr}="${webviewUri}"`;
	});

	return html;
}

export function deactivate() {}
