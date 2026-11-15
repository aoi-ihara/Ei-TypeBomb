import "server-only";
import { Prompts } from "@posthog/ai";
import { PostHog } from "posthog-node";

type JsonRecord = Record<string, unknown>;
type SchemaProperty = {
    [key: string]: unknown;
    description?: string;
    properties?: Record<string, SchemaProperty>;
    items?: SchemaProperty;
};
type McpTool = {
    name: string;
    description: string;
    inputSchema: {
        properties?: Record<string, SchemaProperty | undefined>;
        [key: string]: unknown;
    };
};

type Descriptions = {
    server?: string;
    tools?: Record<string, { description?: string; properties?: Record<string, string> }>;
    roomProperties?: Record<string, string>;
    itemProperties?: Record<string, string>;
};

const PROMPT_NAME = "etb-mcp-descriptions";

// Use PostHog's app host for prompt retrieval, not the event ingestion host.
// A personal API key with llm_prompt:read is required.
const token = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const personalApiKey = process.env.POSTHOG_PERSONAL_API_KEY;
const prompts = token && personalApiKey
    ? new Prompts({
          posthog: new PostHog(token, {
              host: "https://us.posthog.com",
              personalApiKey,
          }),
      })
    : null;

function record(value: unknown): JsonRecord | null {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as JsonRecord)
        : null;
}

function description(value: unknown): string | undefined {
    return typeof value === "string" && value.trim().length > 0
        ? value
        : undefined;
}

function stringMap(value: unknown): Record<string, string> {
    const source = record(value);
    if (!source) return {};
    return Object.fromEntries(
        Object.entries(source).filter(
            (entry): entry is [string, string] => description(entry[1]) !== undefined,
        ),
    );
}

function parseDescriptions(value: string): Descriptions {
    const parsed = record(JSON.parse(value));
    if (!parsed) throw new Error("MCP descriptions must be a JSON object");
    const tools = record(parsed.tools);
    const toolDescriptions: NonNullable<Descriptions["tools"]> = {};
    if (tools) {
        for (const [name, value] of Object.entries(tools)) {
            const tool = record(value);
            if (!tool) continue;
            toolDescriptions[name] = {
                description: description(tool.description),
                properties: stringMap(tool.properties),
            };
        }
    }
    return {
        server: description(parsed.server),
        tools: toolDescriptions,
        roomProperties: stringMap(parsed.roomProperties),
        itemProperties: stringMap(parsed.itemProperties),
    };
}

function overlayProperties(
    base: Record<string, SchemaProperty | undefined> | undefined,
    toolProperties: Record<string, string> | undefined,
    roomProperties: Record<string, string>,
    itemProperties: Record<string, string>,
): Record<string, SchemaProperty | undefined> | undefined {
    if (!base) return base;
    return Object.fromEntries(
        Object.entries(base).map(([name, property]) => {
            if (!property) return [name, property];
            const replacement = toolProperties?.[name] ?? roomProperties[name];
            const updated: SchemaProperty = {
                ...property,
                ...(replacement ? { description: replacement } : {}),
            };
            if (name === "items" && property.items?.properties) {
                updated.items = {
                    ...property.items,
                    properties: Object.fromEntries(
                        Object.entries(property.items.properties).map(([key, item]) => [
                            key,
                            itemProperties[key]
                                ? { ...item, description: itemProperties[key] }
                                : item,
                        ]),
                    ),
                };
            }
            return [name, updated];
        }),
    );
}

/**
 * Change only descriptions. Tool names, argument types, validation constraints
 * and execution logic are always owned by the checked-in source code.
 */
export async function getMcpPresentation<T extends McpTool>(
    baseTools: T[],
    fallbackInstructions: string,
): Promise<{ instructions: string; tools: T[] }> {
    let managed: Descriptions = {};
    if (prompts) {
        try {
            const result = await prompts.get(PROMPT_NAME, {
                fallback: JSON.stringify({ server: fallbackInstructions }),
            });
            managed = parseDescriptions(result.prompt);
        } catch (error) {
            console.warn("Unable to load MCP descriptions from PostHog", error);
        }
    }

    return {
        instructions: managed.server ?? fallbackInstructions,
        tools: baseTools.map((tool) => {
            const remote = managed.tools?.[tool.name];
            return {
                ...tool,
                description: remote?.description ?? tool.description,
                inputSchema: {
                    ...tool.inputSchema,
                    properties: overlayProperties(
                        tool.inputSchema.properties,
                        remote?.properties,
                        managed.roomProperties ?? {},
                        managed.itemProperties ?? {},
                    ),
                },
            } as T;
        }),
    };
}
