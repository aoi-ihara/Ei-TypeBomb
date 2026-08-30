import { flag } from "flags/next";
import { vercelAdapter } from "@flags-sdk/vercel";

export const cookieTools = flag({
    key: "cookieTools",
    adapter: vercelAdapter(),
});
