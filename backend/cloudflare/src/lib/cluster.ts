import { clusterConfig } from "../../../shared/distributed/control";
import type { Control, ControlResult } from "../../../shared/distributed/types";
import type { Env } from "../types";
import { clusterObjectName } from "./namespace";
export class WorkerControl implements Control {
    readonly config;
    constructor(private env: Env) {
        this.config = clusterConfig(env, "websocket")!;
    }
    async call(
        op: string,
        args: Record<string, unknown> = {},
    ): Promise<ControlResult> {
        return this.env.CLUSTER.get(
            this.env.CLUSTER.idFromName(await clusterObjectName(this.env)),
        ).invoke(op, args);
    }
    register() {
        return this.call("register");
    }
}
