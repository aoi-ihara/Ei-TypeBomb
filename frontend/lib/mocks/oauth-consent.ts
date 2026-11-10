export const mockOAuthConsent = {
    authorization_id: "auth_test_123456789",
    client: {
        id: "chatgpt-test-client",
        name: "ChatGPT",
        uri: "https://chatgpt.com",
    },
    redirect_uri: "https://chatgpt.com/connector_platform_oauth_redirect",
    scope: "openid email profile",
};

export const mockOAuthScopes = [
    {
        scope: "openid",
        description: "アカウントの識別情報",
    },
    {
        scope: "email",
        description: "メールアドレス",
    },
    {
        scope: "profile",
        description: "プロフィール情報",
    },
];
