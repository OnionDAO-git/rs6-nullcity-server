export interface AgentGatewayConfig {
    enabled: boolean;
    host: string;
    port: number;
    authToken?: string | null;
    allowDelete?: boolean;
    logFullPerceptions?: boolean;
    autosaveTicks?: number;
    mcp?: AgentGatewayMcpConfig;
}

export interface AgentGatewayMcpConfig {
    enabled?: boolean;
    path?: string;
    actionTimeoutMs?: number;
    eventTimeoutMs?: number;
}

export const defaultAgentGatewayConfig: AgentGatewayConfig = {
    enabled: false,
    host: '127.0.0.1',
    port: 43595,
    authToken: null,
    allowDelete: false,
    logFullPerceptions: false,
    autosaveTicks: 1000,
    mcp: {
        enabled: false,
        path: '/agent/mcp',
        actionTimeoutMs: 3000,
        eventTimeoutMs: 30000,
    },
};
