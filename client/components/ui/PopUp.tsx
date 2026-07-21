"use client";

type TurnstileModalProps = {
    show: boolean;
    children: React.ReactNode;
};

export const PopUp = ({ show, children }: TurnstileModalProps) => (
    <div
        className={`flex justify-center transition-all duration-200 ease-out items-center top-0 left-0 w-full h-full fixed ${
            show
                ? "bg-(--color-background)/50"
                : "bg-transparent pointer-events-none"
        }`}
    >
        {show && (
            <div className="p-6 rounded flex flex-col items-center gap-4">
                {children}
            </div>
        )}
    </div>
);
