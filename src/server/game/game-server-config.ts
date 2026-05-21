export interface GameServerConfig {
    rsaMod: string;
    rsaExp: string;
    host: string;
    port: number;
    encryptionEnabled: boolean;
    loginServerHost: string;
    loginServerPort: number;
    updateServerHost: string;
    updateServerPort: number;
    showWelcome: boolean;
    expRate: number;
    giveAchievements: boolean;
    checkCredentials: boolean;
    tutorialEnabled: boolean;
    adminDropsEnabled: boolean;
    loadedZoneScale?: number;
    bypassTeleportRequirements?: boolean;
    agentGateway?: {
        enabled: boolean;
        host?: string;
        port?: number;
        authToken?: string | null;
        allowDelete?: boolean;
        logFullPerceptions?: boolean;
        autosaveTicks?: number;
        mcp?: {
            enabled?: boolean;
            path?: string;
            actionTimeoutMs?: number;
            eventTimeoutMs?: number;
        };
    };
}
