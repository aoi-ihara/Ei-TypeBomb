import type { RoomDO } from "./RoomDO";
import type { ClusterDO, ReplicaDO } from "./ClusterDO";
export interface Env {
    CLUSTER: DurableObjectNamespace<ClusterDO>;
    REPLICAS: DurableObjectNamespace<ReplicaDO>;
    CLUSTER_DRAINING?: string;
    ROOMS: DurableObjectNamespace<RoomDO>;
    CLUSTER_SERVER_TOKEN?: string;
    ETB_CLUSTER_CONFIG?: string;
    JWT_KEY_ID: string;
    JWT_PUBLIC_KEY: string;
    NEXT_PUBLIC_SUPABASE_URL: string;
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: string;
    // Optional comma-separated list of browser origins allowed to connect.
    ALLOWED_ORIGINS?: string;
    PRIMARY_SERVER_URL?: string;
    PARENT_SERVER_URL?: string;
    SERVER_PUBLIC_URL?: string;
}

export type Session = {
    id: string;
    connectionId?: string;
    roomId: string | null;
    targetRoomId: string;
    displayName?: string;
    recommendedItemId?: string;
};
