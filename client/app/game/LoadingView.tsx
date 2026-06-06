export default function LoadingView({ message }: { message: string }) {
    return (
        <div>
            <div className="gradient-text w-fit text-2xl font-bold font-mono px-2 py-1">
                {message}
            </div>
        </div>
    );
}
