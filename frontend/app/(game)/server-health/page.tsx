import Client from "./Client";
import { parseETBClusterConfig } from "../../../../backend/shared/clusterConfig";

export default function ServerHealthPage() {
    const clusterServers = process.env.ETB_CLUSTER_CONFIG
        ? parseETBClusterConfig(process.env.ETB_CLUSTER_CONFIG).map(s => s.endpoint)
        : [];
    return <Client clusterServers={clusterServers} />;
}
