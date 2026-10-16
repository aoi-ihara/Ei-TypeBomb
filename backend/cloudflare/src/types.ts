export interface Env {
    ROOMS: DurableObjectNamespace;
    JWT_KEY_ID: string;
    JWT_PUBLIC_KEY: string;
    NEXT_PUBLIC_SUPABASE_URL: string;
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: string;
    // Optional comma-separated list of browser origins allowed to connect.
    ALLOWED_ORIGINS?: string;
}

export type Session = {
    id: string;
    roomId: string | null;
    targetRoomId: string;
    displayName?: string;
    recommendedItemId?: string;
};
