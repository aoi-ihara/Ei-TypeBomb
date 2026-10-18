import { clusterConfig } from "../../../shared/distributed/control";
import type { Control, ControlResult } from "../../../shared/distributed/types";
import type { Env } from "../types";
export class WorkerControl implements Control {
    readonly config;
    constructor(private env: Env) {
        this.config = clusterConfig(env, "websocket")!;
    }
    call(
        op: string,
        args: Record<string, unknown> = {},
    ): Promise<ControlResult> {
        return this.env.CLUSTER.get(
            this.env.CLUSTER.idFromName("server"),
        ).invoke(op, args);
    }
    register() {
        return this.call("register");
    }
}
