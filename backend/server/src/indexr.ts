import "dotenv/config";

async function testSupabase(roomId: string, jwtToken: string) {
    const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const apiKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    if (!baseUrl || !apiKey) {
        throw new Error("Supabase環境変数が設定されていません");
    }

    const url = new URL("/rest/v1/ei_typebomb_rooms", baseUrl);

    url.searchParams.set("select", "id,title");
    url.searchParams.set("id", `eq.${roomId}`);

    const response = await fetch(url, {
        headers: {
            apikey: apiKey,
            Authorization: `Bearer ${jwtToken}`,
        },
        signal: AbortSignal.timeout(10_000),
    });

    console.log("Status:", response.status);
    console.log("Body:", await response.text());
}

testSupabase(
    "a490087e-df39-4e59-9665-d7e08af16052",
    "eyJhbGciOiJFUzI1NiIsImtpZCI6IjMwMDI5NTA3LWIyZTgtNGE4YS05ODhjLTIyYjdhMTk2M2E1NyIsInR5cCI6IkpXVCJ9.eyJpZCI6ImE0OTAwODdlLWRmMzktNGU1OS05NjY1LWQ3ZTA4YWYxNjA1MiIsInJvbGUiOiJhdXRoZW50aWNhdGVkIiwiaWF0IjoxNzkxNjE3NzUyLCJleHAiOjE3OTE2MzIxNTJ9.OOn68p6-UazJE5yTyom6JNb95VY5WF2v5GFOmSobtUlW4fLAN7o7a96Yob63ZRUwvDUbhAhrbpuY9u-9NHfaqA",
);
