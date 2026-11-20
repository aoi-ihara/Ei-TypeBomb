import Shell from "@/components/layout/Shell";

export default function Page() {
    return (
        <Shell title="メールをご確認ください">
            <p role="status" data-cursor="text">
                メールに記載されたリンクを開き、アカウント作成を完了してください。
                確認メールが届かない場合は、迷惑メールフォルダもご確認ください。
            </p>
        </Shell>
    );
}
