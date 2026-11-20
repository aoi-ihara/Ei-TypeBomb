import Shell from "@/components/layout/Shell";
import Button from "@/components/ui/Button";

export const dynamic = "force-dynamic";

export default function BetaAccessDeniedPage() {
    return (
        <Shell title="認証が必要です" size="medium">
            <p role="status" data-cursor="text" className="text-center">
                有効なアカウントでサインインしてください。
            </p>
            <Button
                href="/sign-in"
                variant="primary"
                iconName="logIn"
                className="w-full max-w-xs whitespace-nowrap"
            >
                サインイン
            </Button>
        </Shell>
    );
}
