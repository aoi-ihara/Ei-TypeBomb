import Button from "@/components/ui/Button";
import AccountPage from "../AccountPage";

export default function Page() {
    return (
        <AccountPage title="セキュリティ">
            <div className="flex w-full flex-col gap-4">
                <Button
                    className="w-full"
                    iconName="mail"
                    alignment="left"
                    href="/account/security/email"
                    navigation="push"
                >
                    メールアドレス
                </Button>
                <Button
                    className="w-full"
                    iconName="keyRound"
                    alignment="left"
                    href="/account/security/password"
                    navigation="push"
                >
                    パスワード
                </Button>
            </div>
        </AccountPage>
    );
}
