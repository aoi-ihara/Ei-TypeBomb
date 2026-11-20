import Shell from "@/components/layout/Shell";
import Button from "@/components/ui/Button";

export const dynamic = "force-dynamic";

export default function BetaAccessDeniedPage() {
    return (
        <Shell title="アクセスできません" size="small">
            <p className="text-center text-(--color-foreground-secondary)" role="alert">
                この環境は現在、許可されたベータテスターのみ利用できます。
                対象のアカウントでサインインしてください。
            </p>
            <Button href="/sign-in" variant="primary" iconName="logIn" className="w-full">
                サインイン
            </Button>
        </Shell>
    );
}
