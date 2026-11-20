import Shell from "@/components/layout/Shell";
import Button from "@/components/ui/Button";

export const dynamic = "force-dynamic";

export default function BetaAccessDeniedPage() {
    return (
        <Shell title="認証が必要です" size="small">
            <Button
                href="/sign-in"
                variant="primary"
                iconName="logIn"
                className="w-full"
            >
                サインイン
            </Button>
        </Shell>
    );
}
