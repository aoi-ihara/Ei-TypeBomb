declare module "pg" {
    export type PoolConfig = {
        connectionString?: string;
        max?: number;
        idleTimeoutMillis?: number;
        connectionTimeoutMillis?: number;
    };

    export type QueryResult<Row> = {
        rows: Row[];
        rowCount: number | null;
    };

    export type PoolClient = {
        query<Row = Record<string, unknown>>(
            text: string,
            values?: readonly unknown[],
        ): Promise<QueryResult<Row>>;
        release(): void;
    };

    export class Pool {
        constructor(config?: PoolConfig);
        on(event: "error", listener: (error: Error) => void): this;
        query<Row = Record<string, unknown>>(
            text: string,
            values?: readonly unknown[],
        ): Promise<QueryResult<Row>>;
        connect(): Promise<PoolClient>;
        end(): Promise<void>;
    }
}
