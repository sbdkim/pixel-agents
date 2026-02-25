import * as os from 'os';
import * as path from 'path';

export const AGENT_PROVIDERS = {
	claude: 'claude',
	codex: 'codex',
} as const;

export type AgentProvider = typeof AGENT_PROVIDERS[keyof typeof AGENT_PROVIDERS];

export const DEFAULT_AGENT_PROVIDER: AgentProvider = AGENT_PROVIDERS.claude;

export interface AgentProviderConfig {
	id: AgentProvider;
	displayName: string;
	terminalNamePrefix: string;
	sessionRootDir: string;
	buildLaunchCommand: (sessionId: string) => string;
	projectDirFromWorkspace: (workspacePath: string) => string;
	expectedSessionFilePath: (projectDir: string, sessionId: string) => string | null;
}

const sanitizeWorkspacePath = (workspacePath: string): string => workspacePath.replace(/[:\\/]/g, '-');

export const PROVIDER_CONFIGS: Record<AgentProvider, AgentProviderConfig> = {
	claude: {
		id: AGENT_PROVIDERS.claude,
		displayName: 'Claude Code',
		terminalNamePrefix: 'Claude Code',
		sessionRootDir: path.join(os.homedir(), '.claude', 'projects'),
		buildLaunchCommand: (sessionId) => `claude --session-id ${sessionId}`,
		projectDirFromWorkspace: (workspacePath) => path.join(os.homedir(), '.claude', 'projects', sanitizeWorkspacePath(workspacePath)),
		expectedSessionFilePath: (projectDir, sessionId) => path.join(projectDir, `${sessionId}.jsonl`),
	},
	codex: {
		id: AGENT_PROVIDERS.codex,
		displayName: 'Codex',
		terminalNamePrefix: 'Codex',
		sessionRootDir: path.join(os.homedir(), '.codex', 'projects'),
		buildLaunchCommand: (_sessionId) => 'codex',
		projectDirFromWorkspace: (workspacePath) => path.join(os.homedir(), '.codex', 'projects', sanitizeWorkspacePath(workspacePath)),
		expectedSessionFilePath: (_projectDir, _sessionId) => null,
	},
};

export function getProviderConfig(provider: AgentProvider): AgentProviderConfig {
	return PROVIDER_CONFIGS[provider];
}

export function resolveAgentProvider(provider: string | undefined): AgentProvider {
	if (provider === AGENT_PROVIDERS.codex) {
		return AGENT_PROVIDERS.codex;
	}
	return DEFAULT_AGENT_PROVIDER;
}

export function getDefaultProvider(): AgentProvider {
	return DEFAULT_AGENT_PROVIDER;
}
