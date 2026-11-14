"use client";

import Button from "@/components/ui/Button";
import { View } from "@/type";

export default function RoomNavigation({
    isSignedIn,
    currentView,
}: {
    isSignedIn: boolean;
    currentView?: View;
}) {
    const navigationItems: {
        value: View;
        label: string;
        url: string;
        iconName: string;
    }[] = isSignedIn
        ? [
              {
                  value: "recommended",
                  label: "おすすめ",
                  url: "/",
                  iconName: "wandSparkles",
              },
              {
                  value: "latest",
                  label: "最新",
                  url: "/latest",
                  iconName: "clock",
              },
              {
                  value: "mine",
                  label: "自分のルーム",
                  url: "/mine",
                  iconName: "user",
              },
              {
                  value: "saved",
                  label: "保存済み",
                  url: "/saved",
                  iconName: "bookmark",
              },
          ]
        : [
              {
                  value: "recommended",
                  label: "おすすめ",
                  url: "/",
                  iconName: "wandSparkles",
              },
              {
                  value: "latest",
                  label: "最新",
                  url: "/latest",
                  iconName: "clock",
              },
          ];

    return (
        <div className="w-full sm:w-48 sm:pr-0 shrink-0 px-4 flex sm:flex-col gap-4 overflow-x-scroll no-scrollbar">
            {navigationItems.map((item, index) => (
                <Button
                    href={item.url}
                    className="sm:w-full shrink-0 w-fit"
                    alignment="left"
                    iconName={item.iconName}
                    key={item.label}
                    variant={
                        currentView &&
                        Math.max(
                            0,
                            navigationItems.findIndex(
                                (item) => item.value === currentView,
                            ),
                        ) === index
                            ? "primary"
                            : "default"
                    }
                >
                    {item.label}
                </Button>
            ))}
        </div>
    );
}
